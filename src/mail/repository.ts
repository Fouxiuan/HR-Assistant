import type {
  AIResult,
  CandidateCard,
  CandidateMailSource,
  MailMessageDetail,
  MailMessageListResponse,
  MailProcessingStatus,
} from '../../shared/contracts.js';
import type { ParsedPdfAttachment } from './parser.js';

export interface MailListParams {
  search?: string;
  status?: string;
  job?: string;
  page?: number;
  pageSize?: number;
}

export interface MailSyncStateRecord {
  uidValidity: number | null;
  lastUid: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  requiresRebaseline: boolean;
  importedCount: number;
}

export interface ImportMailInput {
  mailboxKey: string;
  uidValidity: number;
  uid: number;
  messageId: string | null;
  subject: string;
  sender: string;
  recipient: string | null;
  receivedAt: Date;
  textBody: string;
  parsedFields: Record<string, string>;
  extractedJobTitle: string | null;
  matchedJob: { id: number | null; title: string } | null;
  card: CandidateCard;
  resumeText: string;
  phone: string | null;
  email: string | null;
  attachments: ParsedPdfAttachment[];
  status: MailProcessingStatus;
  error: string | null;
  evaluation?: AIResult;
}

export interface StoredMailForReprocess {
  id: number;
  candidateId: number | null;
  messageId: string | null;
  subject: string;
  extractedJobTitle: string | null;
  parsedFields: Record<string, string>;
  resumeText: string;
  attachment: {
    id: number;
    filename: string;
    contentType: string;
    data: Buffer;
    documentType: ParsedPdfAttachment['documentType'];
  } | null;
}

export interface MailAttachmentDownload {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface MailRepository {
  readonly available: boolean;
  readonly unavailableReason?: string;
  withSyncLock<T>(task: () => Promise<T>): Promise<T | null>;
  getSyncState(mailboxKey: string): Promise<MailSyncStateRecord | null>;
  saveBaseline(mailboxKey: string, uidValidity: number, lastUid: number): Promise<void>;
  saveSyncResult(mailboxKey: string, values: { uidValidity?: number; lastUid?: number; error?: string | null; requiresRebaseline?: boolean; importedDelta?: number }): Promise<void>;
  messageExists(mailboxKey: string, uidValidity: number, uid: number, messageId: string | null): Promise<boolean>;
  importMessage(input: ImportMailInput): Promise<{ id: number; candidateId: number | null; inserted: boolean }>;
  list(params: MailListParams): Promise<MailMessageListResponse>;
  getMessage(id: number): Promise<MailMessageDetail | null>;
  getCandidateSources(candidateId: number): Promise<CandidateMailSource[]>;
  getAttachment(id: number): Promise<MailAttachmentDownload | null>;
  getForReprocess(id: number): Promise<StoredMailForReprocess | null>;
  saveParsedAttachment(mailId: number, attachmentId: number, text: string, error: string | null, documentType?: ParsedPdfAttachment['documentType']): Promise<void>;
  reconcileCandidate(mailId: number, resumeText: string, phone: string | null, email: string | null): Promise<number | null>;
  updateProcessing(id: number, input: { jobId: number | null; jobTitle: string | null; status: MailProcessingStatus; error: string | null; evaluation?: AIResult }): Promise<void>;
}

export class NoopMailRepository implements MailRepository {
  readonly available = false;
  constructor(readonly unavailableReason = '本地邮件数据库不可用') {}
  async withSyncLock<T>(): Promise<T | null> { return null; }
  async getSyncState(): Promise<null> { return null; }
  async saveBaseline(): Promise<void> {}
  async saveSyncResult(): Promise<void> {}
  async messageExists(): Promise<boolean> { return false; }
  async importMessage(): Promise<{ id: number; candidateId: null; inserted: false }> { return { id: 0, candidateId: null, inserted: false }; }
  async list(params: MailListParams): Promise<MailMessageListResponse> { return { total: 0, page: params.page ?? 1, pageSize: params.pageSize ?? 30, items: [] }; }
  async getMessage(): Promise<null> { return null; }
  async getCandidateSources(): Promise<CandidateMailSource[]> { return []; }
  async getAttachment(): Promise<null> { return null; }
  async getForReprocess(): Promise<null> { return null; }
  async saveParsedAttachment(): Promise<void> {}
  async reconcileCandidate(): Promise<null> { return null; }
  async updateProcessing(): Promise<void> {}
}
