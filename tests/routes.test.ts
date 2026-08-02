import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { JobDescription, KeywordConfig, ResultEntry, RunStatus, Settings, StartResult } from '../shared/contracts.js';
import { LocalDatabase } from '../src/db/localDatabase.js';
import { SQLiteCandidateRepository } from '../src/db/sqliteCandidateRepository.js';
import { SQLiteJobDescriptionRepository } from '../src/db/sqliteJobDescriptionRepository.js';
import type { RouteContext } from '../src/server/context.js';
import { createApp } from '../src/server/app.js';

const resources: Array<{ database: LocalDatabase; directory: string }> = [];
afterEach(() => { for (const item of resources.splice(0)) { try { item.database.close(); } catch {} rmSync(item.directory, { recursive: true, force: true }); } });
const defaultKeywords: KeywordConfig = { excludeKeywords: [], genericWords: [], skillLibrary: [], preferredCompanies: [], matchThreshold: 3 };

function context(): RouteContext {
  const directory = mkdtempSync(join(tmpdir(), 'hr-routes-')); const database = new LocalDatabase(join(directory, 'test.sqlite')); resources.push({ database, directory });
  const jobDescriptions = new SQLiteJobDescriptionRepository(database); const candidates = new SQLiteCandidateRepository(database);
  let settings: Settings = { selectedJob: '测试岗位', bossJobTitle: 'BOSS 测试岗位', bossFilters: {}, candidateAgeMin: 23, candidateAgeMax: 35, minScore: 80, totalGreetTarget: 20, maxEmptyScrolls: 3, actionDelayMs: 3000, maxCandidates: 50 };
  let keywords = defaultKeywords; let status: RunStatus = { isRunning: false, phase: 'idle', message: '就绪', results: 0 }; const results: ResultEntry[] = [];
  const jobs: JobDescription[] = [];
  return {
    logger: { info() {}, step() {}, action() {}, success() {}, warn() {}, error() {}, onLog() { return () => undefined; }, getLogs() { return []; } },
    browser: { async connect() {}, async navigate() {}, async press() {}, async eval() { return JSON.stringify({ loggedIn: true }); }, async getCookies() { return 'cookie'; }, async injectCookies() {} },
    jobs: {
      jds: jobs, async loadAll() { const listed = await jobDescriptions.list(); this.jds = listed; return listed; },
      getCatalog() { return { items: this.jds, source: 'database', writable: true }; },
      async save(value, id) { const input = value as { title: string; content: string }; const item = id == null ? await jobDescriptions.upsert(input) : await jobDescriptions.update(id, input); if (!item) throw new Error('missing'); await this.loadAll(); return item; },
      matchJob() { return this.jds[0] || null; }, getThreshold() { return 80; },
    },
    greeter: { async greet() { return { success: true }; } },
    runner: { async start(): Promise<StartResult> { status = { ...status, isRunning: true, phase: 'navigating' }; return { success: true, phase: 'navigating' }; }, stop() { status = { ...status, isRunning: false, phase: 'stopped' }; }, getStatus() { return status; }, getResults() { return results; }, markGreeted() {} },
    candidates, database, jobDescriptions,
    mail: { available: true, start() {}, async close() {}, async status() { return { available: true, configured: false, enabled: false, syncing: false, provider: '163' as const, mailbox: 'INBOX', lastSyncedAt: null, lastUid: null, importedCount: 0, requiresRebaseline: false, lastError: null }; }, async syncNow() { return this.status(); }, async testConnection() {}, async testAI() {}, async rebaseline() { return this.status(); }, async importExisting() { return this.status(); }, async list(params) { return { total: 0, page: params.page ?? 1, pageSize: params.pageSize ?? 10, items: [] }; }, async getMessage() { return null; }, async getCandidateSources() { return []; }, async getAttachment() { return null; }, async reprocess() { return null; } },
    settings: { get() { return settings; }, update(partial) { settings = { ...settings, ...partial }; return settings; } },
    keywords: { getJobConfig() { return keywords; }, getConfiguredJobs() { return []; }, updateJobConfig(_job, partial) { keywords = { ...keywords, ...partial }; return keywords; } },
  };
}

describe('standalone API contracts', () => {
  it('preserves run, settings, keyword and result endpoints', async () => {
    const app = createApp(context(), { serveUi: false });
    const calls = await Promise.all([request(app).get('/api/jobs'), request(app).get('/api/settings'), request(app).post('/api/settings').send({ minScore: 88 }), request(app).post('/api/start').send({ job: '测试岗位' }), request(app).post('/api/stop'), request(app).get('/api/results'), request(app).get('/api/logs')]);
    expect(calls.every(response => response.status === 200)).toBe(true);
    expect(calls[3].body).toMatchObject({ success: true, phase: 'navigating' });
  });

  it('lists, creates and updates local JD records', async () => {
    const app = createApp(context(), { serveUi: false });
    const created = await request(app).post('/api/job-descriptions').send({ title: '运营', content: '# 运营' });
    const updated = await request(app).put(`/api/job-descriptions/${created.body.item.id}`).send({ title: '高级运营', content: '# 高级运营' });
    const catalog = await request(app).get('/api/job-descriptions');
    expect(created.status).toBe(201); expect(updated.body.item.title).toBe('高级运营'); expect(catalog.body).toMatchObject({ source: 'database', items: [{ title: '高级运营' }] });
  });

  it('persists and reads candidate records through local APIs', async () => {
    const routeContext = context(); const card = { index: 0, name: '候选人', salary: '', age: '', years: '3年', education: '本科', status: '', expected: '运营', advantage: '', tags: [], fullText: '候选人' };
    const id = await routeContext.candidates.upsertCandidate(card, '简历'); await routeContext.candidates.addEvaluation({ candidateId: id, jobTitle: '运营', aiScore: 92, status: 'evaluated', stage: 'ai' });
    const app = createApp(routeContext, { serveUi: false });
    expect((await request(app).get('/api/candidates')).body).toMatchObject({ total: 1, items: [{ name: '候选人' }] });
    expect((await request(app).get(`/api/candidates/${id}`)).body).toMatchObject({ resumeText: '简历' });
  });

  it('returns 404 for every removed center endpoint', async () => {
    const app = createApp(context(), { serveUi: false });
    for (const path of ['/api/account/status', '/api/ingest/ping', '/api/upload/results', '/api/ai-config/test-server', '/api/mail/admin/import-existing']) expect((await request(app).get(path)).status).toBe(404);
  });

  it('does not expose removed setup endpoints', async () => {
    const app = createApp(context(), { serveUi: false });
    expect((await request(app).get('/api/setup/status')).status).toBe(404);
    for (const path of ['/api/setup/boss/open', '/api/setup/boss/verify', '/api/setup/complete']) {
      expect((await request(app).post(path)).status).toBe(404);
    }
  });

  it('registers backup, local data and SSE routes', () => {
    const app = createApp(context(), { serveUi: false }) as ReturnType<typeof createApp> & { _router: { stack: Array<{ route?: { path: string } }> } };
    const paths = app._router.stack.flatMap(layer => layer.route ? [layer.route.path] : []);
    expect(paths).toEqual(expect.arrayContaining(['/api/data/backup/status', '/api/data/backup/export', '/api/data/backup/restore', '/api/candidates', '/api/mail/messages', '/api/logs/stream']));
    expect(paths.some(path => path.startsWith('/api/setup/'))).toBe(false);
    expect(paths.some(path => /^\/api\/(account|ingest|upload)/.test(path))).toBe(false);
  });
});
