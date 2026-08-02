import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let directory = '';
afterEach(() => { vi.resetModules(); delete process.env.APP_DATA_DIR; delete process.env.APP_CONFIG_DIR; delete process.env.APP_ROOT_DIR; if (directory) rmSync(directory, { recursive: true, force: true }); directory = ''; });

async function fixture() {
  directory = mkdtempSync(join(tmpdir(), 'hr-backup-'));
  const data = join(directory, 'data'); const configuration = join(directory, 'config');
  mkdirSync(data); mkdirSync(configuration);
  process.env.APP_ROOT_DIR = directory; process.env.APP_DATA_DIR = data; process.env.APP_CONFIG_DIR = configuration;
  const { LocalDatabase } = await import('../src/db/localDatabase.js');
  const { BackupService } = await import('../src/backupService.js');
  const database = new LocalDatabase(join(data, 'hr-assistant.sqlite'));
  database.setMeta('setup.completed', 'true');
  writeFileSync(join(data, 'boss_cookies.json'), JSON.stringify({ cookies: 'secret-cookie', savedAt: 'now' }));
  writeFileSync(join(configuration, 'settings.json'), JSON.stringify({ minScore: 88 }));
  return { database, service: new BackupService(database), data, configuration };
}

describe('BackupService', () => {
  it('round-trips SQLite data, settings and BOSS cookies', async () => {
    const { database, service, data, configuration } = await fixture();
    const encrypted = await service.export('correct horse battery staple');
    database.setMeta('setup.completed', 'false');
    writeFileSync(join(data, 'boss_cookies.json'), '{}');
    writeFileSync(join(configuration, 'settings.json'), '{}');
    const manifest = await service.restore(encrypted, 'correct horse battery staple');
    expect(manifest.format).toBe('hr-assistant-backup');
    expect(database.getMeta('setup.completed')).toBe('true');
    expect(readFileSync(join(data, 'boss_cookies.json'), 'utf8')).toContain('secret-cookie');
    expect(readFileSync(join(configuration, 'settings.json'), 'utf8')).toContain('88');
    database.close();
  });

  it('rejects a wrong password before modifying local data', async () => {
    const { database, service } = await fixture();
    const encrypted = await service.export('correct password');
    database.setMeta('sentinel', 'unchanged');
    await expect(service.restore(encrypted, 'wrong password')).rejects.toThrow(/密码错误|篡改/);
    expect(database.getMeta('sentinel')).toBe('unchanged');
    database.close();
  });

  it('rejects a tampered encrypted backup', async () => {
    const { database, service } = await fixture();
    const encrypted = await service.export('correct password');
    encrypted[encrypted.length - 1] ^= 0xff;
    await expect(service.restore(encrypted, 'correct password')).rejects.toThrow(/密码错误|篡改/);
    database.close();
  });

  it('rejects a future backup format version', async () => {
    const { database, service } = await fixture();
    const encrypted = await service.export('correct password');
    encrypted.writeUInt32BE(999, 8);
    await expect(service.restore(encrypted, 'correct password')).rejects.toThrow(/更高版本/);
    database.close();
  });
});
