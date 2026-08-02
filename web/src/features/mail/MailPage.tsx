import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import type {
  JobCatalogResponse,
  MailMessageDetail,
  MailMessageListResponse,
  MailProcessingStatus,
  MailSyncStatus,
} from '@shared/contracts';
import { api, ApiError } from '../../api/client';
import { useFetch } from '../../api/useFetch';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Pagination } from '../../components/Pagination';
import { MailSettingsPanel } from './MailSettingsPanel';
import { hashSearchParams } from '../../app/navigation';
import { useDialogFocus } from '../../hooks/useDialogFocus';

const STATUS_LABELS: Record<MailProcessingStatus, string> = {
  imported: '已入库并评分',
  pending_job: '待选择岗位',
  pending_ai: '待 AI 评分',
  parse_failed: '简历解析失败',
  score_failed: '评分失败',
  needs_review: '待人工确认',
};

function formatDate(value: string): string {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

export function MailPage() {
  const initialParams = hashSearchParams();
  const [view, setView] = useState<'messages' | 'settings'>(() => initialParams.get('view') === 'settings' ? 'settings' : 'messages');
  const [search, setSearch] = useState(() => initialParams.get('search') || '');
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState(() => initialParams.get('status') || '');
  const [jobFilter, setJobFilter] = useState(() => initialParams.get('job') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(initialParams.get('page')) || 1));
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = Number(initialParams.get('message'));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const closeDetail = useCallback(() => {
    const next = hashSearchParams();
    next.delete('message');
    const query = next.toString();
    window.history.replaceState(null, '', `#/mail${query ? `?${query}` : ''}`);
    setSelectedId(null);
  }, []);
  const openDetail = useCallback((id: number) => {
    const next = hashSearchParams();
    next.set('message', String(id));
    window.history.pushState(null, '', `#/mail?${next}`);
    setSelectedId(id);
  }, []);
  const selectView = useCallback((nextView: 'messages' | 'settings') => {
    const next = hashSearchParams();
    if (nextView === 'settings') next.set('view', 'settings');
    else next.delete('view');
    const query = next.toString();
    window.history.pushState(null, '', `#/mail${query ? `?${query}` : ''}`);
    setView(nextView);
  }, []);
  const dialogRef = useDialogFocus<HTMLElement>(selectedId != null, closeDetail);

  useEffect(() => {
    const syncPanelsFromUrl = () => {
      const next = hashSearchParams();
      const id = Number(next.get('message'));
      setSelectedId(Number.isInteger(id) && id > 0 ? id : null);
      setView(next.get('view') === 'settings' ? 'settings' : 'messages');
    };
    window.addEventListener('popstate', syncPanelsFromUrl);
    window.addEventListener('hashchange', syncPanelsFromUrl);
    return () => {
      window.removeEventListener('popstate', syncPanelsFromUrl);
      window.removeEventListener('hashchange', syncPanelsFromUrl);
    };
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams();
    if (view === 'settings') urlParams.set('view', 'settings');
    if (search) urlParams.set('search', search);
    if (statusFilter) urlParams.set('status', statusFilter);
    if (jobFilter) urlParams.set('job', jobFilter);
    if (page > 1) urlParams.set('page', String(page));
    if (selectedId) urlParams.set('message', String(selectedId));
    const query = urlParams.toString();
    window.history.replaceState(null, '', `#/mail${query ? `?${query}` : ''}`);
  }, [jobFilter, page, search, selectedId, statusFilter, view]);

  const params = new URLSearchParams({ page: String(page), pageSize: '10' });
  if (deferredSearch) params.set('search', deferredSearch);
  if (statusFilter) params.set('status', statusFilter);
  if (jobFilter) params.set('job', jobFilter);

  const { data: syncStatus, error: statusError, mutate: refreshStatus } = useFetch<MailSyncStatus>('/api/mail/status', 15_000);
  const { data: messages, error: listError, mutate: refreshMessages } = useFetch<MailMessageListResponse>(`/api/mail/messages?${params}`);
  const { data: detail, mutate: refreshDetail } = useFetch<MailMessageDetail>(selectedId ? `/api/mail/messages/${selectedId}` : null);
  const { data: jobs } = useFetch<JobCatalogResponse>('/api/job-descriptions');

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setFeedback('');
    try {
      await action();
      setFeedback(success);
      refreshStatus();
      refreshMessages();
      if (selectedId) refreshDetail();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const chooseJob = async (mailId: number, jobId: number) => {
    await run(
      () => api(`/api/mail/messages/${mailId}/job`, { method: 'PUT', body: JSON.stringify({ jobId }) }),
      '岗位已更新并重新评分',
    );
  };

  const error = statusError || listError;
  const header = (
    <PageHeader
      eyebrow="MAIL"
      title="简历邮箱"
      description="配置招聘邮箱，并将新收到的 BOSS 简历保存到本机候选人库。"
      actions={view === 'messages' && syncStatus ? (
        <button
          className="button primary"
          disabled={busy || !syncStatus.enabled || syncStatus.requiresRebaseline}
          onClick={() => run(() => api('/api/mail/sync', { method: 'POST', body: '{}' }), '同步完成')}
        >
          {syncStatus.syncing || busy ? '同步中…' : '立即同步'}
        </button>
      ) : undefined}
    />
  );
  const viewNavigation = (
    <nav className="mail-view-tabs" aria-label="简历邮箱功能">
      <button type="button" className={view === 'messages' ? 'active' : ''} aria-pressed={view === 'messages'} onClick={() => selectView('messages')}><strong>邮件列表</strong><small>查看导入与处理状态</small></button>
      <button type="button" className={view === 'settings' ? 'active' : ''} aria-pressed={view === 'settings'} onClick={() => selectView('settings')}><strong>邮箱设置</strong><small>账号、授权码与识别 AI</small></button>
    </nav>
  );

  if (view === 'settings') {
    return (
      <>
        {header}
        {viewNavigation}
        <MailSettingsPanel requiresRebaseline={syncStatus?.requiresRebaseline} onChanged={() => { refreshStatus(); refreshMessages(); }} />
      </>
    );
  }

  if (error instanceof ApiError && error.status === 401) {
    return (
      <>
        {header}
        {viewNavigation}
        <ErrorState message="邮件列表仅允许从本机应用访问，请重新打开应用。" />
      </>
    );
  }
  if (error) return <>{header}{viewNavigation}<ErrorState message={error.message} /></>;
  if (!syncStatus || !messages) return <>{header}{viewNavigation}<LoadingState label="正在读取简历邮件…" /></>;

  const candidateDocuments = detail?.candidateAttachments?.length ? detail.candidateAttachments : detail?.attachments ?? [];
  const resumeAttachments = candidateDocuments.filter((attachment) => attachment.documentType === 'resume');
  const portfolioAttachments = candidateDocuments.filter((attachment) => attachment.documentType === 'portfolio');
  const renderAttachment = (attachment: MailMessageDetail['attachments'][number]) => (
    <article className="mail-attachment" key={attachment.id}>
      <div><strong>{attachment.displayFilename}</strong><small>{Math.ceil(attachment.size / 1024)} KB · 提取 {attachment.textLength} 字</small></div>
      <button className="button secondary small" type="button" onClick={() => window.open(`/api/mail/attachments/${attachment.id}`, '_blank')}>预览 / 下载</button>
    </article>
  );

  return (
    <>
      {header}
      {viewNavigation}

      <section className="mail-status-grid">
        <article className="card"><small>邮箱状态</small><strong>{syncStatus.enabled ? '已启用' : '未启用'}</strong><span>{syncStatus.provider || '网易'} · {syncStatus.mailbox || 'INBOX'}</span></article>
        <article className="card"><small>累计导入</small><strong>{syncStatus.importedCount ?? 0}</strong><span>封 BOSS 简历邮件</span></article>
        <article className="card"><small>最后同步</small><strong>{formatDate(syncStatus.lastSyncedAt || '')}</strong><span>最后 UID {syncStatus.lastUid ?? '—'}</span></article>
      </section>
      {syncStatus.lastError || syncStatus.requiresRebaseline ? (
        <section className="state-card danger" role="alert">
          {syncStatus.lastError || '邮箱 UIDVALIDITY 已变化，需要在本机设置中重新建立基线。'}
          {syncStatus.requiresRebaseline ? <button className="button danger small" onClick={() => selectView('settings')}>前往邮箱设置</button> : null}
        </section>
      ) : null}
      {feedback ? <p className={/失败|错误|无效|请/.test(feedback) ? 'mail-feedback error' : 'mail-feedback'} role={/失败|错误|无效|请/.test(feedback) ? 'alert' : 'status'} aria-live="polite">{feedback}</p> : null}

      <section className="card mail-filter-bar">
        <label className="sr-only" htmlFor="mail-search">搜索简历邮件</label>
        <input id="mail-search" name="mail-search" autoComplete="off" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="例如：张三、品牌负责人或邮箱…" />
        <label className="sr-only" htmlFor="mail-job-filter">按岗位筛选</label>
        <select id="mail-job-filter" name="mail-job-filter" autoComplete="off" value={jobFilter} onChange={(event) => { setJobFilter(event.target.value); setPage(1); }}>
          <option value="">全部岗位</option>{jobs?.items.map((job) => <option key={job.id || job.title} value={job.title}>{job.title}</option>)}
        </select>
        <label className="sr-only" htmlFor="mail-status-filter">按处理状态筛选</label>
        <select id="mail-status-filter" name="mail-status-filter" autoComplete="off" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
          <option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </section>

      {messages.items.length === 0 ? <EmptyState title="暂无简历邮件" detail="启用邮箱后，只会导入启用时间之后收到的新 BOSS 简历。" /> : (
        <section className="table-card">
          <div className="table-scroll"><table><thead><tr><th>候选人 / 主题</th><th>岗位</th><th>状态</th><th>接收时间</th></tr></thead>
            <tbody>{messages.items.map((item) => (
              <tr key={item.id}>
                <td><button className="table-link" type="button" onClick={() => openDetail(item.id)}><strong>{item.candidateName || '待确认候选人'}</strong><small>{item.subject}</small></button></td>
                <td>{item.matchedJobTitle || item.extractedJobTitle || '—'}</td>
                <td><span className={`tag mail-${item.status}`}>{STATUS_LABELS[item.status]}</span>{item.error ? <small>{item.error}</small> : null}</td>
                <td>{formatDate(item.receivedAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <Pagination page={page} pageSize={messages.pageSize} total={messages.total} unit="封" ariaLabel="简历邮件列表分页" onPageChange={setPage} />
        </section>
      )}

      {selectedId ? (
        <div className="drawer-backdrop" role="presentation" onMouseDown={closeDetail}>
          <aside ref={dialogRef} className="drawer mail-drawer" role="dialog" aria-modal="true" aria-labelledby="mail-dialog-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <button className="drawer-close" type="button" onClick={closeDetail} aria-label="关闭邮件详情">×</button>
            {!detail ? <LoadingState /> : (
              <>
                <header><span>简历邮件 #{detail.id}</span><h2 id="mail-dialog-title">{detail.candidateName || '待确认候选人'}</h2><p>{detail.subject}</p></header>
                <section className="mail-detail-meta">
                  <div><small>发件人</small><strong>{detail.sender}</strong></div><div><small>接收时间</small><strong>{formatDate(detail.receivedAt)}</strong></div>
                  <div><small>匹配岗位</small><strong>{detail.matchedJobTitle || '待选择'}</strong></div><div><small>状态</small><strong>{STATUS_LABELS[detail.status]}</strong></div>
                </section>
                {(detail.status === 'pending_job' || (detail.status === 'needs_review' && detail.attachments.some((item) => item.documentType === 'resume'))) && jobs ? (
                  <section><h3>人工选择 JD</h3><label>匹配岗位<select name="mail-job-choice" autoComplete="off" defaultValue="" onChange={(event) => event.target.value && chooseJob(detail.id, Number(event.target.value))}>
                    <option value="">请选择岗位…</option>{jobs.items.filter((job) => job.id != null).map((job) => <option key={job.id} value={job.id!}>{job.title}</option>)}
                  </select></label></section>
                ) : null}
                <section className="mail-document-groups">
                  <div className="mail-document-group"><h3>简历：</h3>{resumeAttachments.length ? resumeAttachments.map(renderAttachment) : <p className="mail-document-empty">该人才暂无简历</p>}</div>
                  <div className="mail-document-group"><h3>作品集：</h3>{portfolioAttachments.length ? portfolioAttachments.map(renderAttachment) : <p className="mail-document-empty">该人才暂无作品集</p>}</div>
                </section>
                <section><h3>邮件正文</h3><pre>{detail.textBody || '无纯文本正文'}</pre></section>
                <div className="button-row"><button className="button secondary" disabled={busy} onClick={() => run(() => api(`/api/mail/messages/${detail.id}/reprocess`, { method: 'POST', body: '{}' }), '已重新处理')}>重新处理</button></div>
              </>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}
