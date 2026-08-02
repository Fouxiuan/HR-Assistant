import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImportMailInput } from '../src/mail/repository.js';
import { LocalDatabase } from '../src/db/localDatabase.js';
import { SQLiteJobDescriptionRepository } from '../src/db/sqliteJobDescriptionRepository.js';
import { SQLiteMailRepository } from '../src/mail/sqliteRepository.js';

let directory: string;
let database: LocalDatabase;
let jobs: SQLiteJobDescriptionRepository;
let mail: SQLiteMailRepository;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'hr-sqlite-mail-')); database = new LocalDatabase(join(directory, 'test.sqlite')); jobs = new SQLiteJobDescriptionRepository(database); mail = new SQLiteMailRepository(database); });
afterEach(() => { try { database.close(); } catch {} rmSync(directory, { recursive: true, force: true }); });

function input(uid = 1, overrides: Partial<ImportMailInput> = {}): ImportMailInput {
  const pdf = Buffer.from(`pdf-${uid}`); const hash = createHash('sha256').update(pdf).digest('hex');
  return {
    mailboxKey: 'mailbox', uidValidity: 10, uid, messageId: `<${uid}@test>`, subject: `候选人 ${uid}`,
    sender: 'boss@test', recipient: 'hr@test', receivedAt: new Date(`2026-01-${String(uid).padStart(2, '0')}T00:00:00Z`),
    textBody: '简历', parsedFields: { name: '张三' }, extractedJobTitle: '运营', matchedJob: null,
    card: { index: 0, name: '张三', salary: '', age: '', years: '5年', education: '本科', status: '', expected: '运营', advantage: '', tags: [], fullText: '张三' },
    resumeText: '张三简历', phone: '13800138000', email: 'zhang@example.com',
    attachments: [{ filename: 'resume.pdf', contentType: 'application/pdf', size: pdf.length, sha256: hash, content: pdf, text: '张三简历', parseError: null, documentType: 'resume' }],
    status: 'pending_job', error: null, ...overrides,
  };
}

describe('SQLite JD and mail repositories', () => {
  it('creates, lists, upserts and updates JD records', async () => {
    const created = await jobs.upsert({ title: '运营', content: '# 运营' });
    const upserted = await jobs.upsert({ title: '运营', content: '# 新运营' });
    const updated = await jobs.update(created.id!, { title: '高级运营', content: '# 高级运营' });
    expect(upserted.id).toBe(created.id);
    expect(updated?.title).toBe('高级运营');
    expect(await jobs.list()).toHaveLength(1);
  });

  it('keeps mail import idempotent by UID and message ID', async () => {
    const first = await mail.importMessage(input());
    const duplicate = await mail.importMessage(input());
    const duplicateMessage = await mail.importMessage(input(2, { messageId: '<1@test>' }));
    expect(first.inserted).toBe(true); expect(duplicate.inserted).toBe(false); expect(duplicateMessage.inserted).toBe(false);
    expect((await mail.list({})).total).toBe(1);
  });

  it('stores and returns PDF attachment bytes', async () => {
    const result = await mail.importMessage(input());
    const detail = await mail.getMessage(result.id);
    const attachment = await mail.getAttachment(detail!.attachments[0].id);
    expect(attachment?.data.toString()).toBe('pdf-1');
    expect(attachment?.contentType).toBe('application/pdf');
  });

  it('merges repeated contacts into the same candidate', async () => {
    const first = await mail.importMessage(input(1));
    const second = await mail.importMessage(input(2, { messageId: '<2@test>', subject: '另一封简历' }));
    expect(second.candidateId).toBe(first.candidateId);
    expect(await mail.getCandidateSources(first.candidateId!)).toHaveLength(2);
  });

  it('tracks baseline and sync state without moving the UID backwards', async () => {
    await mail.saveBaseline('mailbox', 10, 20);
    await mail.saveSyncResult('mailbox', { uidValidity: 10, lastUid: 19, importedDelta: 2 });
    expect(await mail.getSyncState('mailbox')).toMatchObject({ uidValidity: 10, lastUid: 20, importedCount: 2, requiresRebaseline: false });
  });

  it('cascades attachment deletion with its email', async () => {
    await mail.importMessage(input());
    database.connection.prepare('DELETE FROM resume_emails').run();
    expect((database.connection.prepare('SELECT COUNT(*) AS count FROM resume_attachments').get() as { count: number }).count).toBe(0);
  });

  it('updates processing and records an AI evaluation', async () => {
    const job = await jobs.upsert({ title: '运营', content: '# 运营' });
    const item = await mail.importMessage(input());
    await mail.updateProcessing(item.id, { jobId: job.id, jobTitle: job.title, status: 'imported', error: null, evaluation: { score: 91, reason: '匹配', matchedSkills: ['运营'] } });
    expect(await mail.getMessage(item.id)).toMatchObject({ status: 'imported', matchedJobTitle: '运营' });
    expect((database.connection.prepare('SELECT ai_score FROM evaluations').get() as { ai_score: number }).ai_score).toBe(91);
  });
});
