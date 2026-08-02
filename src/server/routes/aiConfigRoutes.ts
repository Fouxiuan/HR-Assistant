import type { Express, Request, Response } from 'express';
import { aiProviderNeedsKey, getAIConfig, getProviders, normalizeAIBaseUrl, PROVIDERS, saveAIConfig } from '../../aiConfig.js';
import type { RouteContext } from '../context.js';

const MASK = '••••••••';

function isAscii(value: string): boolean {
  return Array.from(value).every(character => character.charCodeAt(0) <= 0x7f);
}

function publicConfig() {
  const config = getAIConfig();
  return {
    ...config,
    apiKey: config.apiKey ? MASK : '',
    hasKey: !!config.apiKey,
    providers: Object.entries(getProviders()).map(([key, provider]) => ({ key, label: provider.label, baseUrl: provider.baseUrl })),
  };
}

export function registerAIConfigRoutes(app: Express, _context: RouteContext): void {
  app.get('/api/ai-config', (_request: Request, response: Response) => response.json(publicConfig()));

  app.post('/api/ai-config', (request: Request, response: Response) => {
    try {
      const { provider, apiKey, model, baseUrl } = request.body as Record<string, string | undefined>;
      const partial: Record<string, string> = {};
      if (provider !== undefined && !Array.isArray(provider)) partial.provider = String(provider);
      if (model !== undefined && !Array.isArray(model)) partial.model = String(model);
      if (baseUrl !== undefined && !Array.isArray(baseUrl)) partial.baseUrl = String(baseUrl);
      if (typeof apiKey === 'string' && apiKey && apiKey !== MASK) partial.apiKey = apiKey;
      saveAIConfig(partial);
      response.json(publicConfig());
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/ai-config/models', async (request: Request, response: Response) => {
    try {
      const current = getAIConfig();
      const body = request.body as Record<string, unknown>;
      const provider = typeof body.provider === 'string' ? body.provider : current.provider;
      const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim() ? normalizeAIBaseUrl(body.baseUrl) : current.baseUrl;
      const requestKey = typeof body.apiKey === 'string' && body.apiKey !== MASK ? body.apiKey.trim() : '';
      const apiKey = requestKey || (baseUrl === current.baseUrl ? current.apiKey : '');
      if (aiProviderNeedsKey(provider) && !apiKey) throw new Error('请先填写 API Key');
      if (!isAscii(apiKey)) throw new Error('API Key 包含非 ASCII 字符');
      const result = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(15_000),
      });
      if (!result.ok) throw new Error(`HTTP ${result.status}: ${(await result.text()).slice(0, 200)}`);
      const payload = await result.json() as { data?: Array<{ id?: unknown }> };
      const models = (payload.data || [])
        .map(item => item.id)
        .filter((id): id is string => typeof id === 'string')
        .filter(id => !['embed', 'rerank', 'moderation', 'whisper', 'tts', 'dall-e', 'vision'].some(term => id.toLowerCase().includes(term)))
        .sort();
      response.json({ ok: true, models });
    } catch (error) {
      response.status(400).json({ ok: false, message: error instanceof Error ? error.message : String(error), models: [] });
    }
  });

  app.post('/api/ai-config/test', async (request: Request, response: Response) => {
    try {
      const current = getAIConfig();
      const body = request.body as Record<string, unknown>;
      const provider = typeof body.provider === 'string' ? body.provider : current.provider;
      const providerConfig = PROVIDERS[provider];
      const baseUrl = normalizeAIBaseUrl(typeof body.baseUrl === 'string' && body.baseUrl ? body.baseUrl : providerConfig?.baseUrl || current.baseUrl);
      const suppliedKey = typeof body.apiKey === 'string' && body.apiKey !== MASK ? body.apiKey : '';
      const apiKey = suppliedKey || (baseUrl === current.baseUrl ? current.apiKey : '');
      const model = typeof body.model === 'string' && body.model ? body.model : current.model;
      if (aiProviderNeedsKey(provider) && !apiKey) throw new Error('请先填写 API Key');
      if (!isAscii(apiKey)) throw new Error('API Key 包含非 ASCII 字符');
      const startedAt = Date.now();
      const result = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hello' }], max_tokens: 10 }),
        signal: AbortSignal.timeout(15_000),
      });
      const latency = Date.now() - startedAt;
      if (!result.ok) throw new Error(`HTTP ${result.status}: ${(await result.text()).slice(0, 150)}`);
      response.json({ ok: true, latency, message: `连接成功 (${latency}ms)` });
    } catch (error) {
      response.status(400).json({ ok: false, latency: 0, message: error instanceof Error ? error.message : String(error) });
    }
  });
}
