import type { JobDescription, JobDescriptionInput } from '../../shared/contracts.js';
import type { JobDescriptionRepository } from './jobDescriptionRepository.js';
import { LocalDatabase, nowIso } from './localDatabase.js';

type Row = Record<string, unknown>;

function mapRow(row: Row): JobDescription {
  return {
    id: Number(row.id),
    title: String(row.title),
    content: String(row.content),
    sourceFilename: row.source_filename == null ? null : String(row.source_filename),
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
  };
}

export class SQLiteJobDescriptionRepository implements JobDescriptionRepository {
  readonly available = true;

  constructor(private readonly database: LocalDatabase) {}

  async list(): Promise<JobDescription[]> {
    return (this.database.connection.prepare(`SELECT id,title,content,source_filename,updated_at,updated_by
      FROM job_descriptions ORDER BY title`).all() as Row[]).map(mapRow);
  }

  async upsert(input: JobDescriptionInput): Promise<JobDescription> {
    const now = nowIso();
    this.database.connection.prepare(`INSERT INTO job_descriptions
      (title,content,source_filename,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(title) DO UPDATE SET content=excluded.content,
        source_filename=COALESCE(excluded.source_filename,job_descriptions.source_filename),
        updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(input.title, input.content, input.sourceFilename ?? null, input.updatedBy ?? null, now, now);
    return mapRow(this.database.connection.prepare(`SELECT id,title,content,source_filename,updated_at,updated_by
      FROM job_descriptions WHERE title=?`).get(input.title) as Row);
  }

  async update(id: number, input: JobDescriptionInput): Promise<JobDescription | null> {
    const result = this.database.connection.prepare(`UPDATE job_descriptions SET title=?,content=?,
      source_filename=COALESCE(?,source_filename),updated_by=?,updated_at=? WHERE id=?`)
      .run(input.title, input.content, input.sourceFilename ?? null, input.updatedBy ?? null, nowIso(), id);
    if (!result.changes) return null;
    return mapRow(this.database.connection.prepare(`SELECT id,title,content,source_filename,updated_at,updated_by
      FROM job_descriptions WHERE id=?`).get(id) as Row);
  }
}
