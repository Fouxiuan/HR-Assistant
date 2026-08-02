import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const LOCAL_SCHEMA_VERSION = 1;

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_title TEXT,
        boss_job_title TEXT,
        source_run_id TEXT UNIQUE,
        source_client_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        greeted_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running'
      );
      CREATE TABLE candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        education TEXT NOT NULL DEFAULT '',
        years TEXT NOT NULL DEFAULT '',
        resume_text TEXT,
        resume_json TEXT,
        raw_card TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id),
        run_id INTEGER REFERENCES runs(id),
        job_title TEXT,
        ai_score INTEGER,
        ai_reason TEXT,
        matched_skills TEXT,
        status TEXT,
        stage TEXT,
        detail TEXT,
        resume_snapshot TEXT,
        source_event_id TEXT UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_evaluations_candidate_created ON evaluations(candidate_id, created_at DESC);
      CREATE INDEX idx_evaluations_job_created ON evaluations(job_title, created_at DESC);
      CREATE INDEX idx_evaluations_status ON evaluations(status);
      CREATE INDEX idx_evaluations_score ON evaluations(ai_score);
      CREATE INDEX idx_evaluations_run ON evaluations(run_id);
      CREATE TABLE job_descriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL UNIQUE CHECK(length(title) BETWEEN 1 AND 200),
        content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 200000),
        source_filename TEXT,
        updated_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_job_descriptions_updated_at ON job_descriptions(updated_at DESC);
      CREATE TABLE mailbox_sync_state (
        mailbox_key TEXT PRIMARY KEY,
        uid_validity INTEGER,
        last_uid INTEGER,
        last_synced_at TEXT,
        last_error TEXT,
        requires_rebaseline INTEGER NOT NULL DEFAULT 0,
        imported_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE resume_emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mailbox_key TEXT NOT NULL,
        uid_validity INTEGER NOT NULL,
        uid INTEGER NOT NULL,
        message_id TEXT,
        subject TEXT NOT NULL DEFAULT '',
        sender TEXT NOT NULL DEFAULT '',
        recipient TEXT,
        received_at TEXT NOT NULL,
        text_body TEXT NOT NULL DEFAULT '',
        parsed_fields TEXT NOT NULL DEFAULT '{}',
        extracted_job_title TEXT,
        matched_job_id INTEGER REFERENCES job_descriptions(id) ON DELETE SET NULL,
        matched_job_title TEXT,
        candidate_id INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
        processing_status TEXT NOT NULL CHECK(processing_status IN ('imported','pending_job','pending_ai','parse_failed','score_failed','needs_review')),
        processing_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(mailbox_key, uid_validity, uid)
      );
      CREATE UNIQUE INDEX resume_emails_message_id_unique ON resume_emails(message_id) WHERE message_id IS NOT NULL AND message_id <> '';
      CREATE INDEX resume_emails_received_idx ON resume_emails(received_at DESC);
      CREATE INDEX resume_emails_status_idx ON resume_emails(processing_status);
      CREATE INDEX resume_emails_candidate_idx ON resume_emails(candidate_id);
      CREATE INDEX resume_emails_job_idx ON resume_emails(matched_job_id);
      CREATE TABLE resume_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resume_email_id INTEGER NOT NULL REFERENCES resume_emails(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        pdf_data BLOB NOT NULL,
        parsed_text TEXT,
        parse_error TEXT,
        document_type TEXT NOT NULL DEFAULT 'other' CHECK(document_type IN ('resume','portfolio','other')),
        created_at TEXT NOT NULL,
        UNIQUE(resume_email_id, sha256)
      );
      CREATE INDEX resume_attachments_sha_idx ON resume_attachments(sha256);
      CREATE INDEX resume_attachments_document_type_idx ON resume_attachments(document_type);
      CREATE TABLE candidate_contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        contact_type TEXT NOT NULL CHECK(contact_type IN ('phone','email')),
        normalized_value TEXT NOT NULL,
        display_value TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE(contact_type, normalized_value),
        UNIQUE(candidate_id, contact_type, normalized_value)
      );
      CREATE INDEX candidate_contacts_candidate_idx ON candidate_contacts(candidate_id);
    `,
  },
];

export function nowIso(): string {
  return new Date().toISOString();
}

export class LocalDatabase {
  private currentConnection: DatabaseSync;

  get connection(): DatabaseSync { return this.currentConnection; }

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.currentConnection = new DatabaseSync(path);
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  get schemaVersion(): number {
    const row = this.connection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version?: number | null } | undefined;
    return Number(row?.version ?? 0);
  }

  getMeta(key: string): string | null {
    const row = this.connection.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.connection.prepare(`INSERT INTO app_meta(key,value,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(key, value, nowIso());
  }

  transaction<T>(task: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = task();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  checkpoint(): void {
    this.connection.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  close(): void {
    this.checkpoint();
    this.connection.close();
  }

  replaceWith(snapshotPath: string): void {
    const rollbackPath = `${this.path}.restore-rollback`;
    this.checkpoint();
    this.currentConnection.close();
    try {
      if (existsSync(this.path)) copyFileSync(this.path, rollbackPath);
      copyFileSync(snapshotPath, this.path);
      this.currentConnection = new DatabaseSync(this.path);
      this.currentConnection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
      this.migrate();
      rmSync(rollbackPath, { force: true });
    } catch (error) {
      if (existsSync(rollbackPath)) copyFileSync(rollbackPath, this.path);
      this.currentConnection = new DatabaseSync(this.path);
      this.currentConnection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
      rmSync(rollbackPath, { force: true });
      throw error;
    }
  }

  private migrate(): void {
    const hasMigrations = this.connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    let current = hasMigrations
      ? Number((this.connection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version?: number | null }).version ?? 0)
      : 0;
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      this.transaction(() => {
        this.connection.exec(migration.sql);
        this.connection.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(migration.version, nowIso());
      });
      current = migration.version;
    }
  }
}
