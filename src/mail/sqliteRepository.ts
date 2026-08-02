import { createHash } from 'node:crypto';
import type {
  CandidateMailSource,
  MailAttachmentMeta,
  MailMessageDetail,
  MailMessageListResponse,
  MailProcessingStatus,
} from '../../shared/contracts.js';
import type { ParsedPdfAttachment } from './parser.js';
import { mailAttachmentDisplayName } from './attachmentName.js';
import type {
  ImportMailInput,
  MailAttachmentDownload,
  MailListParams,
  MailRepository,
  MailSyncStateRecord,
  StoredMailForReprocess,
} from './repository.js';
import { LocalDatabase, nowIso } from '../db/localDatabase.js';

type Row = Record<string, unknown>;

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '').replace(/^86(?=1[3-9]\d{9}$)/, '');
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function candidateKey(input: ImportMailInput): string {
  const identity = input.phone || input.email || input.attachments[0]?.sha256 || `${input.mailboxKey}:${input.uid}`;
  return createHash('md5').update(`mail:${identity}`, 'utf8').digest('hex');
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

function attachmentMeta(row: Row): MailAttachmentMeta {
  const documentType = ['resume', 'portfolio'].includes(String(row.document_type))
    ? String(row.document_type) as MailAttachmentMeta['documentType']
    : 'other';
  const id = Number(row.id);
  const filename = String(row.filename);
  return {
    id,
    filename,
    displayFilename: mailAttachmentDisplayName(filename, documentType, id),
    contentType: String(row.content_type),
    size: Number(row.size_bytes),
    sha256: String(row.sha256),
    parseError: row.parse_error == null ? null : String(row.parse_error),
    textLength: Number(row.text_length ?? 0),
    documentType,
    createdAt: String(row.created_at ?? ''),
  };
}

export class SQLiteMailRepository implements MailRepository {
  readonly available = true;
  private syncing = false;

  constructor(private readonly database: LocalDatabase) {}

  private get db() { return this.database.connection; }

  async withSyncLock<T>(task: () => Promise<T>): Promise<T | null> {
    if (this.syncing) return null;
    this.syncing = true;
    try { return await task(); } finally { this.syncing = false; }
  }

  async getSyncState(mailboxKey: string): Promise<MailSyncStateRecord | null> {
    const row = this.db.prepare(`SELECT uid_validity,last_uid,last_synced_at,last_error,
      requires_rebaseline,imported_count FROM mailbox_sync_state WHERE mailbox_key=?`).get(mailboxKey) as Row | undefined;
    return row ? {
      uidValidity: row.uid_validity == null ? null : Number(row.uid_validity),
      lastUid: row.last_uid == null ? null : Number(row.last_uid),
      lastSyncedAt: row.last_synced_at == null ? null : String(row.last_synced_at),
      lastError: row.last_error == null ? null : String(row.last_error),
      requiresRebaseline: Boolean(row.requires_rebaseline),
      importedCount: Number(row.imported_count ?? 0),
    } : null;
  }

  async saveBaseline(mailboxKey: string, uidValidity: number, lastUid: number): Promise<void> {
    const now = nowIso();
    this.db.prepare(`INSERT INTO mailbox_sync_state
      (mailbox_key,uid_validity,last_uid,last_synced_at,last_error,requires_rebaseline,imported_count,updated_at)
      VALUES(?,?,?,?,NULL,0,0,?)
      ON CONFLICT(mailbox_key) DO UPDATE SET uid_validity=excluded.uid_validity,
        last_uid=excluded.last_uid,last_synced_at=excluded.last_synced_at,last_error=NULL,
        requires_rebaseline=0,
        imported_count=CASE WHEN mailbox_sync_state.uid_validity IS NOT excluded.uid_validity THEN 0 ELSE mailbox_sync_state.imported_count END,
        updated_at=excluded.updated_at`).run(mailboxKey, uidValidity, lastUid, now, now);
  }

  async saveSyncResult(mailboxKey: string, values: {
    uidValidity?: number; lastUid?: number; error?: string | null;
    requiresRebaseline?: boolean; importedDelta?: number;
  }): Promise<void> {
    const now = nowIso();
    this.db.prepare(`INSERT INTO mailbox_sync_state
      (mailbox_key,uid_validity,last_uid,last_synced_at,last_error,requires_rebaseline,imported_count,updated_at)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(mailbox_key) DO UPDATE SET
        uid_validity=COALESCE(excluded.uid_validity,mailbox_sync_state.uid_validity),
        last_uid=MAX(COALESCE(mailbox_sync_state.last_uid,0),COALESCE(excluded.last_uid,0)),
        last_synced_at=excluded.last_synced_at,last_error=excluded.last_error,
        requires_rebaseline=excluded.requires_rebaseline,
        imported_count=mailbox_sync_state.imported_count+excluded.imported_count,
        updated_at=excluded.updated_at`).run(mailboxKey, values.uidValidity ?? null, values.lastUid ?? null,
      now, values.error ?? null, values.requiresRebaseline ? 1 : 0, values.importedDelta ?? 0, now);
  }

  async messageExists(mailboxKey: string, uidValidity: number, uid: number, messageId: string | null): Promise<boolean> {
    return !!this.db.prepare(`SELECT 1 FROM resume_emails WHERE
      (mailbox_key=? AND uid_validity=? AND uid=?) OR (? IS NOT NULL AND message_id=?) LIMIT 1`)
      .get(mailboxKey, uidValidity, uid, messageId, messageId);
  }

  async importMessage(input: ImportMailInput): Promise<{ id: number; candidateId: number | null; inserted: boolean }> {
    return this.database.transaction(() => {
      const duplicate = this.db.prepare(`SELECT id,candidate_id FROM resume_emails WHERE
        (mailbox_key=? AND uid_validity=? AND uid=?) OR (? IS NOT NULL AND message_id=?) LIMIT 1`)
        .get(input.mailboxKey, input.uidValidity, input.uid, input.messageId, input.messageId) as Row | undefined;
      if (duplicate) return { id: Number(duplicate.id), candidateId: duplicate.candidate_id == null ? null : Number(duplicate.candidate_id), inserted: false };

      const identityIds: number[] = [];
      if (input.phone) {
        const row = this.db.prepare("SELECT candidate_id FROM candidate_contacts WHERE contact_type='phone' AND normalized_value=?")
          .get(normalizePhone(input.phone)) as Row | undefined;
        if (row) identityIds.push(Number(row.candidate_id));
      }
      if (input.email) {
        const row = this.db.prepare("SELECT candidate_id FROM candidate_contacts WHERE contact_type='email' AND normalized_value=?")
          .get(normalizeEmail(input.email)) as Row | undefined;
        if (row) identityIds.push(Number(row.candidate_id));
      }
      const hashes = input.attachments.map((attachment) => attachment.sha256);
      if (hashes.length) {
        const rows = this.db.prepare(`SELECT DISTINCT e.candidate_id FROM resume_attachments a
          JOIN resume_emails e ON e.id=a.resume_email_id WHERE a.sha256 IN (${placeholders(hashes.length)})
          AND e.candidate_id IS NOT NULL`).all(...hashes) as Row[];
        identityIds.push(...rows.map((row) => Number(row.candidate_id)));
      }
      const companionIds: number[] = [];
      if (input.card.name && input.subject && input.sender) {
        const from = new Date(input.receivedAt.getTime() - 7 * 86400_000).toISOString();
        const to = new Date(input.receivedAt.getTime() + 7 * 86400_000).toISOString();
        const rows = this.db.prepare(`SELECT DISTINCT candidate_id FROM resume_emails WHERE candidate_id IS NOT NULL
          AND (subject=? OR (lower(trim(COALESCE(json_extract(parsed_fields,'$.name'),'')))=lower(trim(?))
          AND extracted_job_title IS ?)) AND received_at BETWEEN ? AND ?`)
          .all(input.subject, input.card.name, input.extractedJobTitle, from, to) as Row[];
        companionIds.push(...rows.map((row) => Number(row.candidate_id)));
      }
      const uniqueIdentityIds = [...new Set(identityIds)];
      const conflict = uniqueIdentityIds.length > 1;
      let candidateId = conflict ? null : uniqueIdentityIds[0] ?? [...new Set(companionIds)][0] ?? null;
      const now = nowIso();
      if (candidateId == null) {
        const key = conflict
          ? createHash('md5').update(`mail-conflict:${input.mailboxKey}:${input.uidValidity}:${input.uid}`).digest('hex')
          : candidateKey(input);
        this.db.prepare(`INSERT INTO candidates
          (candidate_key,name,education,years,resume_text,resume_json,raw_card,first_seen_at,last_seen_at)
          VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(candidate_key) DO UPDATE SET
          last_seen_at=excluded.last_seen_at,resume_text=COALESCE(excluded.resume_text,candidates.resume_text),
          resume_json=COALESCE(excluded.resume_json,candidates.resume_json),raw_card=COALESCE(excluded.raw_card,candidates.raw_card)`)
          .run(key, input.card.name, input.card.education, input.card.years, input.resumeText || null,
            JSON.stringify({ card: input.card, resumeText: input.resumeText, source: 'mail' }), JSON.stringify(input.card), now, now);
        candidateId = Number((this.db.prepare('SELECT id FROM candidates WHERE candidate_key=?').get(key) as Row).id);
      } else {
        this.db.prepare(`UPDATE candidates SET
          name=CASE WHEN ?<>'' AND name='待确认候选人' THEN ? ELSE name END,
          education=CASE WHEN ?<>'' THEN ? ELSE education END,years=CASE WHEN ?<>'' THEN ? ELSE years END,
          resume_text=CASE WHEN ?<>'' THEN ? ELSE resume_text END,
          resume_json=CASE WHEN ?<>'' THEN ? ELSE resume_json END,raw_card=?,last_seen_at=? WHERE id=?`)
          .run(input.card.name, input.card.name, input.card.education, input.card.education,
            input.card.years, input.card.years, input.resumeText, input.resumeText,
            input.resumeText, JSON.stringify({ card: input.card, resumeText: input.resumeText, source: 'mail' }),
            JSON.stringify(input.card), now, candidateId);
      }
      const status: MailProcessingStatus = conflict ? 'needs_review' : input.status;
      const error = conflict ? '手机号与邮箱分别关联到不同候选人，需要人工确认' : input.error;
      const mail = this.db.prepare(`INSERT INTO resume_emails
        (mailbox_key,uid_validity,uid,message_id,subject,sender,recipient,received_at,text_body,parsed_fields,
        extracted_job_title,matched_job_id,matched_job_title,candidate_id,processing_status,processing_error,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.mailboxKey, input.uidValidity, input.uid,
          input.messageId, input.subject, input.sender, input.recipient, input.receivedAt.toISOString(), input.textBody,
          JSON.stringify(input.parsedFields), input.extractedJobTitle, input.matchedJob?.id ?? null,
          input.matchedJob?.title ?? null, candidateId, status, error, now, now);
      const mailId = Number(mail.lastInsertRowid);
      for (const attachment of input.attachments) {
        this.db.prepare(`INSERT INTO resume_attachments
          (resume_email_id,filename,content_type,size_bytes,sha256,pdf_data,parsed_text,parse_error,document_type,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(resume_email_id,sha256) DO NOTHING`)
          .run(mailId, attachment.filename, attachment.contentType, attachment.size, attachment.sha256,
            attachment.content, attachment.text || null, attachment.parseError, attachment.documentType, now);
      }
      if (!conflict && candidateId != null) {
        const contacts: Array<['phone' | 'email', string, string]> = [];
        if (input.phone) contacts.push(['phone', normalizePhone(input.phone), input.phone]);
        if (input.email) contacts.push(['email', normalizeEmail(input.email), input.email]);
        for (const [type, normalized, display] of contacts) {
          this.db.prepare(`INSERT INTO candidate_contacts
            (candidate_id,contact_type,normalized_value,display_value,first_seen_at,last_seen_at)
            VALUES(?,?,?,?,?,?) ON CONFLICT(contact_type,normalized_value) DO UPDATE SET last_seen_at=excluded.last_seen_at`)
            .run(candidateId, type, normalized, display, now, now);
        }
      }
      if (input.evaluation && candidateId != null && !conflict) {
        this.db.prepare(`INSERT INTO evaluations
          (candidate_id,job_title,ai_score,ai_reason,matched_skills,status,stage,detail,resume_snapshot,source_event_id,created_at)
          VALUES(?,?,?,?,?,'evaluated','mail_ai',NULL,?,?,?) ON CONFLICT(source_event_id) DO UPDATE SET
          job_title=excluded.job_title,ai_score=excluded.ai_score,ai_reason=excluded.ai_reason,
          matched_skills=excluded.matched_skills,resume_snapshot=excluded.resume_snapshot`)
          .run(candidateId, input.matchedJob?.title ?? null, input.evaluation.score, input.evaluation.reason,
            JSON.stringify(input.evaluation.matchedSkills ?? []), input.resumeText,
            `mail:${input.messageId || `${input.mailboxKey}:${input.uidValidity}:${input.uid}`}`, now);
      }
      return { id: mailId, candidateId, inserted: true };
    });
  }

  async list(params: MailListParams): Promise<MailMessageListResponse> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 10));
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (params.search) {
      const term = `%${params.search}%`;
      conditions.push(`(e.subject LIKE ? COLLATE NOCASE OR e.sender LIKE ? COLLATE NOCASE
        OR e.text_body LIKE ? COLLATE NOCASE OR COALESCE(c.name,'') LIKE ? COLLATE NOCASE)`);
      values.push(term, term, term, term);
    }
    if (params.status) { conditions.push('e.processing_status=?'); values.push(params.status); }
    if (params.job) { conditions.push('e.matched_job_title=?'); values.push(params.job); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM resume_emails e
      LEFT JOIN candidates c ON c.id=e.candidate_id ${where}`).get(...values) as Row).count);
    const rows = this.db.prepare(`SELECT e.id,e.message_id,e.subject,e.sender,e.received_at,e.candidate_id,
      c.name AS candidate_name,e.extracted_job_title,e.matched_job_title,e.processing_status,e.processing_error,
      (SELECT COUNT(*) FROM resume_attachments a WHERE a.resume_email_id=e.id) AS attachment_count
      FROM resume_emails e LEFT JOIN candidates c ON c.id=e.candidate_id ${where}
      ORDER BY e.received_at DESC,e.id DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Row[];
    return { total, page, pageSize, items: rows.map((row) => ({
      id: Number(row.id), messageId: row.message_id == null ? null : String(row.message_id), subject: String(row.subject),
      sender: String(row.sender), receivedAt: String(row.received_at), candidateId: row.candidate_id == null ? null : Number(row.candidate_id),
      candidateName: row.candidate_name == null ? null : String(row.candidate_name),
      extractedJobTitle: row.extracted_job_title == null ? null : String(row.extracted_job_title),
      matchedJobTitle: row.matched_job_title == null ? null : String(row.matched_job_title),
      status: String(row.processing_status) as MailProcessingStatus,
      error: row.processing_error == null ? null : String(row.processing_error), attachmentCount: Number(row.attachment_count),
    })) };
  }

  private attachmentsForMail(mailId: number): MailAttachmentMeta[] {
    return (this.db.prepare(`SELECT id,filename,content_type,size_bytes,sha256,parse_error,
      length(COALESCE(parsed_text,'')) AS text_length,document_type,created_at
      FROM resume_attachments WHERE resume_email_id=? ORDER BY id`).all(mailId) as Row[]).map(attachmentMeta);
  }

  async getMessage(id: number): Promise<MailMessageDetail | null> {
    const row = this.db.prepare(`SELECT e.*,c.name AS candidate_name FROM resume_emails e
      LEFT JOIN candidates c ON c.id=e.candidate_id WHERE e.id=?`).get(id) as Row | undefined;
    if (!row) return null;
    const attachments = this.attachmentsForMail(id);
    const candidateAttachments = row.candidate_id == null ? attachments :
      (this.db.prepare(`SELECT a.id,a.filename,a.content_type,a.size_bytes,a.sha256,a.parse_error,
        length(COALESCE(a.parsed_text,'')) AS text_length,a.document_type,a.created_at
        FROM resume_attachments a JOIN resume_emails e ON e.id=a.resume_email_id
        WHERE e.candidate_id=? ORDER BY e.received_at DESC,a.id`).all(Number(row.candidate_id)) as Row[]).map(attachmentMeta);
    return {
      id: Number(row.id), messageId: row.message_id == null ? null : String(row.message_id), subject: String(row.subject),
      sender: String(row.sender), recipient: row.recipient == null ? null : String(row.recipient), receivedAt: String(row.received_at),
      candidateId: row.candidate_id == null ? null : Number(row.candidate_id),
      candidateName: row.candidate_name == null ? null : String(row.candidate_name),
      extractedJobTitle: row.extracted_job_title == null ? null : String(row.extracted_job_title),
      matchedJobTitle: row.matched_job_title == null ? null : String(row.matched_job_title),
      status: String(row.processing_status) as MailProcessingStatus,
      error: row.processing_error == null ? null : String(row.processing_error), attachmentCount: attachments.length,
      textBody: String(row.text_body ?? ''), parsedFields: parseJson<Record<string, string>>(row.parsed_fields, {}),
      attachments, candidateAttachments,
    };
  }

  async getCandidateSources(candidateId: number): Promise<CandidateMailSource[]> {
    const rows = this.db.prepare(`SELECT id,subject,sender,received_at,processing_status,matched_job_title
      FROM resume_emails WHERE candidate_id=? ORDER BY received_at DESC,id DESC`).all(candidateId) as Row[];
    return rows.map((row) => ({ messageId: Number(row.id), subject: String(row.subject), sender: String(row.sender),
      receivedAt: String(row.received_at), status: String(row.processing_status) as MailProcessingStatus,
      matchedJobTitle: row.matched_job_title == null ? null : String(row.matched_job_title),
      attachments: this.attachmentsForMail(Number(row.id)) }));
  }

  async getAttachment(id: number): Promise<MailAttachmentDownload | null> {
    const row = this.db.prepare('SELECT id,filename,content_type,pdf_data,document_type FROM resume_attachments WHERE id=?')
      .get(id) as Row | undefined;
    if (!row) return null;
    const type = ['resume', 'portfolio'].includes(String(row.document_type))
      ? String(row.document_type) as MailAttachmentMeta['documentType'] : 'other';
    return { filename: mailAttachmentDisplayName(String(row.filename), type, Number(row.id)),
      contentType: String(row.content_type), data: Buffer.from(row.pdf_data as Uint8Array) };
  }

  async getForReprocess(id: number): Promise<StoredMailForReprocess | null> {
    const row = this.db.prepare(`SELECT e.id,e.candidate_id,e.message_id,e.subject,e.extracted_job_title,e.parsed_fields,
      COALESCE((SELECT a.parsed_text FROM resume_attachments a WHERE a.resume_email_id=e.id
        AND a.parsed_text IS NOT NULL AND a.document_type='resume' ORDER BY length(a.parsed_text) DESC LIMIT 1),'') AS resume_text
      FROM resume_emails e WHERE e.id=?`).get(id) as Row | undefined;
    if (!row) return null;
    const attachment = this.db.prepare(`SELECT id,filename,content_type,pdf_data,document_type FROM resume_attachments
      WHERE resume_email_id=? ORDER BY CASE document_type WHEN 'resume' THEN 0 WHEN 'portfolio' THEN 1 ELSE 2 END,id LIMIT 1`)
      .get(id) as Row | undefined;
    return { id: Number(row.id), candidateId: row.candidate_id == null ? null : Number(row.candidate_id),
      messageId: row.message_id == null ? null : String(row.message_id), subject: String(row.subject),
      extractedJobTitle: row.extracted_job_title == null ? null : String(row.extracted_job_title),
      parsedFields: parseJson<Record<string, string>>(row.parsed_fields, {}), resumeText: String(row.resume_text ?? ''),
      attachment: attachment ? { id: Number(attachment.id), filename: String(attachment.filename),
        contentType: String(attachment.content_type), data: Buffer.from(attachment.pdf_data as Uint8Array),
        documentType: ['resume', 'portfolio'].includes(String(attachment.document_type))
          ? String(attachment.document_type) as ParsedPdfAttachment['documentType'] : 'other' } : null };
  }

  async saveParsedAttachment(mailId: number, attachmentId: number, text: string, error: string | null,
    documentType: ParsedPdfAttachment['documentType'] = 'other'): Promise<void> {
    this.database.transaction(() => {
      const result = this.db.prepare(`UPDATE resume_attachments SET parsed_text=?,parse_error=?,document_type=?
        WHERE id=? AND resume_email_id=?`).run(text || null, error, documentType, attachmentId, mailId);
      if (!result.changes) throw new Error('简历附件不存在');
      if (text && documentType === 'resume') {
        this.db.prepare(`UPDATE candidates SET resume_text=?,last_seen_at=? WHERE id=(SELECT candidate_id FROM resume_emails WHERE id=?)`)
          .run(text, nowIso(), mailId);
      }
    });
  }

  async reconcileCandidate(mailId: number, resumeText: string, phone: string | null, email: string | null): Promise<number | null> {
    return this.database.transaction(() => {
      const mail = this.db.prepare(`SELECT id,candidate_id,subject,received_at,parsed_fields,extracted_job_title
        FROM resume_emails WHERE id=?`).get(mailId) as Row | undefined;
      if (!mail) return null;
      const ids: number[] = mail.candidate_id == null ? [] : [Number(mail.candidate_id)];
      const from = new Date(new Date(String(mail.received_at)).getTime() - 7 * 86400_000).toISOString();
      const to = new Date(new Date(String(mail.received_at)).getTime() + 7 * 86400_000).toISOString();
      const name = parseJson<Record<string, string>>(mail.parsed_fields, {}).name ?? '';
      const extractedJobTitle = mail.extracted_job_title == null ? null : String(mail.extracted_job_title);
      const companions = this.db.prepare(`SELECT DISTINCT candidate_id FROM resume_emails WHERE candidate_id IS NOT NULL
        AND (subject=? OR (lower(trim(COALESCE(json_extract(parsed_fields,'$.name'),'')))=lower(trim(?))
        AND extracted_job_title IS ?)) AND received_at BETWEEN ? AND ?`)
        .all(String(mail.subject), name, extractedJobTitle, from, to) as Row[];
      ids.push(...companions.map((row) => Number(row.candidate_id)));
      const contactIds: number[] = [];
      const contacts: Array<['phone' | 'email', string, string]> = [];
      if (phone) contacts.push(['phone', normalizePhone(phone), phone]);
      if (email) contacts.push(['email', normalizeEmail(email), email]);
      for (const [type, value] of contacts) {
        const row = this.db.prepare('SELECT candidate_id FROM candidate_contacts WHERE contact_type=? AND normalized_value=?')
          .get(type, value) as Row | undefined;
        if (row) contactIds.push(Number(row.candidate_id));
      }
      ids.push(...contactIds);
      if (new Set(contactIds).size > 1) return mail.candidate_id == null ? null : Number(mail.candidate_id);
      const uniqueIds = [...new Set(ids)];
      if (!uniqueIds.length) return null;
      let targetId = [...new Set(contactIds)][0] ?? uniqueIds[0];
      if (!contactIds.length && uniqueIds.length > 1) {
        const candidates = uniqueIds.map((id) => {
          const row = this.db.prepare(`SELECT MAX(e.received_at) AS latest,
            MAX(CASE WHEN a.document_type='resume' THEN 1 ELSE 0 END) AS has_resume
            FROM resume_emails e LEFT JOIN resume_attachments a ON a.resume_email_id=e.id WHERE e.candidate_id=?`).get(id) as Row;
          return { id, latest: String(row.latest ?? ''), hasResume: Number(row.has_resume ?? 0) };
        }).sort((a, b) => b.hasResume - a.hasResume || b.latest.localeCompare(a.latest));
        targetId = candidates[0].id;
      }
      for (const sourceId of uniqueIds.filter((id) => id !== targetId)) {
        const source = this.db.prepare('SELECT resume_json FROM candidates WHERE id=?').get(sourceId) as Row | undefined;
        if (parseJson<Record<string, unknown>>(source?.resume_json, {}).source !== 'mail') continue;
        this.db.prepare(`DELETE FROM candidate_contacts WHERE candidate_id=? AND EXISTS(
          SELECT 1 FROM candidate_contacts t WHERE t.candidate_id=? AND t.contact_type=candidate_contacts.contact_type
          AND t.normalized_value=candidate_contacts.normalized_value)`).run(sourceId, targetId);
        this.db.prepare('UPDATE candidate_contacts SET candidate_id=? WHERE candidate_id=?').run(targetId, sourceId);
        this.db.prepare('UPDATE evaluations SET candidate_id=? WHERE candidate_id=?').run(targetId, sourceId);
        this.db.prepare('UPDATE resume_emails SET candidate_id=? WHERE candidate_id=?').run(targetId, sourceId);
        this.db.prepare(`DELETE FROM candidates WHERE id=? AND NOT EXISTS(SELECT 1 FROM resume_emails WHERE candidate_id=?)
          AND NOT EXISTS(SELECT 1 FROM evaluations WHERE candidate_id=?)`).run(sourceId, sourceId, sourceId);
      }
      const now = nowIso();
      for (const [type, value, display] of contacts) {
        this.db.prepare(`INSERT INTO candidate_contacts
          (candidate_id,contact_type,normalized_value,display_value,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(contact_type,normalized_value) DO UPDATE SET candidate_id=excluded.candidate_id,last_seen_at=excluded.last_seen_at`)
          .run(targetId, type, value, display, now, now);
      }
      const latest = this.db.prepare(`SELECT a.parsed_text FROM resume_emails e JOIN resume_attachments a ON a.resume_email_id=e.id
        WHERE e.candidate_id=? AND a.document_type='resume' AND a.parsed_text IS NOT NULL
        ORDER BY e.received_at DESC,a.id DESC LIMIT 1`).get(targetId) as Row | undefined;
      const effective = String(latest?.parsed_text || resumeText || '');
      if (effective) {
        const candidate = this.db.prepare('SELECT resume_json FROM candidates WHERE id=?').get(targetId) as Row;
        const resumeJson = parseJson<Record<string, unknown>>(candidate.resume_json, {});
        resumeJson.resumeText = effective;
        this.db.prepare('UPDATE candidates SET resume_text=?,resume_json=?,last_seen_at=? WHERE id=?')
          .run(effective, JSON.stringify(resumeJson), now, targetId);
      }
      return targetId;
    });
  }

  async updateProcessing(id: number, input: {
    jobId: number | null; jobTitle: string | null; status: MailProcessingStatus;
    error: string | null; evaluation?: { score: number; reason: string; matchedSkills?: string[] };
  }): Promise<void> {
    this.database.transaction(() => {
      const result = this.db.prepare(`UPDATE resume_emails SET matched_job_id=?,matched_job_title=?,
        processing_status=?,processing_error=?,updated_at=? WHERE id=?`)
        .run(input.jobId, input.jobTitle, input.status, input.error, nowIso(), id);
      if (!result.changes) throw new Error('简历邮件不存在');
      if (!input.evaluation) return;
      const row = this.db.prepare('SELECT candidate_id,message_id,mailbox_key,uid_validity,uid FROM resume_emails WHERE id=?')
        .get(id) as Row;
      if (row.candidate_id == null) return;
      const resume = this.db.prepare(`SELECT parsed_text FROM resume_attachments WHERE resume_email_id=?
        AND document_type='resume' ORDER BY length(COALESCE(parsed_text,'')) DESC LIMIT 1`).get(id) as Row | undefined;
      if (!resume) return;
      this.db.prepare(`INSERT INTO evaluations
        (candidate_id,job_title,ai_score,ai_reason,matched_skills,status,stage,resume_snapshot,source_event_id,created_at)
        VALUES(?,?,?,?,?,'evaluated','mail_ai',?,?,?) ON CONFLICT(source_event_id) DO UPDATE SET
        job_title=excluded.job_title,ai_score=excluded.ai_score,ai_reason=excluded.ai_reason,
        matched_skills=excluded.matched_skills,resume_snapshot=excluded.resume_snapshot`)
        .run(Number(row.candidate_id), input.jobTitle, input.evaluation.score, input.evaluation.reason,
          JSON.stringify(input.evaluation.matchedSkills ?? []), String(resume.parsed_text ?? ''),
          `mail:${row.message_id || `${row.mailbox_key}:${row.uid_validity}:${row.uid}`}`, nowIso());
    });
  }
}
