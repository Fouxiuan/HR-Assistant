import { useEffect, useRef, useState } from 'react';
import type { RunStatus, Settings, StartResult } from '@shared/contracts';
import { post } from '../../api/client';
import { useFetch } from '../../api/useFetch';
import { useLogs } from '../../api/useLogs';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, LoadingState } from '../../components/States';

export function RunPage() {
  const { data: jobs, error: jobsError } = useFetch<string[]>('/api/jobs');
  const { data: settings } = useFetch<Settings>('/api/settings');
  const { data: status, mutate: refreshStatus } = useFetch<RunStatus>('/api/status', 1000);
  const { logs, connected } = useLogs();
  const terminalRef = useRef<HTMLDivElement>(null);
  const [job, setJob] = useState('');
  const [bossJobTitle, setBossJobTitle] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (!settings) return;
    setJob(settings.selectedJob);
    setBossJobTitle(settings.bossJobTitle || settings.selectedJob);
  }, [settings]);

  // Auto-scroll: always follow when running, only near-bottom when idle
  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;
    const running = status?.isRunning;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (running || nearBottom) el.scrollTop = el.scrollHeight;
  }, [logs, status?.isRunning]);

  if (!jobs || !settings) return <LoadingState />;
  if (jobsError) return <ErrorState message={jobsError.message} />;

  const start = async () => {
    if (!job) {
      setFeedback('请选择招聘岗位');
      return;
    }
    const result = await post<StartResult>('/api/start', {
      job,
      bossJobTitle: bossJobTitle || job,
      bossFilters: settings.bossFilters,
    });
    setFeedback(result.message || (result.success ? '任务已启动' : '启动失败'));
    await refreshStatus();
  };

  const stop = async () => {
    await post('/api/stop');
    setFeedback('已发送停止指令');
    await refreshStatus();
  };

  return (
    <div className="run-layout">
      <PageHeader eyebrow="RUN" title="运行控制" description="选择岗位并控制本次筛选流程。" actions={<span className={`connection ${connected ? 'online' : ''}`}>{connected ? 'SSE 已连接' : '轮询模式'}</span>} />
      <section className="card status-panel">
        <div>
          <span className={`status-dot ${status?.phase ?? 'idle'}`} aria-hidden="true" />
          <div role="status" aria-live="polite"><small>当前状态</small><strong>{status?.message ?? '正在读取状态'}</strong></div>
        </div>
        <span className="metric-inline">{status?.results ?? 0} 条结果</span>
      </section>
      <section className="card form-card">
        <div className="field-grid two">
          <label>数据库 JD
            <select name="run-job" autoComplete="off" value={job} onChange={(event) => setJob(event.target.value)}>
              <option value="">请选择岗位</option>
              {jobs.map((title) => <option key={title}>{title}</option>)}
            </select>
          </label>
          <label>BOSS 招聘岗位
            <input name="boss-job-title" autoComplete="off" value={bossJobTitle} onChange={(event) => setBossJobTitle(event.target.value)} placeholder="例如：整合营销负责人…" />
          </label>
        </div>
        <div className="button-row">
          <a className="button secondary" href="#/settings?section=jobs">JD 管理</a>
          <a className="button secondary" href="#/settings?section=keywords&from=run">关键词设置</a>
          <a className="button secondary" href="#/settings?section=runtime&from=run">运行参数设置</a>
          {feedback ? <span className="form-feedback" role="status" aria-live="polite">{feedback}</span> : null}
          <div style={{ flex: 1 }} />
          <button className="button primary" onClick={() => void start()} disabled={status?.isRunning}>开始运行</button>
          <button className="button danger" onClick={() => void stop()} disabled={!status?.isRunning}>停止运行</button>
        </div>
      </section>
      <section className="card compact-info">
        <div><small>最低 AI 分</small><strong>{settings.minScore}</strong></div>
        <div><small>总目标</small><strong>{settings.totalGreetTarget}</strong></div>
      </section>
      <section className="terminal" aria-live="polite" ref={terminalRef}>
        {logs.length ? logs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>) : <div className="terminal-empty">等待新的运行日志…</div>}
      </section>
    </div>
  );
}
