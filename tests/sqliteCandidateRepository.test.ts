import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CandidateCard } from '../shared/contracts.js';
import { LocalDatabase } from '../src/db/localDatabase.js';
import { SQLiteCandidateRepository } from '../src/db/sqliteCandidateRepository.js';

let directory: string;
let database: LocalDatabase;
let repository: SQLiteCandidateRepository;
const card = (name = '张三'): CandidateCard => ({ index: 0, sourceId: `source-${name}`, name, salary: '15-20K', age: '28岁', years: '5年', education: '本科', status: '', expected: '运营', advantage: '电商经验', tags: ['电商'], fullText: `${name} 本科 5年 电商` });

beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'hr-sqlite-candidates-')); database = new LocalDatabase(join(directory, 'test.sqlite')); repository = new SQLiteCandidateRepository(database); });
afterEach(() => { try { database.close(); } catch {} rmSync(directory, { recursive: true, force: true }); });

describe('SQLiteCandidateRepository', () => {
  it('creates and completes a run lifecycle', async () => {
    const id = await repository.startRun('运营', 'BOSS 运营');
    await repository.finishRun(id, 'done', 3);
    expect(database.connection.prepare('SELECT status,greeted_count,ended_at FROM runs WHERE id=?').get(id)).toMatchObject({ status: 'done', greeted_count: 3 });
  });

  it('deduplicates the same candidate and keeps the latest resume', async () => {
    const first = await repository.upsertCandidate(card(), '旧简历');
    const second = await repository.upsertCandidate(card(), '新简历');
    expect(second).toBe(first);
    expect((await repository.getById(first))?.resumeText).toBe('新简历');
  });

  it('stores evaluations and returns the latest one', async () => {
    const id = await repository.upsertCandidate(card());
    await repository.addEvaluation({ candidateId: id, jobTitle: '运营', aiScore: 88, aiReason: '匹配', matchedSkills: ['电商'], status: 'evaluated', stage: 'ai' });
    const detail = await repository.getById(id);
    expect(detail?.evaluations[0]).toMatchObject({ aiScore: 88, matchedSkills: ['电商'] });
  });

  it('supports search, score filters, sorting and pagination', async () => {
    for (const [index, name] of ['张三', '李四', '王五'].entries()) {
      const id = await repository.upsertCandidate(card(name));
      await repository.addEvaluation({ candidateId: id, jobTitle: '运营', aiScore: 70 + index * 10, status: 'evaluated', stage: 'ai' });
    }
    const result = await repository.list({ search: '李四', minScore: 75, page: 1, pageSize: 1, sort: 'score_desc' });
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 1, items: [{ name: '李四' }] });
  });

  it('calculates candidate and failure statistics', async () => {
    const greeted = await repository.upsertCandidate(card('已招呼'));
    const failed = await repository.upsertCandidate(card('失败'));
    await repository.addEvaluation({ candidateId: greeted, jobTitle: '运营', aiScore: 90, status: 'greeted', stage: 'greet' });
    await repository.addEvaluation({ candidateId: failed, jobTitle: '运营', aiScore: 50, status: 'rejected', stage: 'ai_threshold', detail: '分数不足' });
    expect(await repository.stats()).toMatchObject({ total: 2, greeted: 1, avgScore: 70 });
    expect(await repository.failureStats()).toMatchObject({ totalFailed: 1, totalGreeted: 1 });
  });

  it('rolls back a failed transaction', () => {
    expect(() => database.transaction(() => { database.connection.prepare("INSERT INTO app_meta(key,value,updated_at) VALUES('x','1','now')").run(); throw new Error('stop'); })).toThrow('stop');
    expect(database.getMeta('x')).toBeNull();
  });

  it('persists records after a database restart', async () => {
    const id = await repository.upsertCandidate(card('重启候选人'), '持久简历');
    database.close();
    database = new LocalDatabase(join(directory, 'test.sqlite'));
    repository = new SQLiteCandidateRepository(database);
    expect(await repository.getById(id)).toMatchObject({ name: '重启候选人', resumeText: '持久简历' });
  });
});
