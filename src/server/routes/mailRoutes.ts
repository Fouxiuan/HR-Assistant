import type { Express, Request, Response } from 'express';
import { aiProviderNeedsKey, getProviders, normalizeAIBaseUrl } from '../../aiConfig.js';
import type { MailConfigUpdate } from '../../mail/config.js';
import { getMailConfig, publicMailConfig, saveMailConfig } from '../../mail/config.js';
import type { MailListParams } from '../../mail/repository.js';
import type { RouteContext } from '../context.js';

function isLoopback(request: Request): boolean {
  const address = request.socket.remoteAddress || request.ip || '';
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
    || address.startsWith('127.');
}

function isTrustedLocalRequest(request: Request): boolean {
  if (!isLoopback(request)) return false;
  const origin = request.header('origin');
  if (!origin) return true;
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function numericId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error('ID 无效');
  return id;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function sendError(response: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const status = /不存在|无效|缺少|请先|请选择/.test(message) ? 400 : 500;
  response.status(status).json({ message });
}

function mailConfigResponse(value = getMailConfig()) {
  return {
    ...publicMailConfig(value),
    aiProviders: Object.values(getProviders()),
  };
}

function isAscii(value: string): boolean {
  return Array.from(value).every(character => character.charCodeAt(0) <= 0x7f);
}

function filterChatModels(models: unknown): string[] {
  const raw = (Array.isArray(models) ? models : [])
    .map(item => typeof item === 'object' && item && 'id' in item ? (item as { id?: unknown }).id : undefined)
    .filter((id): id is string => typeof id === 'string')
    .sort();
  return raw.filter(id => !['embed', 'rerank', 'moderation', 'whisper', 'tts', 'dall-e']
    .some(term => id.toLowerCase().includes(term)));
}

function requireLocal(request: Request, response: Response): boolean {
  if (isTrustedLocalRequest(request)) return true;
  response.status(403).json({ message: '该功能仅允许从本机访问' });
  return false;
}

export function registerMailRoutes(app: Express, context: RouteContext): void {
  app.get('/api/mail/admin/config', (request, response) => {
    if (!context.mail.available || !requireLocal(request, response)) return;
    response.json(mailConfigResponse());
  });

  app.put('/api/mail/admin/config', async (request, response) => {
    if (!context.mail.available || !requireLocal(request, response)) return;
    try {
      const body = (request.body ?? {}) as MailConfigUpdate & { rebaseline?: boolean };
      const previous = getMailConfig();
      const update: MailConfigUpdate = {
        provider: body.provider,
        username: body.username,
        ...(body.provider === previous.provider ? {
          host: body.host,
          port: body.port,
          secure: body.secure,
        } : {}),
        mailbox: body.mailbox,
        enabled: body.enabled,
        aiProvider: body.aiProvider,
        aiBaseUrl: body.aiBaseUrl,
        aiModel: body.aiModel,
        ...(typeof body.authCode === 'string' && body.authCode ? { authCode: body.authCode } : {}),
        ...(typeof body.aiApiKey === 'string' && body.aiApiKey ? { aiApiKey: body.aiApiKey } : {}),
      };
      Object.keys(update).forEach((key) => {
        if (update[key as keyof MailConfigUpdate] === undefined) delete update[key as keyof MailConfigUpdate];
      });
      const saved = saveMailConfig(update);
      const accountChanged = previous.username !== saved.username
        || previous.host !== saved.host
        || previous.port !== saved.port
        || previous.mailbox !== saved.mailbox;
      if (saved.enabled && (accountChanged || body.rebaseline)) await context.mail.rebaseline();
      response.json(mailConfigResponse(saved));
    } catch (error) { sendError(response, error); }
  });

  app.post('/api/mail/admin/test-imap', async (request, response) => {
    if (!context.mail.available || !requireLocal(request, response)) return;
    try {
      await context.mail.testConnection();
      response.json({ ok: true, message: 'IMAP 连接成功' });
    } catch (error) { sendError(response, error); }
  });

  app.post('/api/mail/admin/models', async (request, response) => {
    if (!context.mail.available || !requireLocal(request, response)) return;
    try {
      const current = getMailConfig();
      const body = (request.body ?? {}) as Record<string, unknown>;
      const provider = typeof body.aiProvider === 'string' ? body.aiProvider : current.aiProvider;
      const requestedBaseUrl = typeof body.aiBaseUrl === 'string' ? body.aiBaseUrl : current.aiBaseUrl;
      const baseUrl = normalizeAIBaseUrl(requestedBaseUrl);
      const requestKey = typeof body.aiApiKey === 'string' ? body.aiApiKey.trim() : '';
      const apiKey = requestKey || (baseUrl === current.aiBaseUrl ? current.aiApiKey : '');
      if (aiProviderNeedsKey(provider) && !apiKey) {
        response.status(400).json({ ok: false, message: '请先填写 API Key' });
        return;
      }
      if (apiKey && !isAscii(apiKey)) {
        response.status(400).json({ ok: false, message: 'API Key 包含非 ASCII 字符，请检查配置' });
        return;
      }
      const result = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(15_000),
      });
      if (!result.ok) {
        const detail = await result.text().catch(() => '');
        response.json({ ok: false, message: `HTTP ${result.status}: ${detail.slice(0, 200)}`, models: [] });
        return;
      }
      const payload = await result.json() as { data?: unknown };
      response.json({ ok: true, models: filterChatModels(payload.data) });
    } catch (error) {
      response.json({ ok: false, message: error instanceof Error ? error.message : String(error), models: [] });
    }
  });

  app.post('/api/mail/admin/test-ai', async (request, response) => {
    if (!context.mail.available || !requireLocal(request, response)) return;
    try {
      await context.mail.testAI();
      response.json({ ok: true, message: '邮件 AI 连接成功' });
    } catch (error) { sendError(response, error); }
  });

  app.get('/api/mail/status', async (request, response) => {
    if (!requireLocal(request, response)) return;
    try { response.json(await context.mail.status()); } catch (error) { sendError(response, error); }
  });

  app.get('/api/mail/messages', async (request, response) => {
    if (!requireLocal(request, response)) return;
    try {
      const params: MailListParams = {
        search: typeof request.query.search === 'string' ? request.query.search : undefined,
        status: typeof request.query.status === 'string' ? request.query.status : undefined,
        job: typeof request.query.job === 'string' ? request.query.job : undefined,
        page: optionalNumber(request.query.page),
        pageSize: optionalNumber(request.query.pageSize),
      };
      response.json(await context.mail.list(params));
    } catch (error) { sendError(response, error); }
  });

  app.get('/api/mail/messages/:id', async (request, response) => {
    if (!requireLocal(request, response)) return;
    try {
      const item = await context.mail.getMessage(numericId(request.params.id));
      if (!item) { response.status(404).json({ message: '简历邮件不存在' }); return; }
      response.json(item);
    } catch (error) { sendError(response, error); }
  });

  app.get('/api/mail/candidates/:candidateId', async (request, response) => {
    if (!requireLocal(request, response)) return;
    try {
      response.json({ items: await context.mail.getCandidateSources(numericId(request.params.candidateId)) });
    } catch (error) { sendError(response, error); }
  });

  app.get('/api/mail/attachments/:id', async (request, response) => {
    if (!requireLocal(request, response)) return;
    try {
      const item = await context.mail.getAttachment(numericId(request.params.id));
      if (!item) { response.status(404).json({ message: '附件不存在' }); return; }
      const safeName = item.filename.replace(/[\r\n"]/g, '_');
      response.setHeader('Content-Type', item.contentType === 'application/octet-stream' ? 'application/pdf' : item.contentType);
      response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`);
      response.send(item.data);
    } catch (error) { sendError(response, error); }
  });

  app.post('/api/mail/sync', async (request, response) => {
    if (!requireLocal(request, response)) return;
    try { response.json(await context.mail.syncNow()); } catch (error) { sendError(response, error); }
  });

  app.post('/api/mail/messages/:id/reprocess', async (request, response) => {
    if (!requireLocal(request, response)) return;
    try {
      const item = await context.mail.reprocess(numericId(request.params.id));
      if (!item) { response.status(404).json({ message: '简历邮件不存在' }); return; }
      response.json(item);
    } catch (error) { sendError(response, error); }
  });

  app.put('/api/mail/messages/:id/job', async (request, response) => {
    if (!requireLocal(request, response)) return;
    try {
      const jobId = Number((request.body as { jobId?: unknown })?.jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) throw new Error('请选择有效 JD');
      const item = await context.mail.reprocess(numericId(request.params.id), jobId);
      if (!item) { response.status(404).json({ message: '简历邮件不存在' }); return; }
      response.json(item);
    } catch (error) { sendError(response, error); }
  });
}
