import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, resolve } from 'path';
import type { JobCatalogResponse, JobDescription, JobDescriptionInput, JobDescriptionSource } from '../shared/contracts.js';
import config from './config.js';
import type { JobCatalogPort, JobDefinition, LoggerPort } from './core/ports.js';
import { NoopJobDescriptionRepository, type JobDescriptionRepository } from './db/jobDescriptionRepository.js';

interface IndexedJobDefinition extends JobDefinition { keywords: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function extractJobTitle(content: string, fallback: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  const title = match ? match[1].trim() : fallback.replace(/\.md$/i, '');
  return title.replace(/^(职位|岗位|招聘)\s*(名称|标题|岗位)?[：:]\s*/, '');
}

function extractKeywords(content: string): string[] {
  const keywords = new Set<string>();
  for (const line of content.split('\n')) {
    for (const match of line.match(/[\u4e00-\u9fa5]{2,8}/g) || []) keywords.add(match);
  }
  return Array.from(keywords);
}

export function readLocalJobDescriptions(jdDir = config.job.jdDir): JobDescriptionInput[] {
  if (!existsSync(jdDir)) return [];
  return readdirSync(jdDir)
    .filter(file => file.toLowerCase().endsWith('.md'))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((file) => {
      const content = readFileSync(resolve(jdDir, file), 'utf8');
      return { title: extractJobTitle(content, file), content, sourceFilename: file };
    });
}

export function validateJobDescriptionInput(value: unknown): JobDescriptionInput {
  if (!isRecord(value)) throw new Error('JD 请求体格式无效');
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const content = typeof value.content === 'string' ? value.content.trim() : '';
  const sourceFilename = typeof value.sourceFilename === 'string' && value.sourceFilename.trim()
    ? basename(value.sourceFilename.trim()) : null;
  const updatedBy = typeof value.updatedBy === 'string' && value.updatedBy.trim() ? value.updatedBy.trim() : null;
  if (!title) throw new Error('岗位名称不能为空');
  if (title.length > 200) throw new Error('岗位名称不能超过 200 个字符');
  if (!content) throw new Error('JD 内容不能为空');
  if (content.length > 200_000) throw new Error('JD 内容不能超过 200000 个字符');
  if (sourceFilename && sourceFilename.length > 255) throw new Error('文件名过长');
  if (updatedBy && updatedBy.length > 100) throw new Error('更新人不能超过 100 个字符');
  return { title, content, sourceFilename, updatedBy };
}

function indexJob(job: JobDescription): IndexedJobDefinition {
  return { ...job, keywords: extractKeywords(job.content) };
}

class JDLoader implements JobCatalogPort {
  readonly jdDir = config.job.jdDir;
  jds: IndexedJobDefinition[] = [];
  private source: JobDescriptionSource = 'database';
  private sourceMessage = '';

  constructor(
    private readonly logger: LoggerPort,
    private readonly repository: JobDescriptionRepository = new NoopJobDescriptionRepository(),
  ) {}

  private setJobs(items: JobDescription[], source: JobDescriptionSource, message = ''): JobDefinition[] {
    this.jds = items.map(indexJob);
    this.source = source;
    this.sourceMessage = message;
    this.logger.info(`加载了 ${items.length} 个 JD（本机数据）`);
    return this.jds;
  }

  async loadAll(): Promise<JobDefinition[]> {
    if (!this.repository.available) {
      this.logger.error(this.repository.unavailableReason || '本地 JD 数据库不可用');
      return this.setJobs([], 'database', '本地 JD 数据库不可用');
    }
    const records = await this.repository.list();
    if (records.length) return this.setJobs(records, 'database');

    const local = readLocalJobDescriptions(this.jdDir);
    for (const item of local) await this.repository.upsert(item);
    const imported = local.length ? await this.repository.list() : [];
    return this.setJobs(imported, 'database', local.length ? `已从本机目录导入 ${local.length} 个 JD` : '请创建或导入至少一个 JD');
  }

  getCatalog(): JobCatalogResponse {
    return {
      items: this.jds.map(({ keywords: _keywords, ...job }) => job),
      source: this.source,
      writable: true,
      message: this.sourceMessage || undefined,
    };
  }

  async save(value: unknown, id?: number): Promise<JobDescription> {
    if (!this.repository.available) throw new Error(this.repository.unavailableReason || '本地 JD 数据库不可用');
    const input = validateJobDescriptionInput(value);
    const saved = id == null ? await this.repository.upsert(input) : await this.repository.update(id, input);
    if (!saved) throw new Error('未找到要更新的 JD');
    await this.loadAll();
    return saved;
  }

  private normalize(value: string): string {
    return value.toLowerCase()
      .replace(/[_\s]*\d+k?[-~]\d+k?[^\s]*/g, '')
      .replace(/[_\s]*\d+-\d+[^\s]*/g, '')
      .replace(/[，,]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  matchJob(pageTitle: string): JobDefinition | null {
    if (!pageTitle) return null;
    const normalizedTitle = this.normalize(pageTitle);
    const match = this.jds.find((jd) => {
      const jdTitle = this.normalize(jd.title);
      return jdTitle.includes(normalizedTitle)
        || normalizedTitle.includes(jdTitle)
        || jdTitle.split(/[\s/，,]/)[0] === normalizedTitle.split(/[\s/，,]/)[0]
        || jd.keywords.some(keyword => keyword.length > 1 && normalizedTitle.includes(keyword.toLowerCase()));
    });
    if (match) this.logger.info(`匹配到 JD: ${match.title}`);
    else this.logger.warn(`未找到匹配的 JD: ${pageTitle}`);
    return match || null;
  }

  getThreshold(jobTitle: string): number {
    const title = (jobTitle || '').toLowerCase();
    if (title.includes('负责人') || title.includes('总监') || title.includes('经理')) return 80;
    if (title.includes('助理')) return 75;
    if (title.includes('专员') || title.includes('主管')) return 65;
    return 60;
  }
}

export default JDLoader;
