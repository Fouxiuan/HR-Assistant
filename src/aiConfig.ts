import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.APP_DATA_DIR ? resolve(process.env.APP_DATA_DIR) : resolve(moduleDir, '..', 'data');
const configFile = resolve(dataDir, 'aiConfig.json');
const keyFile = resolve(dataDir, '.ai-config.key');

export interface AIProvider {
  key: string;
  label: string;
  baseUrl: string;
}

export const PROVIDERS: Record<string, AIProvider> = {
  ollama: { key: 'ollama', label: 'Ollama（本机）', baseUrl: 'http://127.0.0.1:11434/v1' },
  deepseek: { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  doubao: { key: 'doubao', label: '豆包（火山引擎）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  dashscope: { key: 'dashscope', label: '阿里云百炼（通义千问）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  kimi: { key: 'kimi', label: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn' },
  zhipu: { key: 'zhipu', label: '智谱 AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  custom: { key: 'custom', label: '自定义', baseUrl: '' },
};

export function aiProviderNeedsKey(provider: string): boolean {
  return provider !== 'ollama';
}

export interface AIConfigData {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

interface EncryptedValue {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface StoredAIConfig extends Omit<AIConfigData, 'apiKey'> {
  apiKeyEncrypted?: EncryptedValue;
  apiKey?: string;
}

const DEFAULT_CONFIG: AIConfigData = {
  provider: 'deepseek',
  apiKey: '',
  model: '',
  baseUrl: PROVIDERS.deepseek.baseUrl,
};

let cached: AIConfigData | null = null;

function ensureDataDir(): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

function encryptionKey(): Buffer {
  ensureDataDir();
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  const key = readFileSync(keyFile);
  if (key.length !== 32) throw new Error('AI 配置加密密钥格式无效');
  try { chmodSync(keyFile, 0o600); } catch { /* Windows 由用户 ACL 保护 */ }
  return key;
}

function encrypt(value: string): EncryptedValue | undefined {
  if (!value) return undefined;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decrypt(value?: EncryptedValue): string {
  if (!value) return '';
  if (value.version !== 1) throw new Error('不支持的 AI 配置加密版本');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function normalizeAIBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error('Base URL 不是有效 URL'); }
  if (url.username || url.password) throw new Error('URL 不允许包含用户名或密码');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('AI Base URL 必须使用 HTTPS（本机服务除外）');
  }
  if (['169.254.169.254', 'metadata.google.internal', '0.0.0.0'].includes(url.hostname)) {
    throw new Error('不允许访问云元数据或未指定地址');
  }
  return trimmed;
}

function validate(next: AIConfigData): AIConfigData {
  if (!PROVIDERS[next.provider]) throw new Error('不支持的 AI 提供商');
  if (next.model.length > 200) throw new Error('模型名称过长');
  if (next.apiKey.length > 4096) throw new Error('API Key 过长');
  return { ...next, baseUrl: normalizeAIBaseUrl(next.baseUrl) };
}

function writeConfig(data: AIConfigData): void {
  ensureDataDir();
  const stored: StoredAIConfig = {
    provider: data.provider,
    model: data.model,
    baseUrl: data.baseUrl,
    apiKeyEncrypted: encrypt(data.apiKey),
  };
  writeFileSync(configFile, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(configFile, 0o600); } catch { /* Windows 由用户 ACL 保护 */ }
}

export function getAIConfig(): AIConfigData {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(configFile, 'utf8')) as Partial<StoredAIConfig>;
    const provider = parsed.provider && PROVIDERS[parsed.provider] ? parsed.provider : DEFAULT_CONFIG.provider;
    const plaintextKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : '';
    cached = validate({
      ...DEFAULT_CONFIG,
      provider,
      model: typeof parsed.model === 'string' ? parsed.model : '',
      baseUrl: parsed.baseUrl || PROVIDERS[provider].baseUrl,
      apiKey: plaintextKey || decrypt(parsed.apiKeyEncrypted),
    });
    if (plaintextKey) writeConfig(cached);
  } catch {
    cached = { ...DEFAULT_CONFIG };
    writeConfig(cached);
  }
  return cached;
}

export function saveAIConfig(partial: Partial<AIConfigData>): AIConfigData {
  const current = getAIConfig();
  const next = { ...current, ...partial };
  if (partial.provider !== undefined) {
    const provider = PROVIDERS[partial.provider];
    if (!provider) throw new Error('不支持的 AI 提供商');
    if (partial.provider !== 'custom') next.baseUrl = provider.baseUrl;
  }
  if (partial.apiKey === undefined && next.baseUrl !== current.baseUrl) next.apiKey = '';
  cached = validate(next);
  writeConfig(cached);
  return cached;
}

export function getProviders(): Record<string, AIProvider> {
  return PROVIDERS;
}

export function getAIConfigPath(): string {
  return configFile;
}

export function clearAIConfigCache(): void {
  cached = null;
}
