export type RunPhase = 'idle' | 'navigating' | 'running' | 'done' | 'stopped' | 'error';
export type ResultStatus = 'greeted' | 'rejected' | 'error';
export type ResultStage =
  | 'age'
  | 'keyword'
  | 'detail_open'
  | 'ai'
  | 'ai_threshold'
  | 'greet'
  | 'greet_failed'
  | 'batch_limit'
  | 'manual_greet';

export interface CandidateCard {
  index: number;
  sourceId?: string;
  name: string;
  salary: string;
  age: string;
  years: string;
  education: string;
  status: string;
  expected: string;
  advantage: string;
  tags: string[];
  fullText: string;
}

export interface BackupManifest {
  format: 'hr-assistant-backup';
  formatVersion: 1;
  appVersion: string;
  databaseVersion: number;
  createdAt: string;
  files: Array<{ path: string; size: number; sha256: string }>;
}

export interface BackupStatus {
  busy: boolean;
  operation: 'idle' | 'exporting' | 'restoring';
  lastBackupAt?: string;
  lastRestoreAt?: string;
  message?: string;
}

export interface AIResult {
  score: number;
  reason: string;
  matchedSkills?: string[];
}

export interface ResultEntry extends Omit<CandidateCard, 'status'> {
  status: ResultStatus;
  stage: ResultStage;
  score?: number;
  reason?: string;
  matchedSkills?: string[];
  timestamp: string;
}

export interface BossFilters {
  location?: string;
  ageMin?: string | number;
  ageMax?: string | number;
  activity?: string[];
  gender?: string[];
  keywords?: string[];
  recentViewed?: string[];
  resumeExchange?: string[];
  schools?: string[];
  majors?: string[];
  jobChangeFrequency?: string[];
  jobIntent?: string[];
  educationRequirements?: string[];
  experienceRequirements?: string[];
  salary?: string[];
  [key: string]: unknown;
}

export interface Settings {
  selectedJob: string;
  bossJobTitle: string;
  bossFilters: BossFilters;
  candidateAgeMin: number;
  candidateAgeMax: number;
  minScore: number;
  totalGreetTarget: number;
  maxEmptyScrolls: number;
  actionDelayMs: number;
  maxCandidates: number;
  // P2: 分阶段间隔 (秒)，运行时自动 *1000 转 ms
  scanIntervalSec?: number;
  evaluateIntervalSec?: number;
  greetIntervalSec?: number;
  closeDetailIntervalSec?: number;
}

export interface RunStatus {
  isRunning: boolean;
  phase: RunPhase;
  message: string;
  results: number;
}

export interface StartRequest {
  job: string;
  bossJobTitle?: string;
  bossFilters?: BossFilters;
}

export interface StartResult {
  success: boolean;
  message?: string;
  phase?: RunPhase;
}

export interface KeywordConfig {
  excludeKeywords: string[];
  genericWords: string[];
  skillLibrary: string[];
  preferredCompanies: string[];
  matchThreshold: number;
  aiPrompt?: string;
}

export interface CandidateListItem {
  id: number;
  name: string;
  education: string;
  years: string;
  lastSeenAt: string;
  hasMailSource?: boolean;
  hasGreetSource?: boolean;
  latest: {
    jobTitle: string | null;
    aiScore: number | null;
    status: string | null;
    stage: string | null;
    createdAt: string;
  };
}

export interface CandidateListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: CandidateListItem[];
}

export interface CandidateEvaluation {
  id: number;
  jobTitle: string | null;
  aiScore: number | null;
  aiReason: string | null;
  matchedSkills: string[];
  status: string;
  stage: string;
  detail: string | null;
  createdAt: string;
}

export interface CandidateDetail {
  id: number;
  name: string;
  education: string;
  years: string;
  resumeText: string | null;
  resumeJson: Record<string, unknown> | null;
  rawCard: CandidateCard | null;
  firstSeenAt: string;
  lastSeenAt: string;
  evaluations: CandidateEvaluation[];
  mailSources?: CandidateMailSource[];
}

export interface CandidateStats {
  total: number;
  greeted: number;
  avgScore: number | null;
  byJob: Array<{ jobTitle: string; count: number }>;
}

export interface FailureStat {
  status: string;
  stage: string;
  detail: string | null;
  count: number;
}

export interface FailureStats {
  totalFailed: number;
  totalGreeted: number;
  byReason: FailureStat[];
}

export interface DatabaseUnavailable {
  available: false;
  message: string;
}

export type JobDescriptionSource = 'database' | 'local';

export interface JobDescription {
  id: number | null;
  title: string;
  content: string;
  sourceFilename: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface JobDescriptionInput {
  title: string;
  content: string;
  sourceFilename?: string | null;
  updatedBy?: string | null;
}

export interface JobCatalogResponse {
  items: JobDescription[];
  source: JobDescriptionSource;
  writable: boolean;
  message?: string;
}

export type MailProcessingStatus =
  | 'imported'
  | 'pending_job'
  | 'pending_ai'
  | 'parse_failed'
  | 'score_failed'
  | 'needs_review';

export interface MailSyncStatus {
  available: boolean;
  configured: boolean;
  enabled: boolean;
  syncing: boolean;
  provider?: string;
  mailbox?: string;
  lastSyncedAt?: string | null;
  lastUid?: number | null;
  lastError?: string | null;
  requiresRebaseline?: boolean;
  importedCount?: number;
  message?: string;
}

export interface MailAttachmentMeta {
  id: number;
  filename: string;
  displayFilename: string;
  contentType: string;
  size: number;
  sha256: string;
  parseError: string | null;
  textLength: number;
  documentType: MailDocumentType;
  createdAt: string;
}

export type MailDocumentType = 'resume' | 'portfolio' | 'other';

export interface MailMessageSummary {
  id: number;
  messageId: string | null;
  subject: string;
  sender: string;
  receivedAt: string;
  candidateId: number | null;
  candidateName: string | null;
  extractedJobTitle: string | null;
  matchedJobTitle: string | null;
  status: MailProcessingStatus;
  error: string | null;
  attachmentCount: number;
}

export interface MailMessageDetail extends MailMessageSummary {
  recipient: string | null;
  textBody: string;
  parsedFields: Record<string, string>;
  attachments: MailAttachmentMeta[];
  candidateAttachments: MailAttachmentMeta[];
}

export interface MailMessageListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: MailMessageSummary[];
}

export interface MailConfigPublic {
  provider: '163' | '126' | '188' | 'vip163' | 'vip126' | 'netease-enterprise';
  maskedUsername: string;
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  enabled: boolean;
  hasSecret: boolean;
  aiProvider: string;
  aiBaseUrl: string;
  aiModel: string;
  hasAIKey: boolean;
}

export interface CandidateMailSource {
  messageId: number;
  subject: string;
  sender: string;
  receivedAt: string;
  status: MailProcessingStatus;
  matchedJobTitle: string | null;
  attachments: MailAttachmentMeta[];
}
