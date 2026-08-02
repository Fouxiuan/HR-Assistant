import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let temporaryDirectory = '';

afterEach(async () => {
  vi.resetModules();
  delete process.env.APP_DATA_DIR;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = '';
});

describe('AI config storage', () => {
  it('provides a local Ollama preset without requiring an API key', async () => {
    const { PROVIDERS, aiProviderNeedsKey } = await import('../src/aiConfig.js');
    expect(PROVIDERS.ollama).toMatchObject({
      label: 'Ollama（本机）',
      baseUrl: 'http://127.0.0.1:11434/v1',
    });
    expect(aiProviderNeedsKey('ollama')).toBe(false);
    expect(aiProviderNeedsKey('deepseek')).toBe(true);
  });

  it('does not expose a center server URL in standalone configuration', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'dazhahui-ai-config-'));
    process.env.APP_DATA_DIR = temporaryDirectory;
    await writeFile(join(temporaryDirectory, 'aiConfig.json'), JSON.stringify({
      provider: 'deepseek', model: '', baseUrl: 'https://api.deepseek.com', serverUrl: '',
    }));

    const { getAIConfig } = await import('../src/aiConfig.js');
    expect(getAIConfig()).not.toHaveProperty('serverUrl');
  });

  it('migrates a plaintext API key to encrypted storage and clears it when the target changes', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'dazhahui-ai-config-'));
    process.env.APP_DATA_DIR = temporaryDirectory;
    await writeFile(join(temporaryDirectory, 'aiConfig.json'), JSON.stringify({
      provider: 'deepseek',
      apiKey: 'test-secret-key',
      model: 'model',
      baseUrl: 'https://api.deepseek.com',
    }));

    const { getAIConfig, saveAIConfig } = await import('../src/aiConfig.js');
    expect(getAIConfig().apiKey).toBe('test-secret-key');
    const stored = await readFile(join(temporaryDirectory, 'aiConfig.json'), 'utf8');
    expect(stored).not.toContain('test-secret-key');
    expect(stored).toContain('apiKeyEncrypted');

    expect(saveAIConfig({ provider: 'custom', baseUrl: 'https://example.com' }).apiKey).toBe('');
  });
});
