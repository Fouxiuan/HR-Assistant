import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = process.env.APP_ROOT_DIR ? resolve(process.env.APP_ROOT_DIR) : sourceRoot;
const dataDir = process.env.APP_DATA_DIR ? resolve(process.env.APP_DATA_DIR) : resolve(rootDir, 'data');

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof packageJson.version === 'string' ? packageJson.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

const config = {
  rootDir,
  version: getVersion(),

  ai: {
    apiKey: getEnv('DASHSCOPE_API_KEY', ''),
    model: getEnv('DASHSCOPE_MODEL', 'qwen3.6-flash'),
    baseUrl: getEnv('DASHSCOPE_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
  },

  browserwing: {
    port: parseInt(getEnv('BROWSERWING_PORT', '7777'), 10),
    mcpPath: '/api/v1/mcp/message',
  },

  server: {
    port: parseInt(getEnv('SERVER_PORT', '3000'), 10),
  },

  job: {
    jdDir: getEnv('JD_DIR', resolve(dataDir, 'jds')),
  },

  runtime: {
    actionDelayMs: parseInt(getEnv('ACTION_DELAY_MS', '3000'), 10),
    cardIntervalMs: parseInt(getEnv('CARD_INTERVAL_MS', '3500'), 10),
    dialogDelayMs: parseInt(getEnv('DIALOG_DELAY_MS', '2000'), 10),
    maxCandidates: parseInt(getEnv('MAX_CANDIDATES', '50'), 10),
  },

  paths: {
    data: dataDir,
    logs: resolve(dataDir, 'logs'),
    reports: resolve(dataDir, 'reports'),
  },
};

export default config;
