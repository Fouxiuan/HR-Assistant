import keywordConfig from './keywordConfig.js';
import { aiProviderNeedsKey, getAIConfig } from './aiConfig.js';
import type { AIResult } from '../shared/contracts.js';
import type { LoggerPort, ScorerPort } from './core/ports.js';

/** Node.js fetch rejects non-Latin1 (non-ASCII) characters in HTTP header values */
function isAscii(s: string): boolean {
  return Array.from(s).every(character => character.charCodeAt(0) <= 0x7f);
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

class AIScorer implements ScorerPort {
  constructor(private readonly logger: LoggerPort) {}

  isAvailable(): boolean {
    const aiCfg = getAIConfig();
    return !!aiCfg.model && (!aiProviderNeedsKey(aiCfg.provider) || !!aiCfg.apiKey);
  }

  async score(resumeText: string, jdContent: string, jobTitle: string, signal?: AbortSignal): Promise<AIResult> {
    if (!this.isAvailable()) {
      this.logger.warn('AI API Key 未配置，跳过 AI 打分');
      return { score: 50, reason: 'AI 未启用，默认 50 分', matchedSkills: [] };
    }

    if (!resumeText || resumeText.length < 20) {
      this.logger.warn(`简历内容过短 (${resumeText?.length || 0} 字符)，跳过 AI 打分`);
      return { score: 0, reason: '简历内容不足，无法评估', matchedSkills: [] };
    }

    const aiCfg = getAIConfig();

    // Node.js fetch rejects non-Latin1 (non-ASCII) chars in headers; catch early
    if (aiCfg.apiKey && !isAscii(aiCfg.apiKey)) {
      this.logger.error('API Key 包含非 ASCII 字符（如中文），请到 AI 配置页面填写真实的 API Key');
      return { score: 50, reason: 'API Key 无效（含非 ASCII 字符），默认 50 分', matchedSkills: [] };
    }

    this.logger.action(`AI 匹配度打分 — 简历 ${resumeText.length} 字符`);
    const prompt = this._buildPrompt(resumeText, jdContent, jobTitle);

    try {
      const response = await fetch(`${aiCfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(aiCfg.apiKey ? { 'Authorization': `Bearer ${aiCfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: aiCfg.model,
          messages: [
            {
              role: 'system',
              content: '你是一个严格的招聘匹配评估专家。请根据岗位JD和候选人简历，评估匹配度并返回JSON。'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 1024,
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`AI API ${response.status}: ${errText.slice(0, 100)}`);
      }

      const data = await response.json() as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content || '';
      const result = this._parseScore(content);

      this.logger.info(`AI 评分结果: ${result.score} 分 — ${result.reason}`);
      if (result.matchedSkills?.length) {
        this.logger.info(`匹配技能: ${result.matchedSkills.join(', ')}`);
      }

      return result;
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      if (signal?.aborted) throw err;
      this.logger.error(`AI 打分失败: ${err.message}`);
      return { score: 50, reason: `AI 调用失败: ${err.message}，默认 50 分`, matchedSkills: [] };
    }
  }

  private _buildPrompt(resumeText: string, jdContent: string, jobTitle: string): string {
    // 简历文本截取前 6000 字符避免 token 超限
    const truncatedResume = (resumeText || '').slice(0, 6000);

    // 检查是否有岗位专属 AI 提示词
    const jobCfg = keywordConfig.getJobConfig(jobTitle);
    if (jobCfg?.aiPrompt) {
      return jobCfg.aiPrompt
        .replace('{jdContent}', jdContent)
        .replace('{resumeText}', truncatedResume);
    }

    // 通用提示词
    const preferredCompanies = jobCfg.preferredCompanies?.filter(Boolean) || [];

    let companyHint = '';
    if (preferredCompanies.length > 0) {
      companyHint = `\n\n青睐公司（候选人在以下公司有工作经历时权重明显提升）：\n${preferredCompanies.join('、')}`;
    }

    return `请评估以下候选人与岗位的匹配度。

岗位名称：${jobTitle}

岗位JD：
${jdContent}${companyHint}

候选人简历（完整文本，含工作经历和技能）：
${truncatedResume}

请严格按以下 JSON 格式返回，不要包含其他内容：
{
  "score": 0-100 的整数,
  "reason": "简短说明匹配或不匹配的理由（中文）",
  "matchedSkills": ["匹配的技能/经验1", "匹配的技能/经验2"]
}

评分参考标准：
- 90-100: 高度匹配，核心经验和技能完全符合
- 70-89: 匹配良好，大部分要求满足
- 如果有青睐公司经历且岗位相关，至少 75 分
- 50-69: 部分匹配，有相关经验但不够全面
- 0-49: 匹配度低，缺乏核心要求`;
  }

  private _parseScore(content: string): AIResult {
    try {
      // 尝试提取 JSON 块
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('未找到 JSON');
      }
      const json = jsonMatch[1] || jsonMatch[0];
      const result = JSON.parse(json);
      return {
        score: Math.min(100, Math.max(0, parseInt(result.score, 10) || 0)),
        reason: result.reason || '无说明',
        matchedSkills: Array.isArray(result.matchedSkills) ? result.matchedSkills : [],
      };
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      this.logger.error(`解析 AI 返回失败: ${err.message}`);
      this.logger.error(`AI 原始返回: ${content.slice(0, 200)}`);
      return { score: 50, reason: 'AI 返回解析失败，默认 50 分', matchedSkills: [] };
    }
  }
}

export default AIScorer;
