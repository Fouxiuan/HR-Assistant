import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { classifyPdfDocument, parseResumeEmail } from '../src/mail/parser.js';

describe('BOSS resume email parser', () => {
  it('accepts application/octet-stream PDF and extracts normalized fields', async () => {
    const source = await readFile(resolve('tests/fixtures/boss-resume.eml'));
    const parsed = await parseResumeEmail(source);

    expect(parsed.sender).toBe('resume@notice.bosszhipin.com');
    expect(parsed.isBossResume).toBe(true);
    expect(parsed.attachments).toHaveLength(1);
    expect(source.toString('utf8')).toContain('Content-Type: application/octet-stream');
    expect(parsed.attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(parsed.messageId).toBe('<synthetic-resume-001@notice.bosszhipin.com>');
    expect(parsed.phone).toBe('13800138000');
    expect(parsed.email).toBe('john.doe@example.com');
    expect(parsed.attachments[0].documentType).toBe('resume');
    expect(parsed.primaryResumeText).not.toBe('');
  });

  it('distinguishes a formal resume from a portfolio document', () => {
    expect(classifyPdfDocument(`
      求职意向：整合营销负责人
      工作经历：品牌营销
      项目经历：酒旅活动
      教育经历：本科
      手机：13800138000
      邮箱：candidate@example.com
    `)).toBe('resume');
    expect(classifyPdfDocument(`
      品牌年度传播方案
      酒旅营销创意与视觉提案
      项目复盘及传播效果
    `)).toBe('portfolio');
    expect(classifyPdfDocument(`
      求职意向：整合营销负责人
      工作经历：品牌营销
      教育经历：本科
    `, '【作品集】整合营销负责人.pdf')).toBe('portfolio');
  });

  it('keeps a valid PDF with extraction failure as a portfolio by default', async () => {
    const oversized = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024)]);
    const { parsePdfContent } = await import('../src/mail/parser.js');
    const parsed = await parsePdfContent(oversized, 'work.pdf');
    expect(parsed.parseError).toContain('10 MB');
    expect(parsed.documentType).toBe('portfolio');
  });

  it('rejects a non-BOSS sender even with a matching subject and PDF', async () => {
    const source = await readFile(resolve('tests/fixtures/boss-resume.eml'), 'utf8');
    const parsed = await parseResumeEmail(Buffer.from(source.replace(
      'resume@notice.bosszhipin.com',
      'resume@example.com',
    )));
    expect(parsed.isBossResume).toBe(false);
    expect(parsed.recognitionError).toContain('发件人');
  });

  it.each(['service.zhipin.com', 'service.bosszhipin.com'])(
    'accepts the production BOSS resume sender domain %s',
    async (domain) => {
      const source = await readFile(resolve('tests/fixtures/boss-resume.eml'), 'utf8');
      const parsed = await parseResumeEmail(Buffer.from(source.replaceAll(
        'notice.bosszhipin.com',
        domain,
      )));
      expect(parsed.isBossResume).toBe(true);
      expect(parsed.sender).toBe(`resume@${domain}`);
    },
  );
});
