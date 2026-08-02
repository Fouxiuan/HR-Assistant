import config from '../src/config.js';
import type { LoggerPort } from '../src/core/ports.js';
import { createRepositories } from '../src/db/pool.js';
import { readLocalJobDescriptions } from '../src/jdLoader.js';

const logger: LoggerPort = {
  info: (message) => console.log(message),
  step: (message) => console.log(message),
  action: (message) => console.log(message),
  success: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  onLog: () => () => undefined,
  getLogs: () => [],
};

const repositories = await createRepositories(logger);
try {
  if (!repositories.jobDescriptions.available) {
    throw new Error(repositories.jobDescriptions.unavailableReason || 'JD 数据库不可用');
  }
  const local = readLocalJobDescriptions(config.job.jdDir);
  for (const job of local) {
    await repositories.jobDescriptions.upsert({ ...job, updatedBy: 'initial-import' });
  }
  console.log(`JD 导入完成：${local.length} 个文件 -> 本机 SQLite`);
} finally {
  await repositories.close();
}
