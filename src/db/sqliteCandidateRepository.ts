import { createHash } from 'node:crypto';
import type {
  CandidateCard,
  CandidateDetail,
  CandidateListResponse,
  CandidateStats,
  FailureStats,
  MailAttachmentMeta,
  MailProcessingStatus,
} from '../../shared/contracts.js';
import { mailAttachmentDisplayName } from '../mail/attachmentName.js';
import { candidateIdentity } from '../core/candidateIdentity.js';
import type {
  CandidateListParams,
  CandidateRepository,
  EvaluationInput,
} from './repository.js';
import { LocalDatabase, nowIso } from './localDatabase.js';

type Row = Record<string, unknown>;

function candidateKey(card: CandidateCard): string {
  return createHash('md5').update(candidateIdentity(card), 'utf8').digest('hex');
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function attachmentMeta(row: Row): MailAttachmentMeta {
  const type = ['resume', 'portfolio'].includes(String(row.document_type))
    ? String(row.document_type) as MailAttachmentMeta['documentType']
    : 'other';
  const id = Number(row.id);
  const filename = String(row.filename);
  return {
    id,
    filename,
    displayFilename: mailAttachmentDisplayName(filename, type, id),
    contentType: String(row.content_type),
    size: Number(row.size_bytes),
    sha256: String(row.sha256),
    parseError: row.parse_error == null ? null : String(row.parse_error),
    textLength: Number(row.text_length ?? 0),
    documentType: type,
    createdAt: String(row.created_at ?? ''),
  };
}

export class SQLiteCandidateRepository implements CandidateRepository {
  readonly available = true;

  constructor(private readonly database: LocalDatabase) {}

  private get db() { return this.database.connection; }

  async startRun(jobTitle: string, bossJobTitle: string): Promise<number> {
    const result = this.db.prepare(
      'INSERT INTO runs(job_title,boss_job_title,started_at,status) VALUES(?,?,?,?)',
    ).run(jobTitle, bossJobTitle, nowIso(), 'running');
    return Number(result.lastInsertRowid);
  }

  async finishRun(runId: number | null, status: string, greetedCount: number): Promise<void> {
    if (runId == null) return;
    this.db.prepare('UPDATE runs SET ended_at=?,status=?,greeted_count=? WHERE id=?')
      .run(nowIso(), status, greetedCount, runId);
  }

  async upsertCandidate(card: CandidateCard, resumeText?: string, resumeJson?: object): Promise<number> {
    const now = nowIso();
    this.db.prepare(`INSERT INTO candidates
      (candidate_key,name,education,years,resume_text,resume_json,raw_card,first_seen_at,last_seen_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(candidate_key) DO UPDATE SET
        last_seen_at=excluded.last_seen_at,
        resume_text=COALESCE(excluded.resume_text,candidates.resume_text),
        resume_json=COALESCE(excluded.resume_json,candidates.resume_json),
        raw_card=COALESCE(excluded.raw_card,candidates.raw_card)`)
      .run(candidateKey(card), card.name, card.education, card.years, resumeText ?? null,
        resumeJson ? JSON.stringify(resumeJson) : null, JSON.stringify(card), now, now);
    const row = this.db.prepare('SELECT id FROM candidates WHERE candidate_key=?').get(candidateKey(card)) as Row;
    return Number(row.id);
  }

  async addEvaluation(input: EvaluationInput): Promise<void> {
    if (input.candidateId == null) return;
    this.db.prepare(`INSERT INTO evaluations
      (candidate_id,run_id,job_title,ai_score,ai_reason,matched_skills,status,stage,detail,resume_snapshot,source_event_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source_event_id) DO UPDATE SET
        candidate_id=excluded.candidate_id,run_id=excluded.run_id,job_title=excluded.job_title,
        ai_score=excluded.ai_score,ai_reason=excluded.ai_reason,matched_skills=excluded.matched_skills,
        status=excluded.status,stage=excluded.stage,detail=excluded.detail,resume_snapshot=excluded.resume_snapshot`)
      .run(input.candidateId, input.runId ?? null, input.jobTitle ?? null, input.aiScore ?? null,
        input.aiReason ?? null, input.matchedSkills ? JSON.stringify(input.matchedSkills) : null,
        input.status, input.stage, input.detail ?? null, input.resumeSnapshot ?? null,
        input.sourceEventId ?? null, nowIso());
  }

  async markGreeted(candidate: CandidateCard): Promise<void> {
    this.db.prepare(`UPDATE evaluations SET status='greeted',stage='manual_greet'
      WHERE id=(SELECT e.id FROM evaluations e JOIN candidates c ON c.id=e.candidate_id
        WHERE c.candidate_key=? AND e.status<>'greeted' ORDER BY e.created_at DESC,e.id DESC LIMIT 1)`)
      .run(candidateKey(candidate));
  }

  async list(params: CandidateListParams): Promise<CandidateListResponse> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 10));
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (params.search) {
      values.push(`%${params.search}%`);
      conditions.push(`(c.name LIKE ? COLLATE NOCASE OR c.education LIKE ? COLLATE NOCASE
        OR c.years LIKE ? COLLATE NOCASE OR COALESCE(c.resume_text,'') LIKE ? COLLATE NOCASE
        OR COALESCE(c.raw_card,'') LIKE ? COLLATE NOCASE)`);
      values.push(values[values.length - 1], values[values.length - 1], values[values.length - 1], values[values.length - 1]);
    }
    if (params.status) { conditions.push('latest.status=?'); values.push(params.status); }
    if (params.job) { conditions.push('latest.job_title=?'); values.push(params.job); }
    if (params.minScore != null && Number.isFinite(params.minScore)) { conditions.push('latest.ai_score>=?'); values.push(params.minScore); }
    if (params.source === 'mail') conditions.push('EXISTS(SELECT 1 FROM resume_emails sm WHERE sm.candidate_id=c.id)');
    if (params.source === 'greet') conditions.push("EXISTS(SELECT 1 FROM evaluations se WHERE se.candidate_id=c.id AND se.stage<>'mail_ai')");
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const join = `LEFT JOIN evaluations latest ON latest.id=(SELECT e.id FROM evaluations e
      WHERE e.candidate_id=c.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1)`;
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM candidates c ${join} ${where}`).get(...values) as Row).count);
    const order = params.sort === 'time_asc' ? 'COALESCE(latest.created_at,c.last_seen_at) ASC'
      : params.sort === 'score_desc' ? 'latest.ai_score IS NULL,latest.ai_score DESC'
      : params.sort === 'score_asc' ? 'latest.ai_score IS NULL,latest.ai_score ASC'
      : 'COALESCE(latest.created_at,c.last_seen_at) DESC';
    const rows = this.db.prepare(`SELECT c.id,c.name,c.education,c.years,c.last_seen_at,
      latest.job_title,latest.ai_score,latest.status,latest.stage,latest.created_at AS evaluated_at,
      EXISTS(SELECT 1 FROM resume_emails me WHERE me.candidate_id=c.id) AS has_mail_source,
      EXISTS(SELECT 1 FROM evaluations ge WHERE ge.candidate_id=c.id AND ge.stage<>'mail_ai') AS has_greet_source
      FROM candidates c ${join} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...values, pageSize, (page - 1) * pageSize) as Row[];
    return { total, page, pageSize, items: rows.map((row) => ({
      id: Number(row.id), name: String(row.name), education: String(row.education), years: String(row.years),
      lastSeenAt: String(row.last_seen_at), hasMailSource: Boolean(row.has_mail_source), hasGreetSource: Boolean(row.has_greet_source),
      latest: { jobTitle: row.job_title == null ? null : String(row.job_title), aiScore: row.ai_score == null ? null : Number(row.ai_score),
        status: row.status == null ? null : String(row.status), stage: row.stage == null ? null : String(row.stage),
        createdAt: String(row.evaluated_at ?? row.last_seen_at) },
    })) };
  }

  async getById(id: number): Promise<CandidateDetail | null> {
    const candidate = this.db.prepare(`SELECT id,name,education,years,resume_text,resume_json,raw_card,
      first_seen_at,last_seen_at FROM candidates WHERE id=?`).get(id) as Row | undefined;
    if (!candidate) return null;
    const evaluations = this.db.prepare(`SELECT id,job_title,ai_score,ai_reason,matched_skills,status,stage,detail,created_at
      FROM evaluations WHERE candidate_id=? ORDER BY created_at DESC,id DESC`).all(id) as Row[];
    const mails = this.db.prepare(`SELECT id,subject,sender,received_at,processing_status,matched_job_title
      FROM resume_emails WHERE candidate_id=? ORDER BY received_at DESC,id DESC`).all(id) as Row[];
    return {
      id: Number(candidate.id), name: String(candidate.name), education: String(candidate.education), years: String(candidate.years),
      resumeText: candidate.resume_text == null ? null : String(candidate.resume_text),
      resumeJson: json<Record<string, unknown> | null>(candidate.resume_json, null),
      rawCard: json<CandidateCard | null>(candidate.raw_card, null), firstSeenAt: String(candidate.first_seen_at), lastSeenAt: String(candidate.last_seen_at),
      evaluations: evaluations.map((row) => ({ id: Number(row.id), jobTitle: row.job_title == null ? null : String(row.job_title),
        aiScore: row.ai_score == null ? null : Number(row.ai_score), aiReason: row.ai_reason == null ? null : String(row.ai_reason),
        matchedSkills: json<string[]>(row.matched_skills, []), status: String(row.status ?? ''), stage: String(row.stage ?? ''),
        detail: row.detail == null ? null : String(row.detail), createdAt: String(row.created_at) })),
      mailSources: mails.map((mail) => ({ messageId: Number(mail.id), subject: String(mail.subject), sender: String(mail.sender),
        receivedAt: String(mail.received_at), status: String(mail.processing_status) as MailProcessingStatus,
        matchedJobTitle: mail.matched_job_title == null ? null : String(mail.matched_job_title),
        attachments: (this.db.prepare(`SELECT id,filename,content_type,size_bytes,sha256,parse_error,
          length(COALESCE(parsed_text,'')) AS text_length,document_type,created_at FROM resume_attachments
          WHERE resume_email_id=? ORDER BY id`).all(Number(mail.id)) as Row[]).map(attachmentMeta) })),
    };
  }

  async stats(): Promise<CandidateStats> {
    const total = Number((this.db.prepare('SELECT COUNT(*) AS count FROM candidates').get() as Row).count);
    const greeted = Number((this.db.prepare("SELECT COUNT(DISTINCT candidate_id) AS count FROM evaluations WHERE status='greeted'").get() as Row).count);
    const average = (this.db.prepare(`SELECT ROUND(AVG(e.ai_score),1) AS average FROM evaluations e
      WHERE e.ai_score IS NOT NULL AND e.id=(SELECT x.id FROM evaluations x WHERE x.candidate_id=e.candidate_id
      AND x.ai_score IS NOT NULL ORDER BY x.created_at DESC,x.id DESC LIMIT 1)`).get() as Row).average;
    const byJob = this.db.prepare(`SELECT e.job_title,COUNT(*) AS count FROM evaluations e
      WHERE e.job_title IS NOT NULL AND e.id=(SELECT x.id FROM evaluations x WHERE x.candidate_id=e.candidate_id
      AND x.job_title IS NOT NULL ORDER BY x.created_at DESC,x.id DESC LIMIT 1)
      GROUP BY e.job_title ORDER BY count DESC`).all() as Row[];
    return { total, greeted, avgScore: average == null ? null : Number(average),
      byJob: byJob.map((row) => ({ jobTitle: String(row.job_title), count: Number(row.count) })) };
  }

  async failureStats(): Promise<FailureStats> {
    const totalGreeted = Number((this.db.prepare("SELECT COUNT(*) AS count FROM evaluations WHERE status='greeted'").get() as Row).count);
    const rows = this.db.prepare(`SELECT status,stage,COALESCE(NULLIF(detail,''),'(无详情)') AS detail,COUNT(*) AS count
      FROM evaluations WHERE status<>'greeted' GROUP BY status,stage,COALESCE(NULLIF(detail,''),'(无详情)')
      ORDER BY count DESC LIMIT 50`).all() as Row[];
    const byReason = rows.map((row) => ({ status: String(row.status), stage: String(row.stage),
      detail: row.detail == null ? null : String(row.detail), count: Number(row.count) }));
    return { totalFailed: byReason.reduce((sum, row) => sum + row.count, 0), totalGreeted, byReason };
  }
}
