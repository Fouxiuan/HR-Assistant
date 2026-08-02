import type { AIResult, CandidateCard } from '../../shared/contracts.js';

export interface ProcessedCandidate {
  card: CandidateCard;
  score: number;
  aiResult: AIResult;
  resumeText: string;
}
