import type {
  CandidateCard,
  CandidateDetail,
  CandidateListResponse,
  CandidateStats,
  FailureStats,
} from '../../shared/contracts.js';

export interface CandidateListParams {
  search?: string;
  status?: string;
  job?: string;
  minScore?: number;
  source?: 'mail' | 'greet';
  page?: number;
  pageSize?: number;
  sort?: 'time_desc' | 'time_asc' | 'score_desc' | 'score_asc';
}

export interface EvaluationInput {
  candidateId: number | null;
  runId?: number | null;
  jobTitle?: string;
  aiScore?: number | null;
  aiReason?: string | null;
  matchedSkills?: string[] | null;
  status: string;
  stage: string;
  detail?: string | null;
  resumeSnapshot?: string | null;
  sourceEventId?: string | null;
}

export interface CandidateRepository {
  readonly available: boolean;
  readonly unavailableReason?: string;
  startRun(jobTitle: string, bossJobTitle: string): Promise<number | null>;
  finishRun(runId: number | null, status: string, greetedCount: number): Promise<void>;
  upsertCandidate(card: CandidateCard, resumeText?: string, resumeJson?: object): Promise<number | null>;
  addEvaluation(input: EvaluationInput): Promise<void>;
  markGreeted(candidate: CandidateCard): Promise<void>;
  list(params: CandidateListParams): Promise<CandidateListResponse>;
  getById(id: number): Promise<CandidateDetail | null>;
  stats(): Promise<CandidateStats>;
  failureStats(): Promise<FailureStats>;
}

const EMPTY_LIST: CandidateListResponse = { total: 0, page: 1, pageSize: 50, items: [] };
const EMPTY_STATS: CandidateStats = { total: 0, greeted: 0, avgScore: null, byJob: [] };
const EMPTY_FAILURE: FailureStats = { totalFailed: 0, totalGreeted: 0, byReason: [] };

export class NoopCandidateRepository implements CandidateRepository {
  readonly available = false;

  constructor(readonly unavailableReason = '本机候选人数据库不可用') {}

  async startRun(): Promise<null> { return null; }
  async finishRun(): Promise<void> {}
  async upsertCandidate(): Promise<null> { return null; }
  async addEvaluation(): Promise<void> {}
  async markGreeted(): Promise<void> {}
  async list(params: CandidateListParams): Promise<CandidateListResponse> {
    return { ...EMPTY_LIST, page: params.page ?? 1, pageSize: params.pageSize ?? 50 };
  }
  async getById(): Promise<null> { return null; }
  async stats(): Promise<CandidateStats> { return { ...EMPTY_STATS }; }
  async failureStats(): Promise<FailureStats> { return { ...EMPTY_FAILURE, byReason: [] }; }
}
