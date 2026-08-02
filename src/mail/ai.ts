import type { AIResult } from '../../shared/contracts.js';
import type { JobDefinition, LoggerPort } from '../core/ports.js';
import { aiProviderNeedsKey } from '../aiConfig.js';
import { getMailConfig } from './config.js';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function parseJson(content: string): Record<string, unknown> {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const object = content.match(/\{[\s\S]*\}/);
  return JSON.parse(fenced?.[1] || object?.[0] || content) as Record<string, unknown>;
}

export class MailAIScorer {
  constructor(private readonly logger: LoggerPort) {}

  isAvailable(): boolean {
    const config = getMailConfig();
    return !!config.aiModel && (!aiProviderNeedsKey(config.aiProvider) || !!config.aiApiKey);
  }

  private async complete(system: string, user: string): Promise<string> {
    const config = getMailConfig();
    if (!config.aiModel) throw new Error('邮件 AI 模型未配置');
    if (aiProviderNeedsKey(config.aiProvider) && !config.aiApiKey) throw new Error('邮件 AI Key 未配置');
    if (config.aiApiKey && !/^[\x20-\x7E]+$/.test(config.aiApiKey)) throw new Error('邮件 AI Key 格式无效');
    const response = await fetch(`${config.aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.aiApiKey ? { Authorization: `Bearer ${config.aiApiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.aiModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`邮件 AI 返回 HTTP ${response.status}: ${text.slice(0, 160)}`);
    }
    const body = await response.json() as ChatCompletionResponse;
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('邮件 AI 响应为空');
    return content;
  }

  async classifyJob(extractedTitle: string, resumeText: string, jobs: JobDefinition[]): Promise<JobDefinition | null> {
    if (!this.isAvailable() || jobs.length === 0) return null;
    const candidates = jobs.map((job, index) => `${index + 1}. ${job.title}`).join('\n');
    const content = await this.complete(
      '你是招聘岗位分类器。只能从给定岗位中选择；不可靠时返回 null。只返回 JSON。',
      `邮件岗位：${extractedTitle || '未知'}\n候选岗位：\n${candidates}\n\n简历摘要：\n${resumeText.slice(0, 3000)}\n\n返回 {"index": 数字或null, "confidence": 0到1}`,
    );
    const parsed = parseJson(content);
    const index = typeof parsed.index === 'number' ? Math.trunc(parsed.index) : null;
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    if (index == null || index < 1 || index > jobs.length || confidence < 0.72) return null;
    return jobs[index - 1];
  }

  async score(resumeText: string, job: JobDefinition): Promise<AIResult> {
    const content = await this.complete(
      '你是严格的招聘匹配评估专家。根据岗位 JD 和简历给出匹配度，只返回 JSON。',
      `岗位：${job.title}\n\nJD：\n${job.content.slice(0, 8000)}\n\n简历：\n${resumeText.slice(0, 8000)}\n\n返回 {"score":0到100整数,"reason":"中文理由","matchedSkills":["技能"]}`,
    );
    const parsed = parseJson(content);
    const score = Math.min(100, Math.max(0, Math.round(Number(parsed.score) || 0)));
    const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 2000) : '无说明';
    const matchedSkills = Array.isArray(parsed.matchedSkills)
      ? parsed.matchedSkills.filter((value): value is string => typeof value === 'string').slice(0, 30)
      : [];
    this.logger.info(`邮件简历 AI 评分完成：${job.title} ${score} 分`);
    return { score, reason, matchedSkills };
  }
}
