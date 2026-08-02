import { ImapFlow } from 'imapflow';
import type {
  MailMessageDetail,
  MailMessageListResponse,
  MailProcessingStatus,
  MailSyncStatus,
} from '../../shared/contracts.js';
import type { JobCatalogPort, JobDefinition, LoggerPort } from '../core/ports.js';
import appConfig from '../config.js';
import { getMailConfig, mailConfigIdentity } from './config.js';
import { MailAIScorer } from './ai.js';
import { extractResumeContacts, parsePdfContent, parseResumeEmail } from './parser.js';
import type {
  MailAttachmentDownload,
  MailListParams,
  MailRepository,
  StoredMailForReprocess,
} from './repository.js';

export interface MailServicePort {
  readonly available: boolean;
  start(): void;
  close(): Promise<void>;
  status(): Promise<MailSyncStatus>;
  syncNow(): Promise<MailSyncStatus>;
  testConnection(): Promise<void>;
  testAI(): Promise<void>;
  rebaseline(): Promise<MailSyncStatus>;
  importExisting(): Promise<MailSyncStatus>;
  list(params: MailListParams): Promise<MailMessageListResponse>;
  getMessage(id: number): Promise<MailMessageDetail | null>;
  getCandidateSources(candidateId: number): ReturnType<MailRepository['getCandidateSources']>;
  getAttachment(id: number): Promise<MailAttachmentDownload | null>;
  reprocess(id: number, jobId?: number): Promise<MailMessageDetail | null>;
}

function createClient(): ImapFlow {
  const config = getMailConfig();
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.authCode },
    logger: false,
    disableAutoIdle: true,
    clientInfo: {
      name: 'BOSS Auto Greet Resume Importer',
      version: appConfig.version,
      vendor: 'BOSSA',
      'support-url': 'https://github.com/',
    },
  });
}

function mailboxNumber(value: bigint | number | undefined): number {
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
}

async function latestMailboxUid(client: ImapFlow): Promise<number> {
  const mailbox = client.mailbox;
  if (!mailbox) return 0;
  const advertisedUidNext = mailboxNumber(mailbox.uidNext);
  if (advertisedUidNext > 0) return advertisedUidNext - 1;
  if (mailbox.exists <= 0) return 0;

  // Some NetEase IMAP accounts omit UIDNEXT from both SELECT and STATUS.
  // Fetching the newest message by sequence number gives us the same cursor
  // without downloading the message body.
  const latest = await client.fetchOne('*', { uid: true });
  const uid = latest && latest.uid ? Number(latest.uid) : 0;
  return Number.isInteger(uid) && uid > 0 ? uid : 0;
}

export class MailService implements MailServicePort {
  readonly available: boolean;
  private readonly ai: MailAIScorer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeClient: ImapFlow | null = null;
  private syncing = false;
  private closed = false;

  constructor(
    private readonly logger: LoggerPort,
    private readonly repository: MailRepository,
    private readonly jobs: JobCatalogPort,
  ) {
    this.available = repository.available;
    this.ai = new MailAIScorer(logger);
  }

  start(): void {
    if (this.timer || !this.available) return;
    this.closed = false;
    this.timer = setInterval(() => void this.syncNow(), 60_000);
    this.timer.unref();
    if (getMailConfig().enabled) void this.syncNow();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const client = this.activeClient;
    this.activeClient = null;
    if (client) await client.logout().catch(() => client.close());
  }

  private async connected<T>(task: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = createClient();
    this.activeClient = client;
    try {
      await client.connect();
      return await task(client);
    } finally {
      if (this.activeClient === client) this.activeClient = null;
      await client.logout().catch(() => client.close());
    }
  }

  async status(): Promise<MailSyncStatus> {
    const config = getMailConfig();
    const state = this.available ? await this.repository.getSyncState(mailConfigIdentity(config)) : null;
    return {
      available: this.available,
      configured: !!config.username && !!config.authCode,
      enabled: config.enabled,
      syncing: this.syncing,
      provider: config.provider,
      mailbox: config.mailbox,
      lastSyncedAt: state?.lastSyncedAt ?? null,
      lastUid: state?.lastUid ?? null,
      lastError: state?.lastError ?? null,
      requiresRebaseline: state?.requiresRebaseline ?? false,
      importedCount: state?.importedCount ?? 0,
      message: this.available ? undefined : this.repository.unavailableReason,
    };
  }

