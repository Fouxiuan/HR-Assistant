import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateCard, Settings } from '../shared/contracts.js';
import { JobRunner } from '../src/core/runner.js';
import type { JobRunnerDeps, LoggerPort, ScannerPort } from '../src/core/ports.js';
import { NoopCandidateRepository } from '../src/db/repository.js';

const jobDefinition = {
  id: 1, title: 'Operations', content: 'JD', sourceFilename: 'operations.md',
  updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'test',
};

const settings: Settings = {
  selectedJob: 'Operations', bossJobTitle: 'Operations', bossFilters: {},
  minScore: 80, totalGreetTarget: 1, maxEmptyScrolls: 0,
  actionDelayMs: 0, maxCandidates: 1,
  scanIntervalSec: 0, evaluateIntervalSec: 0, greetIntervalSec: 0, closeDetailIntervalSec: 0,
};

function dependencies(overrides: Partial<JobRunnerDeps> = {}): JobRunnerDeps {
  const logger: LoggerPort = {
    info: vi.fn(), step: vi.fn(), action: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(),
    onLog() { return () => undefined; }, getLogs() { return []; },
  };
  const scanner: ScannerPort = {
    async configurePage() { return { success: true, job: 'Operations' }; },
    async detectPageJobTitle() { return 'Operations'; },
    async scanCards() { return []; }, async scrollToLoadMore() { return false; },
    async clickCard() { return true; }, async extractResume() { return 'resume'; }, async closeDetail() { return true; },
  };
  return {
    logger,
    browser: { async connect() {}, async navigate() {}, async press() {}, async eval() {} },
    jobs: {
      jds: [jobDefinition],
      async loadAll() { return this.jds; },
      getCatalog() { return { items: this.jds, source: 'database' as const, writable: true }; },
      async save() { return this.jds[0]; },
      matchJob() { return this.jds[0]; },
      getThreshold() { return 80; },
    },
    scanner,
    scorer: { async score() { return { score: 90, reason: 'matched' }; } },
    greeter: { async greet() { return { success: true }; } },
    settings: { get() { return settings; }, update(partial) { return { ...settings, ...partial }; } },
    candidates: new NoopCandidateRepository(),
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe('JobRunner lifecycle', () => {
  it('rejects a second start while navigation is still in progress and supports explicit stop', async () => {
    const connect = vi.fn(() => new Promise<void>(() => undefined));
    const runner = new JobRunner(dependencies({
      browser: { connect, async navigate() {}, async press() {}, async eval() {} },
    }));

    expect(await runner.start({ selectedJob: 'Operations', bossJobTitle: 'Operations', bossFilters: {} }))
      .toMatchObject({ success: true, phase: 'navigating' });
    expect(await runner.start({ selectedJob: 'Operations', bossJobTitle: 'Operations', bossFilters: {} }))
      .toMatchObject({ success: false });
    runner.stop();
    expect(runner.getStatus()).toMatchObject({ isRunning: false, phase: 'stopped' });
  });

  it('finishes even when the optional repository fails', async () => {
    vi.useFakeTimers();
    const candidate: CandidateCard = {
      index: 0, name: 'Too young', salary: '', age: '18', years: '', education: '', status: '',
      expected: '', advantage: '', tags: [], fullText: '18 years old',
    };
    let scanned = false;
    const base = dependencies();
    const runner = new JobRunner(dependencies({
      scanner: {
        ...base.scanner,
        async scanCards() { if (scanned) return []; scanned = true; return [candidate]; },
      },
      candidates: {
        available: true,
        unavailableReason: '',
        async startRun() { throw new Error('database down'); },
        async finishRun() { throw new Error('database down'); },
        async upsertCandidate() { throw new Error('database down'); },
        async addEvaluation() { throw new Error('database down'); },
        async markGreeted() {}, async list() { throw new Error('database down'); },
        async stats() { throw new Error('database down'); }, async getById() { throw new Error('database down'); },
      },
    }));

    await runner.start({ selectedJob: 'Operations', bossJobTitle: 'Operations', bossFilters: {} });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(runner.getStatus().phase).toBe('done'));
    expect(runner.getResults()).toHaveLength(1);
  });

  it('does not greet after stop is requested during AI scoring', async () => {
    vi.useFakeTimers();
    const candidate: CandidateCard = {
      index: 0, name: 'Candidate', salary: '', age: '26岁', years: '3年', education: '本科', status: '',
      expected: 'Operations 运营', advantage: 'matched', tags: [], fullText: 'Candidate Operations 运营 matched resume',
    };
    let scans = 0;
    let releaseScore: ((value: { score: number; reason: string }) => void) | undefined;
    const score = vi.fn(() => new Promise<{ score: number; reason: string }>(resolve => { releaseScore = resolve; }));
    const greet = vi.fn(async () => ({ success: true }));
    const base = dependencies();
    const runner = new JobRunner(dependencies({
      scanner: { ...base.scanner, async scanCards() { return scans++ === 0 ? [candidate] : []; } },
      jobs: { ...base.jobs, jds: [{ ...jobDefinition, content: '运营' }] },
      scorer: { score },
      greeter: { greet },
    }));

    await runner.start({ selectedJob: 'Operations', bossJobTitle: 'Operations', bossFilters: {} });
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(score).toHaveBeenCalledOnce());
    runner.stop();
    releaseScore?.({ score: 99, reason: 'matched' });
    await vi.runAllTimersAsync();
    expect(greet).not.toHaveBeenCalled();
    expect(runner.getStatus().phase).toBe('stopped');
  });
});
