import type { Express, Request, Response } from 'express';
import type { RouteContext } from '../context.js';

function numericId(request: Request): number {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error('JD ID 无效');
  return id;
}

function sendError(response: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  response.status(code.includes('SQLITE_CONSTRAINT') ? 409 : 400).json({ message });
}

export function registerJobDescriptionRoutes(app: Express, context: RouteContext): void {
  app.get('/api/job-descriptions', async (_request, response) => {
    try {
      await context.jobs.loadAll();
      response.json(context.jobs.getCatalog());
    } catch (error) {
      response.status(503).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/job-descriptions', async (request, response) => {
    try {
      const item = await context.jobs.save(request.body);
      context.logger.info(`JD 已保存：${item.title}`);
      response.status(201).json({ item });
    } catch (error) { sendError(response, error); }
  });

  app.put('/api/job-descriptions/:id', async (request, response) => {
    try {
      const item = await context.jobs.save(request.body, numericId(request));
      context.logger.info(`JD 已更新：${item.title}`);
      response.json({ item });
    } catch (error) { sendError(response, error); }
  });
}
