import { describe, expect, it, vi } from 'vitest';
import type { JobCatalogPort, LoggerPort } from '../src/core/ports.js';
import type { MailRepository } from '../src/mail/repository.js';
import { MailService } from '../src/mail/service.js';

describe('MailService reprocessing', () => {
  it('never reparses or scores an attachment already classified as a portfolio', async () => {
    const repository = {
      available: true,
      getForReprocess: vi.fn(async () => ({
        id: 17,
        candidateId: 9,
        messageId: '<portfolio@example>',
        subject: '候选人作品集',
        extractedJobTitle: '整合营销负责人',
        parsedFields: { name: '林欢' },
        resumeText: '',
        attachment: {
          id: 32,
          filename: '林欢【作品集】.pdf',
          contentType: 'application/pdf',
          data: Buffer.from('%PDF-1.4 portfolio text that resembles a resume'),
          documentType: 'portfolio' as const,
        },
      })),
      saveParsedAttachment: vi.fn(),
      reconcileCandidate: vi.fn(async () => 9),
      updateProcessing: vi.fn(),
      getMessage: vi.fn(async () => null),
    } as unknown as MailRepository;
    const jobs = {
      loadAll: vi.fn(async () => undefined),
      matchJob: vi.fn(),
      jds: [{ id: 1, title: '整合营销负责人', content: 'JD', sourceFilename: null, updatedAt: null, updatedBy: null }],
    } as unknown as JobCatalogPort;
    const logger = { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as LoggerPort;
    const service = new MailService(logger, repository, jobs);

    await service.reprocess(17, 1);

    expect(repository.saveParsedAttachment).not.toHaveBeenCalled();
    expect(jobs.matchJob).not.toHaveBeenCalled();
    expect(repository.updateProcessing).toHaveBeenCalledWith(17, expect.objectContaining({
      status: 'needs_review',
    }));
    expect(vi.mocked(repository.updateProcessing).mock.calls[0][1]).not.toHaveProperty('evaluation');
  });
});
