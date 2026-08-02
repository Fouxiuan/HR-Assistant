import type {
  AIResult,
  BossFilters,
  CandidateCard,
  KeywordConfig,
  JobCatalogResponse,
  JobDescription,
  ResultEntry,
  RunStatus,
  StartResult,
  Settings,
} from '../../shared/contracts.js';
import type { StartParams } from './types.js';
import type { CandidateRepository } from '../db/repository.js';

export interface LoggerPort {
  info(message: string): void;
  step(message: string): void;
  action(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  onLog(listener: (line: string) => void): () => void;
  getLogs(limit?: number): string[];
}

export interface BrowserPort {
  connect(): Promise<void>;
  navigate(url: string): Promise<unknown>;
  press(key: string): Promise<unknown>;
  eval(script: string): Promise<unknown>;
  getCookies(): Promise<string>;
  injectCookies(cookieString: string): Promise<void>;
}

export interface ScannerPort {
  configurePage(jobTitle: string, filters: BossFilters): Promise<{ success: boolean; job?: string; reason?: string }>;
  detectPageJobTitle(): Promise<string>;
  scanCards(): Promise<CandidateCard[]>;
  scrollToLoadMore(): Promise<boolean>;
  clickCard(card: CandidateCard): Promise<boolean>;
  extractResume(cardIndex: number): Promise<string>;
  closeDetail(): Promise<boolean>;
}

export interface ScorerPort {
  score(resumeText: string, jdContent: string, jobTitle: string, signal?: AbortSignal): Promise<AIResult>;
}

export interface GreetResult {
  success: boolean;
  reason?: string;
}

export interface GreeterPort {
  greet(candidate: Pick<CandidateCard, 'name' | 'index' | 'sourceId'>, signal?: AbortSignal): Promise<GreetResult>;
}

export interface JobDefinition {
  id: number | null;
  title: string;
  content: string;
  sourceFilename: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface JobCatalogPort {
  jds: JobDefinition[];
  loadAll(): Promise<JobDefinition[]>;
  getCatalog(): JobCatalogResponse;
  save(value: unknown, id?: number): Promise<JobDescription>;
  matchJob(pageTitle: string): JobDefinition | null;
  getThreshold(jobTitle: string): number;
}

export interface SettingsStorePort {
  get(): Settings;
  update(partial: Partial<Settings>): Settings;
}

export interface KeywordStorePort {
  getJobConfig(jobTitle: string): KeywordConfig;
  getConfiguredJobs(): string[];
  updateJobConfig(jobTitle: string, partial: Partial<KeywordConfig>): KeywordConfig;
}

export interface RunnerPort {
  start(params: StartParams): Promise<StartResult>;
  stop(): void;
  getStatus(): RunStatus;
  getResults(): ResultEntry[];
  markGreeted(candidate: Pick<CandidateCard, 'name' | 'index'>): void;
}

export interface JobRunnerDeps {
  logger: LoggerPort;
  browser: BrowserPort;
  jobs: JobCatalogPort;
  scanner: ScannerPort;
  scorer: ScorerPort;
  greeter: GreeterPort;
  settings: SettingsStorePort;
  candidates: CandidateRepository;
}
