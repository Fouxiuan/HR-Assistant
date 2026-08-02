import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { backup, DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { BackupManifest, BackupStatus } from '../shared/contracts.js';
import { clearAIConfigCache, getAIConfigPath } from './aiConfig.js';
import config from './config.js';
import { getCookiePath } from './cookieJar.js';
import { LOCAL_SCHEMA_VERSION, type LocalDatabase } from './db/localDatabase.js';
import keywordConfig from './keywordConfig.js';
import { getMailConfigPaths, resetMailConfigCache } from './mail/config.js';
import runtimeConfig from './runtimeConfig.js';

const MAGIC = Buffer.from('HRBACKUP', 'ascii');
const FORMAT_VERSION = 1;
const HEADER_SIZE = MAGIC.length + 4 + 16 + 12 + 16;
const ALLOWED_FILES = new Set([
  'data/hr-assistant.sqlite',
  'config/settings.json',
  'config/keywords.json',
  'data/aiConfig.json',
  'data/.ai-config.key',
  'data/mailConfig.json',
  'data/.mail-config.key',
  'data/boss_cookies.json',
]);

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function safePassword(password: string): string {
  if (password.length < 8) throw new Error('备份密码至少需要 8 个字符');
  return password;
}

function encryptArchive(payload: Buffer, password: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(safePassword(password), salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header.writeUInt32BE(FORMAT_VERSION, MAGIC.length);
  salt.copy(header, MAGIC.length + 4);
  iv.copy(header, MAGIC.length + 4 + 16);
  cipher.getAuthTag().copy(header, MAGIC.length + 4 + 16 + 12);
  return Buffer.concat([header, ciphertext]);
}

function decryptArchive(value: Buffer, password: string): Buffer {
  if (value.length <= HEADER_SIZE || !value.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('不是有效的 .hrbackup 文件');
  const version = value.readUInt32BE(MAGIC.length);
  if (version > FORMAT_VERSION) throw new Error('备份格式来自更高版本，当前应用无法恢复');
  if (version !== FORMAT_VERSION) throw new Error('不支持的备份格式版本');
  const saltStart = MAGIC.length + 4;
  const ivStart = saltStart + 16;
  const tagStart = ivStart + 12;
  try {
    const key = scryptSync(safePassword(password), value.subarray(saltStart, ivStart), 32);
    const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(ivStart, tagStart));
    decipher.setAuthTag(value.subarray(tagStart, HEADER_SIZE));
    return Buffer.concat([decipher.update(value.subarray(HEADER_SIZE)), decipher.final()]);
  } catch {
    throw new Error('备份密码错误或文件已被篡改');
  }
}

function packArchive(manifest: BackupManifest, files: Map<string, Buffer>): Buffer {
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(manifestBytes.length);
  const parts: Buffer[] = [header, manifestBytes];
  for (const file of manifest.files) {
    const content = files.get(file.path);
    if (!content) throw new Error(`备份文件缺失：${file.path}`);
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(content.length));
    parts.push(size, content);
  }
  return Buffer.concat(parts);
}

function unpackArchive(value: Buffer): { manifest: BackupManifest; files: Map<string, Buffer> } {
  if (value.length < 4) throw new Error('备份归档已损坏');
  const manifestLength = value.readUInt32BE(0);
  if (manifestLength <= 0 || manifestLength > 2_000_000 || 4 + manifestLength > value.length) throw new Error('备份清单长度无效');
  const manifest = JSON.parse(value.subarray(4, 4 + manifestLength).toString('utf8')) as BackupManifest;
  const files = new Map<string, Buffer>();
  let offset = 4 + manifestLength;
  for (const file of manifest.files || []) {
    if (offset + 8 > value.length) throw new Error(`备份文件长度缺失：${file.path}`);
    const size = Number(value.readBigUInt64BE(offset));
    offset += 8;
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > value.length) throw new Error(`备份文件长度无效：${file.path}`);
    files.set(file.path, value.subarray(offset, offset + size));
    offset += size;
  }
  if (offset !== value.length) throw new Error('备份归档包含未声明数据');
  return { manifest, files };
}

function targetFiles(databasePath: string): Array<{ archivePath: string; sourcePath: string }> {
  return [
    { archivePath: 'data/hr-assistant.sqlite', sourcePath: databasePath },
    { archivePath: 'config/settings.json', sourcePath: runtimeConfig.getFilePath() },
    { archivePath: 'config/keywords.json', sourcePath: keywordConfig.getFilePath() },
    { archivePath: 'data/aiConfig.json', sourcePath: getAIConfigPath() },
    { archivePath: 'data/.ai-config.key', sourcePath: resolve(dirname(getAIConfigPath()), '.ai-config.key') },
    { archivePath: 'data/mailConfig.json', sourcePath: getMailConfigPaths()[0] },
    { archivePath: 'data/.mail-config.key', sourcePath: getMailConfigPaths()[1] },
    { archivePath: 'data/boss_cookies.json', sourcePath: getCookiePath() },
  ];
}

function destinationPath(archivePath: string, databasePath: string): string {
  if (archivePath === 'data/hr-assistant.sqlite') return databasePath;
  if (archivePath.startsWith('config/')) return resolve(dirname(runtimeConfig.getFilePath()), archivePath.slice(7));
  return resolve(config.paths.data, archivePath.slice(5));
}

export class BackupService {
  private state: BackupStatus = { busy: false, operation: 'idle' };

  constructor(private readonly database: LocalDatabase) {
    const lastBackupAt = database.getMeta('backup.lastExportAt') || undefined;
    const lastRestoreAt = database.getMeta('backup.lastRestoreAt') || undefined;
    this.state = { ...this.state, lastBackupAt, lastRestoreAt };
  }

