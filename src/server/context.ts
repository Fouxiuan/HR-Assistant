import type { CandidateRepository } from '../db/repository.js';
import type { JobDescriptionRepository } from '../db/jobDescriptionRepository.js';
import type { LocalDatabase } from '../db/localDatabase.js';
import type { MailServicePort } from '../mail/service.js';
import type {
  BrowserPort,
  GreeterPort,
  JobCatalogPort,
  KeywordStorePort,
  LoggerPort,
  RunnerPort,
  SettingsStorePort,
} from '../core/ports.js';

export interface RouteContext {
  logger: LoggerPort;
  browser: BrowserPort;
  jobs: JobCatalogPort;
  greeter: GreeterPort;
  runner: RunnerPort;
  candidates: CandidateRepository;
  database: LocalDatabase;
  jobDescriptions: JobDescriptionRepository;
  mail: MailServicePort;
  settings: SettingsStorePort;
  keywords: KeywordStorePort;
}
