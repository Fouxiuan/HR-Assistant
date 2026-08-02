import type { Express, Request, Response } from 'express';
import type { RouteContext } from '../context.js';

export function registerLogsResultsRoutes(app: Express, context: RouteContext): void {
  app.get('/api/results', (_request: Request, response: Response) => {
    response.json(context.runner.getResults());
  });

  app.get('/api/logs', (_request: Request, response: Response) => {
    response.json(context.logger.getLogs(200));
  });

  app.get('/api/logs/stream', (request: Request, response: Response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();
    const unsubscribe = context.logger.onLog((line) => response.write(`data: ${line}\n\n`));
    request.on('close', unsubscribe);
  });
}
