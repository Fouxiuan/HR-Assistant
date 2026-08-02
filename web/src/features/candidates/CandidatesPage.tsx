import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import type { CandidateDetail, CandidateListResponse, CandidateStats } from '@shared/contracts';
import { ApiError } from '../../api/client';
import { useFetch } from '../../api/useFetch';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Pagination } from '../../components/Pagination';
import { hashSearchParams } from '../../app/navigation';
import { useDialogFocus } from '../../hooks/useDialogFocus';

function formatDate(value: string): string {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

const DOCUMENT_LABELS = { resume: '简历', portfolio: '作品集', other: '附件' } as const;

const CANDIDATE_STATUS: Record<string, { label: string; tone: string }> = {
  greeted: { label: '已打招呼', tone: 'success' },
  rejected: { label: '已跳过', tone: 'warning' },
  error: { label: '异常', tone: 'danger' },
  evaluated: { label: '已完成评估', tone: 'info' },
  imported: { label: '已导入', tone: 'info' },
  pending: { label: '待处理', tone: 'warning' },
  processing: { label: '处理中', tone: 'info' },
  done: { label: '已完成', tone: 'success' },
};

function candidateStatus(status: string | null) {
  return status ? CANDIDATE_STATUS[status] ?? { label: '未知状态', tone: 'neutral' } : { label: '未知状态', tone: 'neutral' };
}

export function CandidatesPage() {
  const initialParams = hashSearchParams();
  const initialSort = initialParams.get('sort');
  const [search, setSearch] = useState(() => initialParams.get('search') || '');
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState(() => initialParams.get('status') || '');
  const [job, setJob] = useState(() => initialParams.get('job') || '');
  const [minScore, setMinScore] = useState(() => initialParams.get('minScore') || '');
  const [source, setSource] = useState(() => initialParams.get('source') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(initialParams.get('page')) || 1));
  const [scoreSort, setScoreSort] = useState<'asc' | 'desc' | null>(() => initialSort === 'score_desc' ? 'desc' : initialSort === 'score_asc' ? 'asc' : null);
  const [timeSort, setTimeSort] = useState<'asc' | 'desc' | null>(() => initialSort === 'time_asc' ? 'asc' : initialSort?.startsWith('score_') ? null : 'desc');
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = Number(initialParams.get('candidate'));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  const closeDetail = useCallback(() => {
    const next = hashSearchParams();
    next.delete('candidate');
    const query = next.toString();
    window.history.replaceState(null, '', `#/candidates${query ? `?${query}` : ''}`);
    setSelectedId(null);
  }, []);
  const openDetail = useCallback((id: number) => {
    const next = hashSearchParams();
    next.set('candidate', String(id));
    window.history.pushState(null, '', `#/candidates?${next}`);
    setSelectedId(id);
  }, []);
  const dialogRef = useDialogFocus<HTMLElement>(selectedId != null, closeDetail);

  useEffect(() => {
    const syncDetailFromUrl = () => {
      const id = Number(hashSearchParams().get('candidate'));
      setSelectedId(Number.isInteger(id) && id > 0 ? id : null);
    };
    window.addEventListener('popstate', syncDetailFromUrl);
    window.addEventListener('hashchange', syncDetailFromUrl);
    return () => {
      window.removeEventListener('popstate', syncDetailFromUrl);
      window.removeEventListener('hashchange', syncDetailFromUrl);
    };
  }, []);

  // Derive sort param from column-level toggles
  let sort = 'time_desc'; // default
  if (timeSort === 'desc') sort = 'time_desc';
  else if (timeSort === 'asc') sort = 'time_asc';
  else if (scoreSort === 'desc') sort = 'score_desc';
  else if (scoreSort === 'asc') sort = 'score_asc';

  const toggleScoreSort = () => {
    setTimeSort(null);
    setPage(1);
    setScoreSort((prev) => prev === 'desc' ? 'asc' : prev === 'asc' ? null : 'desc');
  };
  const toggleTimeSort = () => {
    setScoreSort(null);
    setPage(1);
    setTimeSort((prev) => prev === 'desc' ? 'asc' : prev === 'asc' ? null : 'desc');
  };

  const arrow = (dir: 'asc' | 'desc' | null) => dir === 'desc' ? ' ▾' : dir === 'asc' ? ' ▴' : '';

  const params = new URLSearchParams({ page: String(page), pageSize: '10' });
  params.set('sort', sort);
  if (deferredSearch) params.set('search', deferredSearch);
  if (status) params.set('status', status);
  if (job) params.set('job', job);
  if (minScore) params.set('minScore', minScore);
  if (source) params.set('source', source);

  useEffect(() => {
    const urlParams = new URLSearchParams();
    if (search) urlParams.set('search', search);
    if (status) urlParams.set('status', status);
    if (job) urlParams.set('job', job);
    if (minScore) urlParams.set('minScore', minScore);
    if (source) urlParams.set('source', source);
    if (page > 1) urlParams.set('page', String(page));
    if (sort !== 'time_desc') urlParams.set('sort', sort);
    if (selectedId) urlParams.set('candidate', String(selectedId));
    const query = urlParams.toString();
    window.history.replaceState(null, '', `#/candidates${query ? `?${query}` : ''}`);
  }, [job, minScore, page, search, selectedId, sort, source, status]);

  const { data: stats, error: statsError } = useFetch<CandidateStats>('/api/candidates/stats');
  const { data: list, error: listError } = useFetch<CandidateListResponse>(`/api/candidates?${params}`);
  const { data: detail } = useFetch<CandidateDetail>(selectedId ? `/api/candidates/${selectedId}` : null);
  const error = statsError || listError;

  if (error instanceof ApiError && error.status === 503) {
    return (
      <>
        <PageHeader eyebrow="HISTORY" title="候选人库" description="跨运行查询候选人、简历与评估记录。" />
        <ErrorState message={error.message} />
      </>
    );
  }
  if (error) return <ErrorState message={error.message} />;
  if (!stats || !list) return <LoadingState label="正在读取候选人库…" />;

  const detailCard = (detail?.resumeJson?.card ?? detail?.rawCard ?? null) as Record<string, unknown> | null;
  const detailAttachments = detail?.mailSources
    ?.flatMap((source) => source.attachments)
    .filter((attachment, index, items) => items.findIndex((item) => item.id === attachment.id) === index) ?? [];

  return (
    <>
      <PageHeader eyebrow="HISTORY" title="候选人库" description="跨运行查询候选人、简历与评估记录。" />
      <section className="metric-grid">
        <article><span>候选人</span><strong>{stats.total}</strong></article>
        <article><span>已打招呼</span><strong>{stats.greeted}</strong></article>
        <article><span>平均 AI 分</span><strong>{stats.avgScore ?? '—'}</strong></article>
        <article><span>覆盖岗位</span><strong>{stats.byJob.length}</strong></article>
      </section>
      <section className="card filter-bar">
        <input name="candidate-search" autoComplete="off" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="例如：张三、硕士或品牌运营…" aria-label="搜索人才信息" />
        <select name="candidate-job" autoComplete="off" value={job} onChange={(event) => { setJob(event.target.value); setPage(1); }} aria-label="岗位筛选">
          <option value="">全部岗位</option>
          {stats.byJob.map((item) => <option key={item.jobTitle} value={item.jobTitle}>{item.jobTitle} ({item.count})</option>)}
        </select>
        <select name="candidate-status" autoComplete="off" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="状态筛选">
          <option value="">全部状态</option><option value="greeted">已打招呼</option><option value="rejected">已跳过</option><option value="error">异常</option>
        </select>
        <select name="candidate-source" autoComplete="off" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }} aria-label="来源分类">
          <option value="">全部来源</option><option value="mail">邮件获取</option><option value="greet">主动打招呼</option>
        </select>
        <input name="candidate-min-score" autoComplete="off" type="number" min={0} max={100} value={minScore} onChange={(event) => { setMinScore(event.target.value); setPage(1); }} placeholder="例如：80…" aria-label="最低 AI 分" />
      </section>
      {list.items.length === 0 ? <EmptyState title="没有匹配记录" detail="调整筛选条件，或完成一次运行后再查看。" /> : (
        <section className="table-card">
          <div className="table-scroll">
            <table>
              <thead><tr><th>候选人</th><th>来源分类</th><th>岗位</th><th className="sortable numeric" aria-sort={scoreSort === 'asc' ? 'ascending' : scoreSort === 'desc' ? 'descending' : 'none'}><button className="sort-button" type="button" onClick={toggleScoreSort}>AI 分{arrow(scoreSort)}</button></th><th>状态</th><th className="sortable" aria-sort={timeSort === 'asc' ? 'ascending' : timeSort === 'desc' ? 'descending' : 'none'}><button className="sort-button" type="button" onClick={toggleTimeSort}>评估时间{arrow(timeSort)}</button></th></tr></thead>
              <tbody>
                {list.items.map((item) => {
                  const statusMeta = candidateStatus(item.latest.status);
                  return <tr key={item.id}>
                    <td><button className="table-link" type="button" onClick={() => openDetail(item.id)}><strong>{item.name}</strong><small>{item.education} · {item.years}</small></button></td>
                    <td>{item.hasMailSource ? <span className="tag mail-source">邮件获取</span> : null} {item.hasGreetSource ? <span className="tag greeted">主动打招呼</span> : null}</td>
                    <td>{item.latest.jobTitle || '—'}</td>
                    <td className="numeric">{item.latest.aiScore ?? '—'}</td>
                    <td><span className={`tag candidate-status ${statusMeta.tone}`}>{statusMeta.label}</span></td>
                    <td>{formatDate(item.latest.createdAt)}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={list.pageSize} total={list.total} unit="人" ariaLabel="候选人列表分页" onPageChange={setPage} />
        </section>
      )}
      {selectedId ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={closeDetail}>
          <aside ref={dialogRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby="candidate-dialog-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <button className="drawer-close" type="button" onClick={closeDetail} aria-label="关闭候选人详情">×</button>
            {!detail ? <LoadingState /> : (
              <>
                <header>
                  <span>候选人 #{detail.id}</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <h2 id="candidate-dialog-title" style={{ margin: '8px 0 3px' }}>{detail.name}</h2>
                    {detail.resumeJson || detail.resumeText || detail.rawCard ? (
                      <button
                        className="button primary small"
                        type="button"
                        onClick={() => window.open(`/api/candidates/${detail.id}/resume`, '_blank')}
                        style={{ flexShrink: 0 }}
                      >
                        查看/打印简历 PDF
                      </button>
                    ) : null}
                  </div>
                  <p>{detail.education} · {detail.years}</p>
                </header>
                {detailCard ? (
                  <section>
                    <h3>基本信息</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13 }}>
                      {detailCard.salary ? <div>薪资: {String(detailCard.salary)}</div> : null}
                      {detailCard.age ? <div>年龄: {String(detailCard.age)}</div> : null}
                      {detailCard.status ? <div>状态: {String(detailCard.status)}</div> : null}
                      {detailCard.expected ? <div>期望: {String(detailCard.expected)}</div> : null}
                      {detailCard.advantage ? <div>优势: {String(detailCard.advantage)}</div> : null}
                      {Array.isArray(detailCard.tags) && detailCard.tags.length ? <div>标签: {detailCard.tags.join('、')}</div> : null}
                    </div>
                  </section>
                ) : null}
                <section><h3>简历文本</h3><pre>{detail.resumeText || '尚未保存完整简历'}</pre></section>
                {detailAttachments.length ? (
                  <section><h3>候选人附件（{detailAttachments.length}）</h3>{detailAttachments.map((attachment) => (
                    <button key={attachment.id} className="button secondary small" onClick={() => window.open(`/api/mail/attachments/${attachment.id}`, '_blank')}>
                      【{DOCUMENT_LABELS[attachment.documentType]}】{attachment.displayFilename}
                    </button>
                  ))}</section>
                ) : null}
                {detail.mailSources?.length ? (
                  <section><h3>来源邮件与简历版本</h3>{detail.mailSources.map((source) => (
                    <article className="evaluation" key={source.messageId}>
                      <div><strong>{source.subject}</strong><a href={`#/mail?message=${source.messageId}`}>查看邮件</a></div>
                      <p>{source.matchedJobTitle || '待匹配岗位'} · {source.sender}</p>
                      <small>包含 {source.attachments.length} 个附件</small>
                      <small>{formatDate(source.receivedAt)}</small>
                    </article>
                  ))}</section>
                ) : null}
                <section><h3>评估记录</h3>{detail.evaluations.map((evaluation) => (
                  <article className="evaluation" key={evaluation.id}>
                    <div><strong>{evaluation.jobTitle || '未知岗位'}</strong><span>{evaluation.aiScore ?? '—'} 分</span></div>
                    <p>{evaluation.aiReason || evaluation.detail || '无说明'}</p><small>{formatDate(evaluation.createdAt)}</small>
                  </article>
                ))}</section>
              </>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}
