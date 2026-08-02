import type { Express, Request, Response } from 'express';
import type { CandidateListParams } from '../../db/repository.js';
import type { RouteContext } from '../context.js';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function idFrom(request: Request, response: Response): number | null {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ message: '候选人 ID 无效' });
    return null;
  }
  return id;
}

export function registerCandidateRoutes(app: Express, context: RouteContext): void {
  app.get('/api/candidates', async (request: Request, response: Response) => {
    try {
      response.json(await context.candidates.list({
        search: typeof request.query.search === 'string' ? request.query.search : undefined,
        status: typeof request.query.status === 'string' ? request.query.status : undefined,
        job: typeof request.query.job === 'string' ? request.query.job : undefined,
        minScore: optionalNumber(request.query.minScore),
        source: request.query.source === 'mail' || request.query.source === 'greet' ? request.query.source : undefined,
        page: optionalNumber(request.query.page),
        pageSize: optionalNumber(request.query.pageSize),
        sort: typeof request.query.sort === 'string' ? request.query.sort as CandidateListParams['sort'] : undefined,
      }));
    } catch (error) {
      response.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/candidates/stats', async (_request, response) => {
    try { response.json(await context.candidates.stats()); }
    catch (error) { response.status(500).json({ message: error instanceof Error ? error.message : String(error) }); }
  });

  app.get('/api/candidates/failure-stats', async (_request, response) => {
    try { response.json(await context.candidates.failureStats()); }
    catch (error) { response.status(500).json({ message: error instanceof Error ? error.message : String(error) }); }
  });

  app.get('/api/candidates/:id', async (request, response) => {
    const id = idFrom(request, response);
    if (id == null) return;
    try {
      const candidate = await context.candidates.getById(id);
      if (!candidate) { response.status(404).json({ message: '候选人不存在' }); return; }
      response.json(candidate);
    } catch (error) { response.status(500).json({ message: error instanceof Error ? error.message : String(error) }); }
  });

  app.get('/api/candidates/:id/resume', async (request, response) => {
    const id = idFrom(request, response);
    if (id == null) return;
    try {
      const candidate = await context.candidates.getById(id);
      if (!candidate) { response.status(404).json({ message: '候选人不存在' }); return; }
      if (!candidate.resumeJson && !candidate.resumeText) { response.status(404).json({ message: '简历数据不存在' }); return; }
      const card = (candidate.resumeJson?.card ?? candidate.rawCard ?? undefined) as Record<string, unknown> | undefined;
      const tags = Array.isArray(card?.tags) ? (card.tags as string[]).map(escapeHtml).join('、') : '';
      response.type('html').send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${escapeHtml(candidate.name)} 简历</title><style>
body{font-family:"Microsoft YaHei",sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.7}
h1{font-size:28px;margin-bottom:4px}.meta{color:#666;margin-bottom:24px}.section{margin-bottom:28px}
h2{font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:6px;color:#2563eb}
pre{white-space:pre-wrap;font:13px/1.7 "Cascadia Code",monospace;background:#f5f7fa;padding:16px;border-radius:8px}
@media print{body{margin:0}.no-print{display:none}}</style></head><body>
<div class="no-print" style="text-align:right"><button onclick="window.print()">打印 / 导出 PDF</button></div>
<h1>${escapeHtml(candidate.name)}</h1><div class="meta">${escapeHtml(candidate.education)} · ${escapeHtml(candidate.years)}${tags ? ` · ${tags}` : ''}</div>
${candidate.resumeText ? `<div class="section"><h2>简历详情</h2><pre>${escapeHtml(candidate.resumeText)}</pre></div>` : ''}
${candidate.evaluations.length ? `<div class="section"><h2>评估记录</h2>${candidate.evaluations.map((item) =>
  `<p><strong>${escapeHtml(item.jobTitle || '未指定岗位')}</strong> · AI 评分 ${item.aiScore ?? '—'}<br>${escapeHtml(item.aiReason || '')}</p>`).join('')}</div>` : ''}
</body></html>`);
    } catch (error) { response.status(500).json({ message: error instanceof Error ? error.message : String(error) }); }
  });
}
