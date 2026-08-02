import type { ReactNode } from 'react';
import type { RunStatus } from '@shared/contracts';
import { useFetch } from '../api/useFetch';
import type { AppRoute } from './App';

const navigation = [['/guide', '指南', '01'], ['/run', '运行控制', '02'], ['/results', '本次结果', '03'], ['/candidates', '候选人库', '04'], ['/mail', '简历邮箱', '05'], ['/settings', '设置', '06']] as const;
export function Shell({ route, children }: { route: AppRoute; children: ReactNode }) {
  const { data } = useFetch<RunStatus>('/api/status', 1500);
  const phase = data?.phase ?? 'idle';
  return <div className="app-shell"><a className="skip-link" href="#main-content">跳到主要内容</a><aside className="sidebar"><div className="brand"><span className="brand-mark">HR</span><div><strong>HR筛选简历助手</strong><small>本机独立工作区</small></div></div><nav aria-label="主导航">{navigation.map(([to, label, index]) => <a key={to} href={`#${to}`} className={route === to ? 'nav-link active' : 'nav-link'}><span>{index}</span>{label}</a>)}</nav><div className="sidebar-footer" role="status"><div className={`status-dot ${phase}`} /><div><strong>{data?.message ?? '等待服务'}</strong><small>{data?.results ?? 0} 条结果 · 本机数据</small></div></div></aside><main className="main-content" id="main-content" tabIndex={-1}>{children}</main></div>;
}