  async testConnection(): Promise<void> {
    const config = getMailConfig();
    if (!config.username || !config.authCode) throw new Error('请先填写邮箱账号和授权码');
    await this.connected(async (client) => {
      const lock = await client.getMailboxLock(config.mailbox);
      lock.release();
    });
  }

  async testAI(): Promise<void> {
    if (!this.ai.isAvailable()) throw new Error('请先填写邮件 AI Key 和模型');
    const fake: JobDefinition = {
      id: null,
      title: '连接测试',
      content: '用于验证 AI 服务是否可访问。',
      sourceFilename: null,
      updatedAt: null,
      updatedBy: null,
    };
    await this.ai.score('这是一份用于连通性测试的模拟简历文本，包含项目经验和工作经历。', fake);
  }

  async rebaseline(): Promise<MailSyncStatus> {
    if (!this.available) throw new Error(this.repository.unavailableReason);
    const config = getMailConfig();
    await this.connected(async (client) => {
      const lock = await client.getMailboxLock(config.mailbox);
      try {
        const mailbox = client.mailbox;
        if (!mailbox) throw new Error('邮箱打开失败');
        const uidValidity = mailboxNumber(mailbox.uidValidity);
        const lastUid = await latestMailboxUid(client);
        await this.repository.saveBaseline(mailConfigIdentity(config), uidValidity, lastUid);
      } finally {
        lock.release();
      }
    });
    return this.status();
  }

  async importExisting(): Promise<MailSyncStatus> {
    if (!this.available) throw new Error(this.repository.unavailableReason);
    if (this.syncing) return this.status();
    const config = getMailConfig();
    await this.connected(async (client) => {
      const lock = await client.getMailboxLock(config.mailbox);
      try {
        const mailbox = client.mailbox;
        if (!mailbox) throw new Error('邮箱打开失败');
        await this.repository.saveBaseline(
          mailConfigIdentity(config),
          mailboxNumber(mailbox.uidValidity),
          0,
        );
      } finally {
        lock.release();
      }
    });
    return this.syncNow();
  }

