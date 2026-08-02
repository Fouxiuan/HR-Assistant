import { createHash } from 'crypto';
import { simpleParser, type AddressObject, type Attachment } from 'mailparser';
import { PDFParse } from 'pdf-parse';
import type { CandidateCard, MailDocumentType } from '../../shared/contracts.js';

export const MAX_MAIL_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const BOSS_RESUME_DOMAINS = new Set([
  'notice.bosszhipin.com',
  'service.bosszhipin.com',
  'service.zhipin.com',
]);

export interface ParsedPdfAttachment {
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  content: Buffer;
  text: string;
  parseError: string | null;
  documentType: MailDocumentType;
}

export interface ParsedResumeMail {
  messageId: string | null;
  subject: string;
  sender: string;
  recipient: string | null;
  receivedAt: Date;
  textBody: string;
  extractedJobTitle: string | null;
  fields: Record<string, string>;
  phone: string | null;
  email: string | null;
  card: CandidateCard;
  attachments: ParsedPdfAttachment[];
  primaryResumeText: string;
  isBossResume: boolean;
  recognitionError: string | null;
}

function firstAddress(value?: AddressObject | AddressObject[]): string {
  const object = Array.isArray(value) ? value[0] : value;
  return object?.value?.[0]?.address?.trim().toLowerCase() ?? '';
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractLabeledValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[：:]\\s*([^\\n]{1,160})`, 'i'));
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function parseSubject(subject: string): {
  name: string;
  years: string;
  jobTitle: string;
  city: string;
  salary: string;
  valid: boolean;
} {
  const parts = subject.split('|').map((part) => part.trim());
  const middle = parts[1] ?? '';
  const tail = (parts[2] ?? '').replace(/【BOSS直聘】\s*$/, '').trim();
  const application = middle.match(/^(.*?)\s*[，,]\s*应聘\s+(.+)$/);
  const citySalary = tail.match(/^(.+?)(\d+(?:\.\d+)?-\d+(?:\.\d+)?K.*)$/i);
  return {
    name: parts[0] ?? '',
    years: application?.[1]?.trim() ?? '',
    jobTitle: application?.[2]?.trim() ?? '',
    city: citySalary?.[1]?.trim() ?? '',
    salary: citySalary?.[2]?.trim() ?? '',
    valid: parts.length === 3 && /【BOSS直聘】\s*$/.test(subject) && !!application,
  };
}

function normalizePhone(text: string): string | null {
  const match = text.match(/(?<!\d)(?:\+?86[-\s]?)?(1[3-9]\d{9})(?!\d)/);
  return match?.[1] ?? null;
}

function normalizeEmail(text: string): string | null {
  const match = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match?.[0]?.toLowerCase() ?? null;
}

const RESUME_SECTION_PATTERNS = [
  /求职意向/,
  /工作(?:经历|经验)/,
  /项目经历/,
  /教育(?:经历|背景)/,
  /个人优势/,
  /专业技能/,
];

export function extractResumeContacts(text: string): { phone: string | null; email: string | null } {
  return { phone: normalizePhone(text), email: normalizeEmail(text) };
}

export function classifyPdfDocument(text: string, filename = ''): MailDocumentType {
  if (/(?:作品集|portfolio)/i.test(filename)) return 'portfolio';
  const normalized = normalizeText(text);
  if (!normalized) return 'other';
  const sectionCount = RESUME_SECTION_PATTERNS.filter((pattern) => pattern.test(normalized)).length;
  const contacts = extractResumeContacts(normalized);
  if (sectionCount >= 2 || (sectionCount >= 1 && !!(contacts.phone || contacts.email)) || (!!contacts.phone && !!contacts.email)) {
    return 'resume';
  }
  return 'portfolio';
}

export async function parsePdfContent(
  content: Buffer,
  filename = 'resume.pdf',
  contentType = 'application/octet-stream',
): Promise<ParsedPdfAttachment> {
  const sha256 = createHash('sha256').update(content).digest('hex');
  const hasPdfHeader = content.subarray(0, 5).equals(Buffer.from('%PDF-'));
  let text = '';
  let parseError: string | null = null;

  if (content.length > MAX_ATTACHMENT_BYTES) {
    parseError = 'PDF 附件超过 10 MB';
  } else if (!hasPdfHeader) {
    parseError = '附件扩展名为 PDF，但文件头无效';
  } else {
    const parser = new PDFParse({ data: content });
    try {
      const result = await parser.getText();
      text = normalizeText(result.text || '');
      if (text.length < 50) parseError = 'PDF 未提取到足够文本，可能是扫描图片或加密文件';
    } catch (error) {
      parseError = `PDF 解析失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  return {
    filename,
    contentType,
    size: content.length,
    sha256,
    content,
    text,
    parseError,
    documentType: parseError ? (hasPdfHeader ? 'portfolio' : 'other') : classifyPdfDocument(text, filename),
  };
}

