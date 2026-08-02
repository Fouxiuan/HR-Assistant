import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import type { JobCatalogResponse, JobDescription } from '@shared/contracts';
import { api, ApiError } from '../../api/client';
import { useFetch } from '../../api/useFetch';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, LoadingState } from '../../components/States';
import type { SettingsSectionHandle, SettingsSectionProps } from '../settings/section';

interface Draft {
  title: string;
  content: string;
  sourceFilename: string;
  updatedBy: string;
}

const emptyDraft: Draft = { title: '', content: '', sourceFilename: '', updatedBy: '' };

const sourceLabels = {
  database: '本机 SQLite 数据库',
  local: '本地目录回退',
} as const;

function dateLabel(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '本地文件';
}

function draftFrom(item: JobDescription): Draft {
  return {
    title: item.title,
    content: item.content,
    sourceFilename: item.sourceFilename || '',
    updatedBy: item.updatedBy || '',
  };
}

export const JobsPage = forwardRef<SettingsSectionHandle, SettingsSectionProps>(function JobsPage({ embedded = false, onDirtyChange }, ref) {
  const { data, error, mutate } = useFetch<JobCatalogResponse>('/api/job-descriptions');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (data?.items.length && !initialized) {
      const first = data.items[0];
      setDraft(draftFrom(first));
      setEditingId(first.id);
      setInitialized(true);
    }
  }, [data, initialized]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const confirmDiscard = () => !dirty || window.confirm('当前 JD 有尚未保存的修改，确定放弃吗？');

  const select = (item: JobDescription) => {
    if (!confirmDiscard()) return;
    setDraft(draftFrom(item));
    setEditingId(item.id);
    setDirty(false);
    setFeedback(null);
  };

  const newJob = () => {
    if (!confirmDiscard()) return;
    setDraft(emptyDraft);
    setEditingId(null);
    setInitialized(true);
    setDirty(false);
    setFeedback(null);
  };

  const chooseFile = async (file?: File) => {
    if (!file) return;
    if (!confirmDiscard()) return;
    if (file.size > 200_000) {
      setFeedback({ text: 'JD 文件不能超过 200 KB', ok: false });
      return;
    }
    const content = await file.text();
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    setDraft({
      ...draft,
      title: heading || file.name.replace(/\.md$/i, ''),
      content,
      sourceFilename: file.name,
    });
    setEditingId(null);
    setDirty(true);
    setFeedback({ text: `已读取 ${file.name}，保存后将写入数据库`, ok: true });
  };

  const save = useCallback(async () => {
    if (!dirty) return;
    if (!draft.title.trim() || !draft.content.trim()) {
      setFeedback({ text: '岗位名称和 JD 内容不能为空', ok: false });
      throw new Error('岗位名称和 JD 内容不能为空');
    }
    setSaving(true);
    setFeedback(null);
    try {
      const path = editingId == null ? '/api/job-descriptions' : `/api/job-descriptions/${editingId}`;
      const result = await api<{ item: JobDescription }>(path, {
        method: editingId == null ? 'POST' : 'PUT',
        body: JSON.stringify({
          title: draft.title,
          content: draft.content,
          sourceFilename: draft.sourceFilename || null,
          updatedBy: draft.updatedBy || null,
        }),
      });
      setEditingId(result.item.id);
      setDraft(draftFrom(result.item));
      setDirty(false);
      setFeedback({ text: editingId == null ? 'JD 已上传到数据库' : 'JD 已更新', ok: true });
      mutate();
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : String(caught);
      setFeedback({ text: message, ok: false });
      throw caught;
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, editingId, mutate]);

  useImperativeHandle(ref, () => ({ save }), [save]);

  if (error) return <ErrorState message={error.message} />;
  if (!data) return <LoadingState label="正在读取 JD 数据库…" />;

  return (
    <>
      {!embedded ? <PageHeader
        eyebrow="JOB DESCRIPTIONS"
        title="JD 管理"
        description="JD 保存在本机 SQLite；可导入 Markdown 或直接编辑更新。"
        actions={<button className="button secondary" type="button" onClick={newJob}>新建 JD</button>}
      /> : null}

      <section className="card jd-source-bar">
        <div>
          <small>当前数据源</small>
          <strong>{sourceLabels[data.source]}</strong>
        </div>
        <span className={`tag ${data.writable ? 'greeted' : 'error'}`}>{data.writable ? '可上传 / 更新' : '只读回退'}</span>
        {data.message ? <p>{data.message}</p> : null}
      </section>

      <div className="jd-layout">
        <section className="table-card jd-list">
          <header><strong>岗位列表</strong><span>{data.items.length} 个 JD</span></header>
          <div className="table-scroll">
            <table>
              <thead><tr><th>岗位</th><th>最近更新</th></tr></thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    key={item.id ?? `local-${item.title}`}
                    className={editingId === item.id && draft.title === item.title ? 'selected' : ''}
                  >
                    <td><button className="table-link" type="button" onClick={() => select(item)} aria-pressed={editingId === item.id && draft.title === item.title}><strong>{item.title}</strong><small>{item.sourceFilename || '在线创建'}</small></button></td>
                    <td><small>{dateLabel(item.updatedAt)}</small><small>{item.updatedBy || '—'}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card form-card jd-editor">
          <div className="jd-editor-title">
            <div><small>{editingId == null ? 'UPLOAD / CREATE' : `EDIT #${editingId}`}</small><h2>{editingId == null ? '上传或新建 JD' : '更新 JD'}</h2></div>
            <div className="settings-inline-actions">
              {embedded ? <button className="button secondary" type="button" onClick={newJob}>新建 JD</button> : null}
              <label className="button secondary file-button">
                选择 Markdown
                <input name="job-markdown-file" type="file" accept=".md,text/markdown,text/plain" onChange={(event) => void chooseFile(event.target.files?.[0])} />
              </label>
            </div>
          </div>
          <div className="field-grid two">
            <label>岗位名称
              <input name="job-title" autoComplete="off" value={draft.title} maxLength={200} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setDirty(true); }} placeholder="例如：酒旅运营专员…" />
            </label>
            <label>更新人（可选）
              <input name="job-updated-by" autoComplete="off" value={draft.updatedBy} maxLength={100} onChange={(event) => { setDraft({ ...draft, updatedBy: event.target.value }); setDirty(true); }} placeholder="例如：张三…" />
            </label>
          </div>
          <label style={{ marginTop: 16 }}>JD Markdown 内容
            <textarea name="job-content" autoComplete="off" rows={20} value={draft.content} onChange={(event) => { setDraft({ ...draft, content: event.target.value }); setDirty(true); }} placeholder="# 岗位名称&#10;&#10;## 岗位职责&#10;…" />
          </label>
          <div className="button-row">
            <span className="metric-inline">{draft.content.length} 字符 {draft.sourceFilename ? `· ${draft.sourceFilename}` : ''}</span>
            <div style={{ flex: 1 }} />
            {feedback ? <span className="form-feedback" role={feedback.ok ? 'status' : 'alert'} aria-live="polite" style={feedback.ok ? undefined : { color: 'var(--red)' }}>{feedback.text}</span> : null}
            {!embedded ? <button className="button primary" type="button" disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : editingId == null ? '上传到数据库' : '保存更新'}
            </button> : null}
          </div>
        </section>
      </div>
    </>
  );
});