  private async matchJob(mail: Awaited<ReturnType<typeof parseResumeEmail>>): Promise<JobDefinition | null> {
    await this.jobs.loadAll();
    const direct = this.jobs.matchJob(mail.extractedJobTitle || '');
    if (direct) return direct;
    try {
      return await this.ai.classifyJob(mail.extractedJobTitle || '', mail.primaryResumeText, this.jobs.jds);
    } catch (error) {
      this.logger.warn(`邮件岗位 AI 分类失败：${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async processSource(
    source: Buffer,
    mailboxKey: string,
    uidValidity: number,
    uid: number,
  ): Promise<boolean> {
    const mail = await parseResumeEmail(source);
    if (!mail.isBossResume) return false;
    if (await this.repository.messageExists(mailboxKey, uidValidity, uid, mail.messageId)) return false;

    let status: MailProcessingStatus;
    let error: string | null = null;
    let job: JobDefinition | null = null;
    let evaluation;
    const parseError = mail.attachments.map((attachment) => attachment.parseError).filter(Boolean).join('；');
    if (!mail.primaryResumeText) {
      const hasPortfolio = mail.attachments.some((attachment) => attachment.documentType === 'portfolio');
      status = hasPortfolio ? 'needs_review' : 'parse_failed';
      error = hasPortfolio ? '仅识别到作品集，已保留并等待同一候选人的正式简历' : parseError || 'PDF 未提取到简历文本';
    } else {
      job = await this.matchJob(mail);
      if (!job) {
        status = 'pending_job';
        error = '未可靠匹配到已有 JD';
      } else if (!this.ai.isAvailable()) {
        status = 'pending_ai';
        error = '邮件 AI 未配置';
      } else {
        try {
          evaluation = await this.ai.score(mail.primaryResumeText, job);
          status = 'imported';
        } catch (scoreError) {
          status = 'score_failed';
          error = scoreError instanceof Error ? scoreError.message : String(scoreError);
        }
      }
    }

    const result = await this.repository.importMessage({
      mailboxKey,
      uidValidity,
      uid,
      messageId: mail.messageId,
      subject: mail.subject,
      sender: mail.sender,
      recipient: mail.recipient,
      receivedAt: mail.receivedAt,
      textBody: mail.textBody,
      parsedFields: mail.fields,
      extractedJobTitle: mail.extractedJobTitle,
      matchedJob: job ? { id: job.id, title: job.title } : null,
      card: mail.card,
      resumeText: mail.primaryResumeText,
      phone: mail.phone,
      email: mail.email,
      attachments: mail.attachments,
      status,
      error,
      evaluation,
    });
    if (result.inserted) {
      await this.repository.reconcileCandidate(result.id, mail.primaryResumeText, mail.phone, mail.email);
    }
    if (result.inserted) this.logger.success(`简历邮件已入库：${mail.card.name} / ${job?.title || '待匹配岗位'}`);
    return result.inserted;
  }

  async syncNow(): Promise<MailSyncStatus> {
    if (!this.available) throw new Error(this.repository.unavailableReason);
    const config = getMailConfig();
    if (!config.enabled) return this.status();
    if (!config.username || !config.authCode) throw new Error('邮箱账号或授权码未配置');
    if (this.syncing) return this.status();
    this.syncing = true;
    const mailboxKey = mailConfigIdentity(config);
    try {
      const locked = await this.repository.withSyncLock(async () => {
        await this.connected(async (client) => {
          const mailboxLock = await client.getMailboxLock(config.mailbox);
          try {
            const mailbox = client.mailbox;
            if (!mailbox) throw new Error('邮箱打开失败');
            const uidValidity = mailboxNumber(mailbox.uidValidity);
            const latestUid = await latestMailboxUid(client);
            const uidNext = latestUid + 1;
            const state = await this.repository.getSyncState(mailboxKey);
            if (!state) {
              await this.repository.saveBaseline(mailboxKey, uidValidity, Math.max(0, uidNext - 1));
              this.logger.info('简历邮箱首次启用，已从当前最新邮件建立基线，不导入历史邮件');
              return;
            }
            if (state.requiresRebaseline) throw new Error('邮箱需要在本机设置中重新建立基线');
            if (state.uidValidity !== uidValidity) {
              await this.repository.saveSyncResult(mailboxKey, {
                error: '网易邮箱 UIDVALIDITY 已变化，请在本机设置中重新建立基线',
                requiresRebaseline: true,
              });
              return;
            }
            let lastUid = state.lastUid ?? 0;
            let imported = 0;
            let perMessageError: string | null = null;
            if (uidNext > lastUid + 1) {
              const range = `${lastUid + 1}:*`;
              for await (const message of client.fetch(range, { uid: true, source: true }, { uid: true })) {
                if (this.closed) break;
                const uid = Number(message.uid);
                if (!Number.isInteger(uid) || uid <= lastUid) continue;
                try {
                  if (message.source && await this.processSource(Buffer.from(message.source), mailboxKey, uidValidity, uid)) {
                    imported += 1;
                  }
                } catch (error) {
                  perMessageError = `UID ${uid} 处理失败：${error instanceof Error ? error.message : String(error)}`;
                  this.logger.warn(perMessageError);
                }
                lastUid = uid;
                await this.repository.saveSyncResult(mailboxKey, {
                  uidValidity,
                  lastUid,
                  importedDelta: imported,
                  error: perMessageError,
                });
                imported = 0;
              }
            }
            await this.repository.saveSyncResult(mailboxKey, {
              uidValidity,
              lastUid: Math.max(lastUid, uidNext - 1),
              importedDelta: imported,
              error: perMessageError,
            });
          } finally {
            mailboxLock.release();
          }
        });
      });
      if (locked === null) this.logger.info('已有实例正在同步简历邮箱，本次请求已跳过');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const state = await this.repository.getSyncState(mailboxKey);
      await this.repository.saveSyncResult(mailboxKey, {
        error: message,
        requiresRebaseline: state?.requiresRebaseline ?? false,
      });
      this.logger.warn(`简历邮箱同步失败：${message}`);
    } finally {
      this.syncing = false;
    }
    return this.status();
  }

  list(params: MailListParams): Promise<MailMessageListResponse> {
    return this.repository.list(params);
  }

  getMessage(id: number): Promise<MailMessageDetail | null> {
    return this.repository.getMessage(id);
  }

  getCandidateSources(candidateId: number): ReturnType<MailRepository['getCandidateSources']> {
    return this.repository.getCandidateSources(candidateId);
  }

  getAttachment(id: number): Promise<MailAttachmentDownload | null> {
    return this.repository.getAttachment(id);
  }

  private findJob(id: number | undefined, stored: StoredMailForReprocess): JobDefinition | null {
    if (id != null) return this.jobs.jds.find((job) => job.id === id) ?? null;
    return this.jobs.matchJob(stored.extractedJobTitle || '');
  }

  async reprocess(id: number, jobId?: number): Promise<MailMessageDetail | null> {
    await this.jobs.loadAll();
    const stored = await this.repository.getForReprocess(id);
    if (!stored) return null;
    // A document already classified as a portfolio is archival material only.
    // Never reclassify it during manual reprocessing or let its text reach job AI / scoring.
    if (!stored.resumeText && stored.attachment && stored.attachment.documentType !== 'portfolio') {
      const parsed = await parsePdfContent(
        stored.attachment.data,
        stored.attachment.filename,
        stored.attachment.contentType,
      );
      await this.repository.saveParsedAttachment(
        id,
        stored.attachment.id,
        parsed.text,
        parsed.parseError,
        parsed.documentType,
      );
      stored.attachment.documentType = parsed.documentType;
      stored.resumeText = parsed.documentType === 'resume' ? parsed.text : '';
    }
    const contactText = stored.resumeText || '';
    const contacts = extractResumeContacts(contactText);
    await this.repository.reconcileCandidate(id, stored.resumeText, contacts.phone, contacts.email);
    if (!stored.resumeText) {
      const portfolioOnly = stored.attachment?.documentType === 'portfolio';
      await this.repository.updateProcessing(id, {
        jobId: null,
        jobTitle: null,
        status: portfolioOnly ? 'needs_review' : 'parse_failed',
        error: portfolioOnly
          ? '仅识别到作品集，已与同一候选人的简历版本关联'
          : 'PDF 没有可用于重新处理的文本',
      });
      return this.getMessage(id);
    }
    let job = this.findJob(jobId, stored);
    if (jobId != null && !job) throw new Error('所选 JD 不存在');
    if (!job) {
      try {
        job = await this.ai.classifyJob(stored.extractedJobTitle || '', stored.resumeText, this.jobs.jds);
      } catch { /* 保持待匹配状态。 */ }
    }
    if (!job) {
      await this.repository.updateProcessing(id, {
        jobId: null,
        jobTitle: null,
        status: 'pending_job',
        error: '未可靠匹配到已有 JD',
      });
      return this.getMessage(id);
    }
    if (!this.ai.isAvailable()) {
      await this.repository.updateProcessing(id, {
        jobId: job.id,
        jobTitle: job.title,
        status: 'pending_ai',
        error: '邮件 AI 未配置',
      });
      return this.getMessage(id);
    }
    try {
      const evaluation = await this.ai.score(stored.resumeText, job);
      await this.repository.updateProcessing(id, {
        jobId: job.id,
        jobTitle: job.title,
        status: 'imported',
        error: null,
        evaluation,
      });
    } catch (error) {
      await this.repository.updateProcessing(id, {
        jobId: job.id,
        jobTitle: job.title,
        status: 'score_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return this.getMessage(id);
  }
}
