import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { resolve } from 'path';
import type { MailConfigPublic } from '../../shared/contracts.js';
import config from '../config.js';
import { NETEASE_PROVIDERS, isNeteaseProvider, type NeteaseProviderKey } from './providers.js';

interface EncryptedValue {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface MailConfigData {
  provider: NeteaseProviderKey;
  username: string;
  authCode: string;
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  enabled: boolean;
  aiProvider: string;
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
}

interface StoredMailConfig extends Omit<MailConfigData, 'authCode' | 'aiApiKey'> {
  authCodeEncrypted?: EncryptedValue;
  aiApiKeyEncrypted?: EncryptedValue;
}

export type MailConfigUpdate = Partial<Omit<MailConfigData, 'authCode' | 'aiApiKey'>> & {
  authCode?: string;
  aiApiKey?: string;
};

const configFile = resolve(config.paths.data, 'mailConfig.json');
const keyFile = resolve(config.paths.data, '.mail-config.key');
const DEFAULT_PROVIDER = NETEASE_PROVIDERS['163'];
const DEFAULT_CONFIG: MailConfigData = {
  provider: '163',
  username: '',
  authCode: '',
  host: DEFAULT_PROVIDER.host,
  port: DEFAULT_PROVIDER.port,
  secure: DEFAULT_PROVIDER.secure,
  mailbox: 'INBOX',
  enabled: false,
  aiProvider: 'deepseek',
  aiBaseUrl: 'https://api.deepseek.com',
  aiModel: '',
  aiApiKey: '',
};

let cached: MailConfigData | null = null;

function ensureDataDir(): void {
  if (!existsSync(config.paths.data)) mkdirSync(config.paths.data, { recursive: true });
}

function encryptionKey(): Buffer {
  ensureDataDir();
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  const key = readFileSync(keyFile);
  if (key.length !== 32) throw new Error('邮件配置加密密钥格式无效');
  try { chmodSync(keyFile, 0o600); } catch { /* Windows 使用当前用户 ACL。 */ }
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
  if (value.version !== 1) throw new Error('不支持的邮件配置加密版本');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function validateUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('邮件 AI Base URL 不能为空');
  const parsed = new URL(trimmed);
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.username || parsed.password) throw new Error('邮件 AI Base URL 不允许包含账号密码');
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('邮件 AI Base URL 必须使用 HTTPS（本机地址除外）');
  }
  if (['169.254.169.254', 'metadata.google.internal', '0.0.0.0'].includes(parsed.hostname)) {
    throw new Error('邮件 AI Base URL 不允许访问该地址');
  }
  return trimmed;
}

function validate(value: MailConfigData): MailConfigData {
  if (!isNeteaseProvider(value.provider)) throw new Error('不支持的网易邮箱类型');
  if (value.username.length > 320) throw new Error('邮箱账号过长');
  if (value.authCode.length > 4096 || value.aiApiKey.length > 4096) throw new Error('密钥过长');
  if (!value.host.trim() || value.host.length > 253) throw new Error('IMAP 主机无效');
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error('IMAP 端口无效');
  if (!value.mailbox.trim() || value.mailbox.length > 255) throw new Error('邮箱文件夹无效');
  if (value.enabled && (!value.username.trim() || !value.authCode)) throw new Error('启用前请填写邮箱账号和授权码');
  return {
    ...value,
    username: value.username.trim(),
    host: value.host.trim(),
    mailbox: value.mailbox.trim(),
    aiBaseUrl: validateUrl(value.aiBaseUrl),
    aiModel: value.aiModel.trim(),
    aiProvider: value.aiProvider.trim() || 'custom',
  };
}

function writeConfig(value: MailConfigData): void {
  ensureDataDir();
  const stored: StoredMailConfig = {
    provider: value.provider,
    username: value.username,
    host: value.host,
    port: value.port,
    secure: value.secure,
    mailbox: value.mailbox,
    enabled: value.enabled,
    aiProvider: value.aiProvider,
    aiBaseUrl: value.aiBaseUrl,
    aiModel: value.aiModel,
    authCodeEncrypted: encrypt(value.authCode),
    aiApiKeyEncrypted: encrypt(value.aiApiKey),
  };
  writeFileSync(configFile, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(configFile, 0o600); } catch { /* Windows 使用当前用户 ACL。 */ }
}

export function getMailConfig(): MailConfigData {
  if (cached) return { ...cached };
  try {
    const stored = JSON.parse(readFileSync(configFile, 'utf8')) as Partial<StoredMailConfig>;
    const provider = isNeteaseProvider(stored.provider) ? stored.provider : '163';
    cached = validate({
      ...DEFAULT_CONFIG,
      ...stored,
      provider,
      authCode: decrypt(stored.authCodeEncrypted),
      aiApiKey: decrypt(stored.aiApiKeyEncrypted),
    });
  } catch {
    cached = { ...DEFAULT_CONFIG };
    writeConfig(cached);
  }
  return { ...cached };
}

export function saveMailConfig(update: MailConfigUpdate): MailConfigData {
  const current = getMailConfig();
  const providerChanged = update.provider !== undefined && update.provider !== current.provider;
  const preset = update.provider && isNeteaseProvider(update.provider)
    ? NETEASE_PROVIDERS[update.provider]
    : NETEASE_PROVIDERS[current.provider];
  const next: MailConfigData = {
    ...current,
    ...update,
    host: providerChanged && update.host === undefined ? preset.host : update.host ?? current.host,
    port: providerChanged && update.port === undefined ? preset.port : update.port ?? current.port,
    secure: providerChanged && update.secure === undefined ? preset.secure : update.secure ?? current.secure,
    authCode: update.authCode === undefined ? current.authCode : update.authCode,
    aiApiKey: update.aiApiKey === undefined ? current.aiApiKey : update.aiApiKey,
  };
  if (update.aiBaseUrl !== undefined && update.aiBaseUrl !== current.aiBaseUrl && update.aiApiKey === undefined) {
    next.aiApiKey = '';
  }
  cached = validate(next);
  writeConfig(cached);
  return { ...cached };
}

export function publicMailConfig(value = getMailConfig()): MailConfigPublic {
  const username = value.username;
  const at = username.indexOf('@');
  const local = at >= 0 ? username.slice(0, at) : username;
  const domain = at >= 0 ? username.slice(at) : '';
  const maskedLocal = local.length <= 2
    ? '*'.repeat(Math.max(1, local.length))
    : `${local.slice(0, 2)}${'*'.repeat(Math.min(6, local.length - 2))}`;
  return {
    provider: value.provider,
    maskedUsername: username ? `${maskedLocal}${domain}` : '',
    host: value.host,
    port: value.port,
    secure: value.secure,
    mailbox: value.mailbox,
    enabled: value.enabled,
    hasSecret: !!value.authCode,
    aiProvider: value.aiProvider,
    aiBaseUrl: value.aiBaseUrl,
    aiModel: value.aiModel,
    hasAIKey: !!value.aiApiKey,
  };
}

export function mailConfigIdentity(value = getMailConfig()): string {
  return `${value.provider}:${value.username.toLowerCase()}:${value.host}:${value.port}:${value.mailbox}`;
}

export function resetMailConfigCache(): void {
  cached = null;
}

export function getMailConfigPaths(): string[] {
  return [configFile, keyFile];
}
