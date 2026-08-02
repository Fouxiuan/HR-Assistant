import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { KeywordConfig } from '../shared/contracts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = process.env.APP_CONFIG_DIR ? resolve(process.env.APP_CONFIG_DIR) : resolve(__dirname, '..', 'config');
const configFile = resolve(configDir, 'keywords.json');

const defaultConfig: KeywordConfig = {
  excludeKeywords: ['应届', '实习', '兼职', '在校生', '未毕业', '暂无工作经验'],
  genericWords: [
    '广州', '北京', '上海', '深圳', '成都', '杭州', '武汉', '长春', '贵阳',
    '岗位', '职责', '要求', '优先', '经验', '工作', '以上', '以下', '不限',
    '学历', '本科', '专科', '专业', '相关', '根据', '需要', '能力', '熟悉',
    '具备', '良好', '较强', '善于', '了解', '负责', '参与', '协助', '具有',
    '任职', '条件', '资格', '技能', '知识', '背景', '方向', '领域', '行业',
    '团队', '管理', '沟通', '协调', '执行', '逻辑', '思维', '学习', '适应',
    '抗压', '责任心', '性格', '开朗', '阳光', '积极', '主动', '乐观',
    '常用', '软件', '办公',
  ],
  skillLibrary: [
    '抖音', '酒店', '景区', '抖音林客','抖音来客','本地生活', 'BD', '运营', '营销',
    '品牌', '活动', '团购',  '数据分析',
    'PMS', 'OTA', '美团', '携程', '字节',
    'GMV', '核销', '直播', '达人', '商务谈判', '新媒体',
    '私域', '用户增长', '内容运营',  '投放', '广告',
    '市场调研', '竞品分析', '策略', '方案', '创意',
    '文案',   '社群', '转化率', 'ROI', '预算',
  ],
  preferredCompanies: [],
  matchThreshold: 3,
};

export interface KeywordStore {
  jobs: Record<string, Partial<KeywordConfig>>;
}

let cached: KeywordStore | null = null;

function resetCache(): void { cached = null; }

function getDefaults(): KeywordConfig {
  return structuredClone(defaultConfig);
}

function getFilePath(): string {
  return configFile;
}

function load(): KeywordStore {
  if (cached) return cached;
  try {
    const raw = readFileSync(configFile, 'utf-8');
    cached = JSON.parse(raw) as KeywordStore;
  } catch {
    cached = { jobs: {} };
    save(cached);
  }
  // 确保 jobs 字段存在
  if (!cached.jobs) cached.jobs = {};
  return cached;
}

function save(data: KeywordStore): void {
  const dir = dirname(configFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configFile, JSON.stringify(data, null, 2), 'utf-8');
  cached = data;
}

// 获取指定职位的配置（合并默认值 + 用户保存的默认 + 职位专属）
function getJobConfig(jobTitle: string): KeywordConfig {
  const store = load();
  const jobKey = jobTitle?.trim() || '__default__';

  // 用户保存的默认配置（未选职位时保存）
  const savedDefaults = store.jobs['__default__'] || {};
  const base = { ...getDefaults(), ...savedDefaults };

  // 职位专属配置
  const jobCfg = store.jobs[jobKey];
  if (!jobCfg || jobKey === '__default__') return base;
  return { ...base, ...jobCfg };
}

// 更新指定职位的配置
function updateJobConfig(jobTitle: string, partial: Partial<KeywordConfig>): KeywordConfig {
  const store = load();
  const jobKey = jobTitle?.trim() || '__default__';
  const existing = store.jobs[jobKey] || {};
  store.jobs[jobKey] = { ...existing, ...partial };
  save(store);
  return getJobConfig(jobTitle);
}

// 获取所有有自定义配置的职位列表（不含 __default__）
function getConfiguredJobs(): string[] {
  const store = load();
  return Object.keys(store.jobs).filter(k => k !== '__default__');
}

// 获取完整存储（给前端用）
function getStore(): KeywordStore {
  return structuredClone(load());
}

function replaceStore(value: KeywordStore): KeywordStore {
  if (!value || typeof value !== 'object' || !value.jobs || typeof value.jobs !== 'object' || Array.isArray(value.jobs)) {
    throw new Error('关键词云端配置格式无效');
  }
  const next = structuredClone(value);
  save(next);
  return getStore();
}

export default { getDefaults, getJobConfig, updateJobConfig, getConfiguredJobs, getStore, replaceStore, getFilePath, resetCache };
