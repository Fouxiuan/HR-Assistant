import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import type { LoggerPort } from './core/ports.js';
import config from './config.js';

interface CookieJar {
  cookies: string;
  savedAt: string;
}

const COOKIE_FILE = resolve(process.env.COOKIE_PATH || resolve(config.paths.data, 'boss_cookies.json'));

async function ensureDir(filepath: string): Promise<void> {
  const dir = dirname(filepath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

export async function saveCookies(logger: LoggerPort, cookieString: string): Promise<void> {
  try {
    await ensureDir(COOKIE_FILE);
    const jar: CookieJar = { cookies: cookieString, savedAt: new Date().toISOString() };
    await writeFile(COOKIE_FILE, JSON.stringify(jar, null, 2), 'utf8');
    logger.info(`Cookie 已保存到 ${COOKIE_FILE} (${cookieString.length} 字符)`);
  } catch (err) {
    logger.warn(`Cookie 保存失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function loadCookies(): Promise<CookieJar | null> {
  try {
    if (!existsSync(COOKIE_FILE)) return null;
    const raw = await readFile(COOKIE_FILE, 'utf8');
    return JSON.parse(raw) as CookieJar;
  } catch {
    return null;
  }
}

export function getCookiePath(): string { return COOKIE_FILE; }