async function parsePdf(attachment: Attachment): Promise<ParsedPdfAttachment> {
  return parsePdfContent(
    Buffer.from(attachment.content),
    attachment.filename || 'resume.pdf',
    attachment.contentType || 'application/octet-stream',
  );
}

export async function parseResumeEmail(source: Buffer): Promise<ParsedResumeMail> {
  if (source.length > MAX_MAIL_BYTES) throw new Error('邮件超过 25 MB');
  const mail = await simpleParser(source, {
    skipHtmlToText: false,
    skipTextToHtml: true,
  });
  const subject = (mail.subject || '').trim();
  const sender = firstAddress(mail.from);
  const recipient = firstAddress(mail.to) || null;
  const subjectFields = parseSubject(subject);
  const textBody = normalizeText(mail.text || '');
  const pdfCandidates = mail.attachments.filter((attachment) =>
    /\.pdf$/i.test(attachment.filename || ''));
  const attachments = await Promise.all(pdfCandidates.map(parsePdf));
  const primaryResumeText = attachments
    .filter((attachment) => !attachment.parseError && attachment.documentType === 'resume')
    .sort((a, b) => b.text.length - a.text.length)[0]?.text ?? '';

  const fields: Record<string, string> = {
    name: subjectFields.name || extractLabeledValue(textBody, ['姓名']),
    years: subjectFields.years || extractLabeledValue(textBody, ['工作经验', '经验']),
    jobTitle: subjectFields.jobTitle || extractLabeledValue(textBody, ['应聘岗位', '岗位']),
    city: subjectFields.city || extractLabeledValue(textBody, ['期望城市', '城市']),
    salary: subjectFields.salary || extractLabeledValue(textBody, ['期望薪资', '薪资']),
    gender: extractLabeledValue(textBody, ['性别']),
    age: extractLabeledValue(textBody, ['年龄']),
    education: extractLabeledValue(textBody, ['学历']),
    company: extractLabeledValue(textBody, ['当前公司', '公司']),
    currentTitle: extractLabeledValue(textBody, ['当前职位', '职位']),
  };
  Object.keys(fields).forEach((key) => {
    if (!fields[key]) delete fields[key];
  });

  const contactText = `${primaryResumeText}\n${textBody}`;
  const { phone, email } = extractResumeContacts(contactText);
  const recognitionErrors: string[] = [];
  const bossSender = BOSS_RESUME_DOMAINS.has(sender.split('@')[1] || '');
  if (!bossSender) recognitionErrors.push('发件人不是 BOSS 简历通知域名');
  if (!subjectFields.valid) recognitionErrors.push('主题不符合 BOSS 三段式简历格式');
  if (pdfCandidates.length === 0) recognitionErrors.push('没有 PDF 附件');
  if (attachments.length > 0 && attachments.every((item) => !!item.parseError)) {
    recognitionErrors.push(attachments.map((item) => item.parseError).filter(Boolean).join('；'));
  }

  const fullText = normalizeText([
    fields.name,
    fields.gender,
    fields.age,
    fields.city,
    fields.education,
    fields.years,
    fields.salary,
    fields.company,
    fields.currentTitle,
    primaryResumeText,
  ].filter(Boolean).join('\n'));

  return {
    messageId: mail.messageId?.trim() || null,
    subject,
    sender,
    recipient,
    receivedAt: mail.date ?? new Date(),
    textBody,
    extractedJobTitle: fields.jobTitle || null,
    fields,
    phone,
    email,
    card: {
      index: 0,
      sourceId: mail.messageId?.trim() || attachments[0]?.sha256,
      name: fields.name || '待确认候选人',
      salary: fields.salary || '',
      age: fields.age || '',
      years: fields.years || '',
      education: fields.education || '',
      status: fields.currentTitle || '',
      expected: [fields.city, fields.jobTitle, fields.salary].filter(Boolean).join(' / '),
      advantage: fields.company || '',
      tags: [fields.gender, fields.company, fields.currentTitle].filter(Boolean),
      fullText,
    },
    attachments,
    primaryResumeText,
    isBossResume: bossSender && subjectFields.valid && pdfCandidates.length > 0,
    recognitionError: recognitionErrors.length ? recognitionErrors.join('；') : null,
  };
}
