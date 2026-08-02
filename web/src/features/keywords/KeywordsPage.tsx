import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useState } from 'react';
import type { KeywordConfig, Settings } from '@shared/contracts';
import { post } from '../../api/client';
import { useFetch } from '../../api/useFetch';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/States';
import { hashSearchParams, navigate } from '../../app/navigation';
import type { SettingsSectionHandle, SettingsSectionProps } from '../settings/section';

type ListKey = 'excludeKeywords' | 'genericWords' | 'skillLibrary' | 'preferredCompanies';

const editors: Array<{ key: ListKey; title: string; description: string }> = [
  { key: 'excludeKeywords', title: '排除词', description: '命中任意词时跳过候选人' },
  { key: 'genericWords', title: '通用词', description: '从 JD 自动关键词中排除的低信息词' },
  { key: 'skillLibrary', title: '技能词', description: '命中后参与关键词加分' },
  { key: 'preferredCompanies', title: '青睐公司', description: '经历概览中命中公司名 +5 分权重' },
];

function TagEditor({ values, onChange }: { values: string[]; onChange(values: string[]): void }) {
  const inputId = useId();
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const add = () => {
    const value = input.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setInput('');
  };

  const remove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= values.length) return;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const handleDragStart = (index: number) => { setDragIndex(index); };
  const handleDragOver = (e: React.DragEvent, index: number) => { e.preventDefault(); setDragOverIndex(index); };
  const handleDragLeave = () => { setDragOverIndex(null); };
  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) return;
    const next = [...values];
    const [removed] = next.splice(dragIndex, 1);
    next.splice(index, 0, removed);
    onChange(next);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div>
      <div className="tag-editor">
        {values.map((value, i) => (
          editing ? (
            <div
              key={`${value}-${i}`}
              className={`tag-item${dragOverIndex === i ? ' drag-over' : ''}`}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop(i)}
              onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
            >
              <span>{value}</span>
              <span className="tag-actions">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`上移关键词“${value}”`}>↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === values.length - 1} aria-label={`下移关键词“${value}”`}>↓</button>
                <button className="tag-remove" type="button" onClick={() => remove(i)} aria-label={`删除关键词“${value}”`}>×</button>
              </span>
            </div>
          ) : (
            <span key={`${value}-${i}`} className="tag-item readonly">{value}</span>
          )
        ))}
        {!values.length && <span className="tag-placeholder">暂无条目</span>}
      </div>
      <div className="inline-input">
        <label className="sr-only" htmlFor={inputId}>新增关键词</label>
        <input id={inputId} name={`keyword-${inputId}`} autoComplete="off" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} placeholder="例如：数据分析，输入后按回车…" />
        <button className="button secondary" type="button" onClick={add}>添加</button>
        <button className={`button ${editing ? 'primary' : 'secondary'}`} type="button" onClick={() => setEditing((v) => !v)}>
          {editing ? '完成' : '编辑'}
        </button>
      </div>
    </div>
  );
}

export const KeywordsPage = forwardRef<SettingsSectionHandle, SettingsSectionProps>(function KeywordsPage({ embedded = false, onDirtyChange }, ref) {
  const { data: jobs } = useFetch<string[]>('/api/jobs');
  const { data: settings } = useFetch<Settings>('/api/settings');
  const fromRun = hashSearchParams().get('from') === 'run';
  const [job, setJob] = useState('');
  const endpoint = job ? `/api/config/keywords?job=${encodeURIComponent(job)}` : null;
  const { data, mutate } = useFetch<KeywordConfig>(endpoint);
  const [draft, setDraft] = useState<KeywordConfig | null>(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (settings && !job) setJob(settings.selectedJob || jobs?.[0] || '');
  }, [job, jobs, settings]);
  useEffect(() => { if (data) setDraft(data); }, [data]);
  useEffect(() => { onDirtyChange?.(Boolean(data && draft && JSON.stringify(data) !== JSON.stringify(draft))); }, [data, draft, onDirtyChange]);

  const updateList = (key: ListKey, values: string[]) => setDraft((current) => current ? { ...current, [key]: values } : current);
  const save = useCallback(async () => {
    if (!job || !draft) throw new Error('关键词配置尚未读取完成');
    await post('/api/config/keywords', { job, ...draft });
    setFeedback('关键词配置已保存');
    await mutate();
    if (fromRun) navigate('/run');
  }, [draft, fromRun, job, mutate]);

  useImperativeHandle(ref, () => ({ save }), [save]);

  if (!jobs || !settings || !draft) return <LoadingState label="正在读取关键词配置…" />;

  return (
    <>
      {!embedded ? <PageHeader eyebrow="MATCHING" title="关键词管理" description="为每个岗位维护快筛词库和 AI 提示。" actions={<button className="button primary" onClick={() => void save()}>保存配置</button>} /> : null}
      <section className="card form-card">
        <label>招聘岗位
          <select name="keyword-job" autoComplete="off" value={job} onChange={(event) => { setJob(event.target.value); setDraft(null); }}>
            {jobs.map((title) => <option key={title}>{title}</option>)}
          </select>
        </label>
        {feedback ? <p className="form-feedback" role="status" aria-live="polite">{feedback}</p> : null}
      </section>
      {editors.map((editor) => (
        <section className="card editor-card" key={editor.key}>
          <header><div><h2>{editor.title}</h2><p>{editor.description}</p></div><span>{draft[editor.key].length} 项</span></header>
          <TagEditor values={draft[editor.key]} onChange={(values) => updateList(editor.key, values)} />
        </section>
      ))}
      <section className="card form-card">
        <div className="field-grid two">
          <label>关键词通过阈值
            <input name="keyword-threshold" autoComplete="off" type="number" min={1} max={20} value={draft.matchThreshold} onChange={(event) => setDraft({ ...draft, matchThreshold: Number(event.target.value) })} />
          </label>
          <label>岗位专属 AI 提示词
            <textarea name="keyword-ai-prompt" autoComplete="off" rows={6} value={draft.aiPrompt || ''} onChange={(event) => setDraft({ ...draft, aiPrompt: event.target.value })} placeholder="例如：重点关注品牌活动经验，支持 {jdContent} 和 {resumeText}…" />
          </label>
        </div>
      </section>
    </>
  );
});
