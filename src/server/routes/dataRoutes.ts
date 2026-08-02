import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Express } from 'express';
import { BackupService } from '../../backupService.js';
import type { RouteContext } from '../context.js';

function passwordFromHeader(value: string | undefined): string {
  try { return decodeURIComponent(value || ''); } catch { return ''; }
}

export function registerDataRoutes(app: Express, context: RouteContext): void {
  const backups = new BackupService(context.database);

  app.get('/api/data/backup/status', (_request, response) => response.json(backups.status()));

  app.post('/api/data/backup/export', async (request, response) => {
    try {
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      const data = await backups.export(password);
      const date = new Date().toISOString().slice(0, 10);
      response.setHeader('Content-Type', 'application/octet-stream');
      response.setHeader('Content-Disposition', `attachment; filename="HR-Assistant-${date}.hrbackup"`);
      response.setHeader('Content-Length', String(data.length));
      Readable.from(data).pipe(response);
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/data/backup/restore', async (request, response) => {
    const workDir = mkdtempSync(resolve(tmpdir(), 'hr-assistant-upload-'));
    const uploadPath = resolve(workDir, 'restore.hrbackup');
    try {
      if (!request.is('application/octet-stream')) throw new Error('请以二进制方式上传 .hrbackup 文件');
      const contentLength = Number(request.header('content-length') || 0);
      if (contentLength > 2 * 1024 * 1024 * 1024) throw new Error('备份文件不能超过 2 GB');
      await pipeline(request, createWriteStream(uploadPath, { flags: 'wx' }));
      context.runner.stop();
      await context.mail.close();
      const manifest = await backups.restore(readFileSync(uploadPath), passwordFromHeader(request.header('x-backup-password')));
      await context.jobs.loadAll();
      context.mail.start();
      response.json({ ok: true, manifest, status: backups.status(), message: '恢复成功，建议立即重启应用' });
    } catch (error) {
      context.mail.start();
      response.status(400).json({ message: error instanceof Error ? error.message : String(error) });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
}
