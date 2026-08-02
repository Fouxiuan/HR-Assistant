import keywordConfig from './keywordConfig.js';
import type { CandidateCard } from '../shared/contracts.js';
import type { JobDefinition, LoggerPort } from './core/ports.js';

const BUILT_IN_EXCLUDE_KEYWORDS = [
  '应届', '实习', '兼职', '在校生', '未毕业', '暂无工作经验',
];

/** Score awarded per matched preferred company in candidate work history */
const COMPANY_BONUS = 5;

export interface FilterResult {
  passed: boolean;
  detail: string;
  age?: number | null;
  score?: number;
  matchedPosition?: string[];
  matchedSkill?: string[];
  matchedCompany?: string[];
}

class Matcher {
  private readonly jd: JobDefinition;
  private readonly logger: LoggerPort;
  private readonly excludeKeywords: string[];
  private readonly genericWords: Set<string>;
  private readonly skillLibrary: string[];
  private readonly preferredCompanies: string[];
  private readonly matchThreshold: number;
  private readonly ageMin: number;
  private readonly ageMax: number;

  constructor(jd: JobDefinition, logger: LoggerPort, ageMin = 23, ageMax = 30) {
    this.jd = jd;
    this.logger = logger;
    this.ageMin = ageMin;
    this.ageMax = ageMax;
    const cfg = keywordConfig.getJobConfig(jd?.title);
    this.excludeKeywords = [...new Set([
      ...BUILT_IN_EXCLUDE_KEYWORDS,
      ...(cfg.excludeKeywords || []),
    ])];
    this.genericWords = new Set(cfg.genericWords);
    this.skillLibrary = cfg.skillLibrary;
    this.preferredCompanies = cfg.preferredCompanies || [];
    this.matchThreshold = cfg.matchThreshold;
  }

  ageFilter(card: CandidateCard): FilterResult {
    const text = String(card?.age || '').trim();
    const match = text.match(/(\d{1,3})\s*岁?/);
    if (!match) return { passed: true, age: null, detail: '年龄未知，保留后续筛选' };

    const age = Number(match[1]);
    if (age < this.ageMin || age > this.ageMax) {
      return {
        passed: false,
        age,
        detail: `年龄 ${age} 岁，不在 ${this.ageMin}-${this.ageMax} 岁范围内`,
      };
    }
    return { passed: true, age, detail: `年龄 ${age} 岁，符合范围` };
  }

  private _buildKeywords(): { positionWords: string[]; skillWords: string[] } {
    const title = this.jd?.title || '';
    const content = this.jd?.content || '';

    // 职位词：只从岗位标题提取，按分隔符拆分生成多组关键词
    // 例: "整合营销负责人（酒旅品牌/活动方向）" →
    //   ["整合营销负责人", "整合营销", "酒旅品牌", "活动方向", "酒旅"]
    const titleParts = title
      .replace(/[（(]/g, ' ')
      .replace(/[）)/]/g, ' ')
      .replace(/[/／]/g, ' ')
      .replace(/[＿_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);

    // 再按 2-6 字切分成更细粒度的关键词
    const positionWords: string[] = [];
    for (const part of titleParts) {
      // 整段作为关键词
      if (part.length >= 2 && !this.genericWords.has(part)) {
        positionWords.push(part);
      }
      // 2-6 字子串（从长词中提取有意义的短语）
      const subWords = part.match(/[一-龥]{2,6}/g) || [];
      for (const sw of subWords) {
        if (sw.length >= 2 && !this.genericWords.has(sw) && !positionWords.includes(sw)) {
          positionWords.push(sw);
        }
      }
    }
    // 去重 + 限制数量
    const unique = [...new Set(positionWords)].slice(0, 20);

    // 技能词：从配置的技能库中匹配 JD 内容
    const contentLower = content.toLowerCase();
    const skillWords = this.skillLibrary.filter(kw => contentLower.includes(kw.toLowerCase()));

    return { positionWords: unique, skillWords };
  }

  keywordFilter(card: CandidateCard): FilterResult {
    if (!this.jd) {
      this.logger.warn('没有匹配的 JD，跳过关键词筛选');
      return { passed: true, score: 0, detail: '无JD，默认通过' };
    }

    // 只对结构化字段做匹配，不扫全文本（全文本含城市名等泛词会误匹配）
    const targetFields = [
      card.expected || '',
      card.advantage || '',
      (card.tags || []).join(' '),
      card.name || '',
    ].join(' ').toLowerCase();

    // 排除词检查 — 扫全文本以防漏掉
    const fullText = (card.fullText || '').toLowerCase();
    for (const kw of this.excludeKeywords) {
      if (fullText.includes(kw.toLowerCase())) {
        return { passed: false, score: -1, detail: `包含排除词: ${kw}` };
      }
    }

    const { positionWords, skillWords } = this._buildKeywords();

    let score = 0;
    const matchedPosition: string[] = [];
    const matchedSkill: string[] = [];

    // 职位关键词匹配 +2/词
    for (const word of positionWords) {
      if (targetFields.includes(word.toLowerCase())) {
        score += 2;
        matchedPosition.push(word);
      }
    }

    // 技能词匹配 +1/词
    for (const word of skillWords) {
      if (targetFields.includes(word.toLowerCase())) {
        score += 1;
        matchedSkill.push(word);
      }
    }

    // 青睐公司加分：候选人的 fullText（含经历概览）中命中配置的公司名 +5/公司
    const matchedCompany: string[] = [];
    if (this.preferredCompanies.length > 0) {
      const searchText = (card.fullText || '').toLowerCase();
      for (const company of this.preferredCompanies) {
        const lower = company.trim().toLowerCase();
        if (lower && searchText.includes(lower)) {
          score += COMPANY_BONUS;
          matchedCompany.push(company.trim());
        }
      }
    }

    // 通过条件：得分 >= 阈值
    const passed = score >= this.matchThreshold;
    const detail = passed
      ? `职位词:[${matchedPosition.slice(0, 5).join(',')}] 技能词:[${matchedSkill.slice(0, 5).join(',')}]${matchedCompany.length ? ' 青睐公司:[' + matchedCompany.join(',') + '] +' + (matchedCompany.length * COMPANY_BONUS) : ''} 总分:${score}`
      : `得分不足: ${score} (需要≥${this.matchThreshold})`;

    this.logger.info(`第一层筛选: ${passed ? '通过' : '淘汰'} ${detail}`);
    return { passed, score, detail, matchedPosition, matchedSkill, matchedCompany };
  }
}

export default Matcher;
