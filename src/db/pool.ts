import { resolve } from 'node:path';
import config from '../config.js';
import type { LoggerPort } from '../core/ports.js';
import type { CandidateRepository } from './repository.js';
import type { JobDescriptionRepository } from './jobDescriptionRepository.js';
import type { MailRepository } from '../mail/repository.js';
import { LocalDatabase } from './localDatabase.js';
import { SQLiteCandidateRepository } from './sqliteCandidateRepository.js';
import { SQLiteJobDescriptionRepository } from './sqliteJobDescriptionRepository.js';
import { SQLiteMailRepository } from '../mail/sqliteRepository.js';

export interface DatabaseRepositories {
  database: LocalDatabase;
  candidates: CandidateRepository;
  jobDescriptions: JobDescriptionRepository;
  mail: MailRepository;
  close(): Promise<void>;
}

export async function createRepositories(logger: LoggerPort): Promise<DatabaseRepositories> {
  const database = new LocalDatabase(resolve(config.paths.data, 'hr-assistant.sqlite'));
  logger.info(`本机 SQLite 数据库已就绪：${database.path}`);
  return {
    database,
    candidates: new SQLiteCandidateRepository(database),
    jobDescriptions: new SQLiteJobDescriptionRepository(database),
    mail: new SQLiteMailRepository(database),
    async close() { database.close(); },
  };
}