  status(): BackupStatus { return { ...this.state }; }

  async export(password: string): Promise<Buffer> {
    if (this.state.busy) throw new Error('已有备份或恢复任务正在执行');
    this.state = { ...this.state, busy: true, operation: 'exporting', message: '正在创建一致性快照' };
    const workDir = mkdtempSync(resolve(tmpdir(), 'hr-assistant-backup-'));
    try {
      const snapshot = resolve(workDir, 'hr-assistant.sqlite');
      await backup(this.database.connection, snapshot);
      const files = new Map<string, Buffer>();
      const manifestFiles: BackupManifest['files'] = [];
      for (const item of targetFiles(this.database.path)) {
        const source = item.archivePath === 'data/hr-assistant.sqlite' ? snapshot : item.sourcePath;
        if (!existsSync(source)) continue;
        const content = readFileSync(source);
        files.set(item.archivePath, content);
        manifestFiles.push({ path: item.archivePath, size: content.length, sha256: sha256(content) });
      }
      const createdAt = new Date().toISOString();
      const manifest: BackupManifest = {
        format: 'hr-assistant-backup',
        formatVersion: FORMAT_VERSION,
        appVersion: config.version,
        databaseVersion: this.database.schemaVersion,
        createdAt,
        files: manifestFiles,
      };
      const result = encryptArchive(gzipSync(packArchive(manifest, files)), password);
      this.database.setMeta('backup.lastExportAt', createdAt);
      this.state = { busy: false, operation: 'idle', lastBackupAt: createdAt, lastRestoreAt: this.state.lastRestoreAt, message: '备份已创建' };
      return result;
    } catch (error) {
      this.state = { ...this.state, busy: false, operation: 'idle', message: error instanceof Error ? error.message : String(error) };
      throw error;
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  async restore(encrypted: Buffer, password: string): Promise<BackupManifest> {
    if (this.state.busy) throw new Error('已有备份或恢复任务正在执行');
    this.state = { ...this.state, busy: true, operation: 'restoring', message: '正在验证备份' };
    const workDir = mkdtempSync(resolve(tmpdir(), 'hr-assistant-restore-'));
    const rollbackFiles = new Map<string, Buffer | null>();
    try {
      const payload = unpackArchive(gunzipSync(decryptArchive(encrypted, password)));
      if (payload.manifest?.format !== 'hr-assistant-backup' || payload.manifest.formatVersion !== FORMAT_VERSION) throw new Error('备份清单格式无效');
      if (payload.manifest.databaseVersion > LOCAL_SCHEMA_VERSION) throw new Error('备份数据库来自更高版本，当前应用无法恢复');
      if (!Array.isArray(payload.manifest.files)) throw new Error('备份文件清单无效');
      for (const file of payload.manifest.files) {
        if (!ALLOWED_FILES.has(file.path) || file.path.includes('..') || file.path.startsWith('/') || file.path.includes('\\')) throw new Error(`备份包含不允许的路径：${file.path}`);
        const content = payload.files.get(file.path) || Buffer.alloc(0);
        if (content.length !== file.size || sha256(content) !== file.sha256) throw new Error(`备份文件校验失败：${file.path}`);
        writeFileSync(resolve(workDir, file.path.replaceAll('/', '_')), content);
      }
      const databaseEntry = payload.manifest.files.find(file => file.path === 'data/hr-assistant.sqlite');
      if (!databaseEntry) throw new Error('备份缺少 SQLite 数据库');
      const databaseSnapshot = resolve(workDir, databaseEntry.path.replaceAll('/', '_'));
      const validator = new DatabaseSync(databaseSnapshot, { readOnly: true });
      try {
        const integrity = validator.prepare('PRAGMA integrity_check').get() as { integrity_check?: string };
        if (integrity.integrity_check !== 'ok') throw new Error('备份中的 SQLite 数据库完整性检查失败');
        const row = validator.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version?: number };
        if (Number(row.version || 0) > LOCAL_SCHEMA_VERSION) throw new Error('备份数据库来自更高版本');
      } finally { validator.close(); }

      const rollbackDatabase = resolve(workDir, 'rollback.sqlite');
      await backup(this.database.connection, rollbackDatabase);
      for (const file of payload.manifest.files.filter(file => file.path !== 'data/hr-assistant.sqlite')) {
        const target = destinationPath(file.path, this.database.path);
        rollbackFiles.set(target, existsSync(target) ? readFileSync(target) : null);
      }
      try {
        this.database.replaceWith(databaseSnapshot);
        for (const file of payload.manifest.files.filter(file => file.path !== 'data/hr-assistant.sqlite')) {
          const target = destinationPath(file.path, this.database.path);
          mkdirSync(dirname(target), { recursive: true });
          const temporary = `${target}.restore-tmp`;
          copyFileSync(resolve(workDir, file.path.replaceAll('/', '_')), temporary);
          renameSync(temporary, target);
        }
      } catch (error) {
        this.database.replaceWith(rollbackDatabase);
        for (const [target, content] of rollbackFiles) {
          if (content === null) rmSync(target, { force: true });
          else writeFileSync(target, content);
        }
        throw error;
      }
      clearAIConfigCache();
      resetMailConfigCache();
      runtimeConfig.resetCache();
      keywordConfig.resetCache();
      const restoredAt = new Date().toISOString();
      this.database.setMeta('backup.lastRestoreAt', restoredAt);
      this.state = { busy: false, operation: 'idle', lastBackupAt: this.state.lastBackupAt, lastRestoreAt: restoredAt, message: '恢复成功' };
      return payload.manifest;
    } catch (error) {
      this.state = { ...this.state, busy: false, operation: 'idle', message: error instanceof Error ? error.message : String(error) };
      throw error;
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}
