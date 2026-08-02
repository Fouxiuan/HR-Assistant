import config from '../config.js';
import Logger from '../logger.js';
import BrowserWingClient from '../browserwing.js';
import JDLoader from '../jdLoader.js';
import Scanner from '../scanner.js';
import AIScorer from '../aiScorer.js';
import Greeter from '../greeter.js';
import runtimeConfig from '../runtimeConfig.js';
import keywordConfig from '../keywordConfig.js';
import { JobRunner } from '../core/runner.js';
import { createRepositories } from '../db/pool.js';
import { createApp } from './app.js';
import { MailService } from '../mail/service.js';

async function main(): Promise<void> {
  const logger = new Logger();
  const repositories = await createRepositories(logger);
  const browser = new BrowserWingClient(logger);
  const jobs = new JDLoader(logger, repositories.jobDescriptions);
  await jobs.loadAll();
  const scanner = new Scanner(logger, browser, () => runtimeConfig.get().actionDelayMs);
  const scorer = new AIScorer(logger);
  const greeter = new Greeter(logger, browser);
  const candidates = repositories.candidates;
  const mail = new MailService(logger, repositories.mail, jobs);
  const runner = new JobRunner({
    logger,
    browser,
    jobs,
    scanner,
    scorer,
    greeter,
    settings: runtimeConfig,
    candidates,
  });

  const app = createApp({
    logger,
    browser,
    jobs,
    greeter,
    runner,
    candidates,
    database: repositories.database,
    jobDescriptions: repositories.jobDescriptions,
    mail,
    settings: runtimeConfig,
    keywords: keywordConfig,
  });
  const server = app.listen(config.server.port, '127.0.0.1', () => {
    logger.info(`本地服务启动：http://127.0.0.1:${config.server.port}`);
    mail.start();
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`收到 ${signal}，正在安全关闭本地服务`);
    await mail.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await repositories.close();
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
