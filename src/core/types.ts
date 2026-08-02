export type {
  AIResult,
  BossFilters,
  CandidateCard,
  ResultEntry,
  ResultStage,
  ResultStatus,
  RunPhase as Phase,
  RunStatus,
  Settings,
  StartResult,
} from '../../shared/contracts.js';

import type { BossFilters } from '../../shared/contracts.js';

export interface StartParams {
  selectedJob: string;
  bossJobTitle: string;
  bossFilters: BossFilters;
}
