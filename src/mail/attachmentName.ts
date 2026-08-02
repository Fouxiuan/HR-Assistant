import { extname } from 'path';
import type { MailDocumentType } from '../../shared/contracts.js';

const LABELS: Record<MailDocumentType, string> = {
  resume: '正式简历',
  portfolio: '作品集',
  other: '其他附件',
};

export function mailAttachmentDisplayName(filename: string, documentType: MailDocumentType, id: number): string {
  const extension = extname(filename) || '.pdf';
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  return `${stem}（${LABELS[documentType]}-${id}）${extension}`;
}
