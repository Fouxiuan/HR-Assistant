import type { ResultEntry, RunStatus } from '@shared/contracts';
import { post } from '../../api/client';
import { useFetch } from '../../api/useFetch';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/States';

const stageLabels: Record<string, string> = {
  age: '年龄筛选', keyword: '关键词筛选', detail_open: '详情打开', ai: 'AI 评分',
  ai_threshold: '分数门槛', greet: '已打招呼', greet_failed: '打招呼失败',
  batch_limit: '批次名额', manual_greet: '手动打招呼',
};

export function ResultsPage() {
  const { data: status } = useFetch<RunStatus>('/api/status', 1200);
  const { data = [], mutate } = useFetch<ResultEntry[]>('/api/results', status?.isRunning ? 1500 : 0);

  const greet = async (item: ResultEntry) => {
    await post('/api/greet', { name: item.name, index: item.index, candidate: item });
    await mutate();
  };

  return (
    <>
      <PageHeader eyebrow="SESSION" title="本次结果" description="查看当前运行中每位候选人的处理结果。" />
      {data.length === 0 ? <EmptyState title="还没有处理结果" detail="启动筛选后，候选人会按处理顺序显示在这里。" /> : (
        <section className="result-list">
          {[...data].reverse().map((item, index) => (
            <article className="result-card" key={`${item.name}-${item.timestamp}-${index}`}>
              <div className="result-main">
                <div className="avatar">{item.name.slice(0, 1)}</div>
                <div><h2>{item.name}</h2><p>{item.education} · {item.years} · {item.age || '年龄未知'}</p></div>
              </div>
              <div className="result-score">{item.score == null ? '—' : item.score}<small>AI 分</small></div>
              <div className="result-reason"><span className={`tag ${item.status}`}>{stageLabels[item.stage] || item.stage}</span><p>{item.reason || '无补充说明'}</p></div>
              {item.status === 'rejected' && ['ai_threshold', 'batch_limit'].includes(item.stage) ? (
                <button className="button secondary small" onClick={() => void greet(item)}>手动打招呼</button>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </>
  );
}
