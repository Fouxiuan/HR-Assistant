import { useEffect, useState } from 'react';
import type { BackupStatus } from '@shared/contracts';
import { api, apiUrl } from '../../api/client';

export function DataBackupSection() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<BackupStatus>('/api/data/backup/status').then(setStatus).catch(error => setMessage(String(error))); }, []);

  const exportBackup = async () => {
    setBusy(true); setMessage('正在创建加密备份…');
    try {
      const response = await fetch(apiUrl('/api/data/backup/export'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!response.ok) { const body = await response.json().catch(() => null) as { message?: string } | null; throw new Error(body?.message || '备份导出失败'); }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const name = disposition.match(/filename="([^"]+)"/)?.[1] || 'HR-Assistant.hrbackup';
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href);
      setMessage('加密备份已导出，请妥善保存密码');
      setStatus(await api('/api/data/backup/status'));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const restoreBackup = async () => {
    if (!file || !window.confirm('恢复会停止当前任务并替换本机数据，确定继续吗？')) return;
    setBusy(true); setMessage('正在验证并恢复备份…');
    try {
      const response = await fetch(apiUrl('/api/data/backup/restore'), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Password': encodeURIComponent(password) }, body: file });
      const body = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message || '备份恢复失败');
      setMessage(body?.message || '恢复成功，请重启应用');
      setStatus(await api('/api/data/backup/status'));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return <div className="settings-stack">
    <section className="card form-card"><h2>数据与备份</h2><p className="field-help">备份包含本机 SQLite 数据、PDF 附件、配置、加密密钥与 BOSS Cookie，不包含完整 Chrome 用户目录。</p><label>备份密码<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 8 个字符；密码不可找回" /></label><div className="button-row"><button className="button primary" disabled={busy || password.length < 8} onClick={() => void exportBackup()}>一键导出备份</button></div></section>
    <section className="card form-card"><h2>从备份恢复</h2><p className="field-help">文件和密码会先完成完整校验，失败时不会修改本机数据。</p><label>选择 .hrbackup 文件<input type="file" accept=".hrbackup,application/octet-stream" onChange={event => setFile(event.target.files?.[0] || null)} /></label><div className="button-row"><button className="button danger" disabled={busy || password.length < 8 || !file} onClick={() => void restoreBackup()}>验证并恢复</button></div></section>
    <section className="card"><h2>保护电脑</h2><p>日常数据库是普通 SQLite 文件。建议为 Windows 账户设置强密码，并启用 BitLocker 磁盘加密。</p>{status ? <p className="field-help">最近备份：{status.lastBackupAt || '无'}　最近恢复：{status.lastRestoreAt || '无'}</p> : null}</section>
    {message ? <div className="settings-feedback" role="status">{message}</div> : null}
  </div>;
}
