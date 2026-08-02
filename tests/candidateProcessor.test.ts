import { describe, expect, it, vi } from 'vitest';
import type { CandidateCard } from '../shared/contracts.js';
import { CandidateProcessor, type MatcherPort } from '../src/core/candidateProcessor.js';
import type { LoggerPort, ScannerPort, ScorerPort } from '../src/core/ports.js';

const card: CandidateCard = {
  index: 0,
  name: 'Candidate',
  salary: '',
  age: '26',
  years: '3 years',
  education: 'Bachelor',
  status: '',
  expected: 'Operations',
  advantage: '',
  tags: [],
  fullText: 'Candidate resume card',
};

const logger: LoggerPort = {
  info() {}, step() {}, action() {}, success() {}, warn() {}, error() {},
  onLog() { return () => undefined; },
  getLogs() { return []; },
};

function scanner(overrides: Partial<ScannerPort> = {}): ScannerPort {
  return {
    async configurePage() { return { success: true }; },
    async detectPageJobTitle() { return 'Operations'; },
    async scanCards() { return []; },
    async scrollToLoadMore() { return false; },
    async clickCard() { return true; },
    async extractResume() { return 'A sufficiently detailed candidate resume for scoring.'; },
    async closeDetail() { return true; },
    ...overrides,
  };
}

const scorer: ScorerPort = {
  async score() { return { score: 90, reason: 'matched', matchedSkills: ['operations'] }; },
};

function matcher(agePassed = true, keywordPassed = true): MatcherPort {
  return {
    ageFilter: () => ({ passed: agePassed, detail: agePassed ? 'ok' : 'age rejected' }),
    keywordFilter: () => ({ passed: keywordPassed, detail: keywordPassed ? 'ok' : 'keyword rejected' }),
  };
}

describe('CandidateProcessor', () => {
  it('rejects on age before opening details', async () => {
    const clickCard = vi.fn(async () => true);
    const processor = new CandidateProcessor(logger, scanner({ clickCard }), scorer);
    const result = await processor.process(card, matcher(false), { title: 'Operations', content: 'JD' }, 80);

    expect(result).toMatchObject({ kind: 'result', entry: { stage: 'age', status: 'rejected' } });
    expect(clickCard).not.toHaveBeenCalled();
  });

  it('rejects on keyword before AI scoring', async () => {
    const score = vi.fn(async () => ({ score: 90, reason: 'matched' }));
    const processor = new CandidateProcessor(logger, scanner(), { score });
    const result = await processor.process(card, matcher(true, false), { title: 'Operations', content: 'JD' }, 80);

    expect(result).toMatchObject({ kind: 'result', entry: { stage: 'keyword', status: 'rejected' } });
    expect(score).not.toHaveBeenCalled();
  });

  it('records an AI rejection below the job threshold', async () => {
    const processor = new CandidateProcessor(logger, scanner(), {
      async score() { return { score: 70, reason: 'below threshold' }; },
    });
    const result = await processor.process(card, matcher(), { title: 'Operations', content: 'JD' }, 80);

    expect(result).toMatchObject({ kind: 'result', entry: { stage: 'ai', score: 70 } });
  });

  it('stops the flow when the detail panel cannot be closed', async () => {
    const processor = new CandidateProcessor(logger, scanner({ closeDetail: async () => false }), scorer);
    await expect(processor.process(card, matcher(), { title: 'Operations', content: 'JD' }, 80))
      .rejects.toThrow(/Candidate/);
  });
});
