import { PageHeader } from '../../components/PageHeader';

const steps = [
  ['选择岗位', '从数据库 JD 中选择招聘岗位，并确认 BOSS 页面岗位。'],
  ['启动筛选', '系统打开推荐页，依次执行年龄、关键词与 AI 评分。'],
  ['检查结果', '实时查看运行状态、日志、本次结果与跨运行候选人记录。'],
];

export function GuidePage() {
  return (
    <>
      <PageHeader eyebrow="WORKFLOW" title="使用指南" description="从岗位配置到候选人归档，一次完成筛选和打招呼。" />
      <section className="hero-card">
        <div><span>当前流程</span><strong>关键词快筛 → AI 评分 → 批次优选 → 自动打招呼</strong></div>
        <a className="button primary" href="#/run">配置并开始</a>
      </section>
      <section className="step-grid">
        {steps.map(([title, detail], index) => (
          <article className="step-card" key={title}>
            <span>0{index + 1}</span><h2>{title}</h2><p>{detail}</p>
          </article>
        ))}
      </section>
      <section className="card notice">
        <h2>运行前检查</h2>
        <ul>
          <li>BrowserWing MCP 服务运行在配置端口</li>
          <li>Chrome 已登录 BOSS直聘并允许 BrowserWing 控制</li>
          <li>JD 管理页中的岗位数据均保存在本机 SQLite</li>
          <li>需要 AI 评分时已配置 Dashscope API Key</li>
        </ul>
      </section>
    </>
  );
}
