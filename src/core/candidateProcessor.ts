import type {
  CandidateCard,
  ResultEntry,
  ResultStage,
  ResultStatus,
} from '../../shared/contracts.js';
import type { EvaluationInput } from '../db/repository.js';
import type { LoggerPort, ScannerPort, ScorerPort } from './ports.js';
import type { ProcessedCandidate } from './processedCandidate.js';

interface FilterResult {
  passed: boolean;
  detail: string;
}

export interface MatcherPort {
  ageFilter(card: CandidateCard): FilterResult;
  keywordFilter(card: CandidateCard): FilterResult;
}

interface RecordedResult {
  kind: 'result';
  entry: ResultEntry;
  evaluation: Omit<EvaluationInput, 'candidateId' | 'runId' | 'jobTitle'>;
  resumeText?: string;
}

interface AcceptedResult {
  kind: 'accepted';
  candidate: ProcessedCandidate;
}

export type CandidateProcessResult = RecordedResult | AcceptedResult;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('运行已停止', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('运行已停止', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function resultEntry(
  card: CandidateCard,
  status: ResultStatus,
  stage: ResultStage,
  reason: string,
  score?: number,
): ResultEntry {
  return { ...card, status, stage, reason, score, timestamp: new Date().toISOString() };
}

export class CandidateProcessor {
  constructor(
    private readonly logger: LoggerPort,
    private readonly scanner: ScannerPort,
    private readonly scorer: ScorerPort,
  ) {}

  async process(
    card: CandidateCard,
    matcher: MatcherPort,
    jd: { title: string; content: string },
    threshold: number,
    intervals?: { evaluate?: number; closeDetail?: number },
    signal?: AbortSignal,
  ): Promise<CandidateProcessResult> {
    throwIfAborted(signal);
    const age = matcher.ageFilter(card);
    if (!age.passed) {
      this.logger.info(`跳过 ${card.name}: ${age.detail}`);
      return {
        kind: 'result',
        entry: resultEntry(card, 'rejected', 'age', age.detail),
        evaluation: { status: 'rejected', stage: 'age', detail: age.detail },
      };
    }

    const keyword = matcher.keywordFilter(card);
    if (!keyword.passed) {
      return {
        kind: 'result',
        entry: resultEntry(card, 'rejected', 'keyword', keyword.detail),
        evaluation: { status: 'rejected', stage: 'keyword', detail: keyword.detail },
      };
    }

    this.logger.info(`查看详情: ${card.name}`);
    if (!await this.scanner.clickCard(card)) {
      const detail = '无法打开简历详情';
      return {
        kind: 'result',
        entry: resultEntry(card, 'error', 'detail_open', detail),
        evaluation: { status: 'error', stage: 'detail_open', detail },
      };
    }

    let resumeText = '';
    let aiResult;
    let closed = false;
    try {
      throwIfAborted(signal);
      resumeText = await this.scanner.extractResume(card.index);
      this.logger.info(`简历 ${resumeText.length} 字符`);
      aiResult = await this.scorer.score(resumeText, jd.content, jd.title, signal);
      this.logger.info(`AI 评分: ${aiResult.score} 分 — ${aiResult.reason}`);
    } finally {
      closed = await this.scanner.closeDetail();
    }

    if (!closed) {
      throw new Error(`无法关闭 ${card.name} 的简历详情，已停止流程以避免误操作`);
    }
    await sleep(intervals?.closeDetail ?? 1500, signal);
    throwIfAborted(signal);

    // 跨候选人间隔（秒转ms）
    const gap = intervals?.evaluate ?? 3000;
    await sleep(gap, signal);

    if (aiResult.score < threshold) {
      return {
        kind: 'result',
        entry: {
          ...resultEntry(card, 'rejected', 'ai', aiResult.reason, aiResult.score),
          matchedSkills: aiResult.matchedSkills,
        },
        evaluation: {
          status: 'rejected',
          stage: 'ai',
          aiScore: aiResult.score,
          aiReason: aiResult.reason,
          matchedSkills: aiResult.matchedSkills,
        },
        resumeText,
      };
    }

    return {
      kind: 'accepted',
      candidate: { card, score: aiResult.score, aiResult, resumeText },
    };
  }
}
