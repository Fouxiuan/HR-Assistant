import type { Express, Request, Response } from 'express';
import type { RouteContext } from '../context.js';

export function registerJobsKeywordsRoutes(app: Express, context: RouteContext): void {
  app.get('/api/jobs', async (_request: Request, response: Response) => {
    await context.jobs.loadAll();
    response.json(context.jobs.jds.map((job) => job.title));
  });

  app.get('/api/config/keywords', (request: Request, response: Response) => {
    const job = typeof request.query.job === 'string' ? request.query.job : '';
    if (job) {
      response.json(context.keywords.getJobConfig(job));
      return;
    }

    const jobs: Record<string, unknown> = {};
    for (const title of context.keywords.getConfiguredJobs()) {
      jobs[title] = context.keywords.getJobConfig(title);
    }
    response.json({ jobs, defaults: context.keywords.getJobConfig('') });
  });

  app.post('/api/config/keywords', (request: Request, response: Response) => {
    const { job, ...partial } = request.body as { job?: unknown; [key: string]: unknown };
    if (typeof job !== 'string' || !job.trim()) {
      response.status(400).json({ error: '缺少 job 参数' });
      return;
    }
    const updated = context.keywords.updateJobConfig(job, partial);
    context.logger.info(`关键词配置已更新: ${job}`);
    response.json({ success: true, job, data: updated });
  });
}
