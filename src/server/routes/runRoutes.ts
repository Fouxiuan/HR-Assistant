import type { Express, Request, Response } from 'express';
import type { StartRequest } from '../../../shared/contracts.js';
import type { RouteContext } from '../context.js';

export function registerRunRoutes(app: Express, context: RouteContext): void {
  app.post('/api/greet', async (request: Request, response: Response) => {
    const { name, index } = request.body as { name?: unknown; index?: unknown };
    if (typeof name !== 'string' || !name.trim()) {
      response.json({ success: false, message: '缺少 name' });
      return;
    }

    context.logger.info(`手动打招呼: ${name}`);
    try {
      const candidateBody = request.body && typeof request.body.candidate === 'object' && request.body.candidate
        ? request.body.candidate as Record<string, unknown>
        : null;
      const candidateRef = {
        name,
        index: typeof index === 'number' ? index : 0,
        sourceId: typeof candidateBody?.sourceId === 'string' ? candidateBody.sourceId : undefined,
      };
      await context.browser.connect();
      const result = await context.greeter.greet(candidateRef);
      if (!result.success) {
        response.json({ success: false, message: '未找到打招呼按钮' });
        return;
      }
      context.runner.markGreeted(candidateRef);
      try {
        const storedCard = context.runner.getResults().find(item =>
          item.name === candidateRef.name && item.index === candidateRef.index
        );
        if (storedCard) await context.candidates.markGreeted(storedCard);
      } catch (error) {
        context.logger.warn(`手动打招呼状态持久化失败: ${error instanceof Error ? error.message : String(error)}`);
      }
      response.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error(`手动打招呼失败: ${message}`);
      response.json({ success: false, message });
    }
  });

  app.get('/api/status', (_request: Request, response: Response) => {
    response.json({
      ...context.runner.getStatus(),
      backendInstanceId: process.env.BACKEND_INSTANCE_ID || null,
    });
  });

  app.post('/api/start', async (request: Request, response: Response) => {
    const body = request.body as Partial<StartRequest>;
    const saved = context.settings.get();
    const selectedJob = typeof body.job === 'string' && body.job ? body.job : saved.selectedJob;
    const bossJobTitle = typeof body.bossJobTitle === 'string' && body.bossJobTitle
      ? body.bossJobTitle
      : saved.bossJobTitle || selectedJob;
    const bossFilters = body.bossFilters ?? saved.bossFilters ?? {};
    if (!selectedJob) {
      response.status(400).json({ success: false, message: '请先在前端选择招聘岗位' });
      return;
    }

    context.settings.update({ selectedJob, bossJobTitle, bossFilters });
    response.json(await context.runner.start({ selectedJob, bossJobTitle, bossFilters }));
  });

  app.post('/api/stop', (_request: Request, response: Response) => {
    context.runner.stop();
    context.logger.info('用户停止处理');
    response.json({ success: true });
  });
}
