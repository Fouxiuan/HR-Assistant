import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('mail configuration encryption', () => {
  it('encrypts secrets and never exposes them in the public shape', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'boss-mail-config-'));
    temporaryDirectories.push(directory);
    vi.stubEnv('APP_DATA_DIR', directory);
    vi.resetModules();
    const module = await import('../src/mail/config.js');

    const saved = module.saveMailConfig({
      username: 'public-hr@163.com',
      authCode: 'mail-auth-code-secret',
      aiApiKey: 'mail-ai-key-secret',
      aiModel: 'deepseek-chat',
    });
    const publicValue = module.publicMailConfig(saved);
    const stored = await readFile(join(directory, 'mailConfig.json'), 'utf8');

    expect(stored).not.toContain('mail-auth-code-secret');
    expect(stored).not.toContain('mail-ai-key-secret');
    expect(publicValue.hasSecret).toBe(true);
    expect(publicValue.hasAIKey).toBe(true);
    expect(publicValue).not.toHaveProperty('username');
    expect(publicValue).not.toHaveProperty('authCode');
    expect(publicValue).not.toHaveProperty('aiApiKey');
    expect(publicValue.maskedUsername).toContain('@163.com');
  });
});
