import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailPage } from './MailPage';

const publicConfig = {
  provider: '163', maskedUsername: '', host: 'imap.163.com', port: 993, secure: true,
  mailbox: 'INBOX', enabled: false, hasSecret: false, aiProvider: 'deepseek',
  aiBaseUrl: 'https://api.deepseek.com', aiModel: 'deepseek-chat', hasAIKey: false,
  aiProviders: [
    { key: 'ollama', label: 'Ollama（本机）', baseUrl: 'http://127.0.0.1:11434/v1' },
    { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
    { key: 'custom', label: '自定义', baseUrl: '' },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('MailPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/mail/admin/config') {
        if (init?.method === 'PUT') return json({ ...publicConfig, enabled: true, hasSecret: true });
        return json(publicConfig);
      }
      if (url === '/api/mail/admin/models') return json({ ok: true, models: ['qwen2.5:7b', 'qwen3.5:9b'] });
      if (url === '/api/mail/status') return json({ configured: false, enabled: false, syncing: false, importedCount: 0 });
      if (url.startsWith('/api/mail/messages?')) return json({ total: 0, page: 1, pageSize: 10, items: [] });
      if (url === '/api/job-descriptions') return json({ source: 'database', writable: true, items: [] });
      return json({ ok: true });
    }));
  });

  it('opens the frontend mailbox settings and saves mailbox credentials', async () => {
    render(<MailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /邮箱设置/ }));

    const account = await screen.findByLabelText('邮箱账号');
    fireEvent.change(account, { target: { value: 'hr@example.com' } });
    fireEvent.change(screen.getByLabelText('客户端授权码'), { target: { value: 'mail-auth-code' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /已启用|未启用/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存邮箱设置' }));

    await waitFor(() => expect(screen.getByText('邮箱与 AI 配置已保存')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/mail/admin/config', expect.objectContaining({
      method: 'PUT',
      body: expect.stringContaining('hr@example.com'),
    }));
  });

  it('shows an editable default form when no mailbox config exists yet', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/mail/admin/config') return json(null);
      if (url === '/api/mail/status') return json({ configured: false, enabled: false, syncing: false, importedCount: 0 });
      if (url.startsWith('/api/mail/messages?')) return json({ total: 0, page: 1, pageSize: 10, items: [] });
      if (url === '/api/job-descriptions') return json({ source: 'database', writable: true, items: [] });
      return json({});
    });

    render(<MailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /邮箱设置/ }));

    expect(await screen.findByLabelText('邮箱账号')).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱类型')).toHaveValue('163');
    expect(screen.queryByText('邮箱配置读取失败')).not.toBeInTheDocument();
  });

  it('configures mail AI like the settings AI form and loads Ollama models', async () => {
    render(<MailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /邮箱设置/ }));

    fireEvent.change(await screen.findByLabelText('提供商'), { target: { value: 'ollama' } });
    expect(screen.getByLabelText('Base URL')).toHaveValue('http://127.0.0.1:11434/v1');
    expect(screen.getByLabelText('API Key（Ollama 可留空）')).toBeInTheDocument();

    const fetchModels = screen.getByRole('button', { name: '获取模型列表' });
    expect(fetchModels).toBeEnabled();
    fireEvent.click(fetchModels);

    expect(await screen.findByRole('option', { name: 'qwen2.5:7b' })).toBeInTheDocument();
    expect(screen.getByText('获取到 2 个模型')).toBeInTheDocument();
  });

  it('shows resume and portfolio attachments from every mail linked to the candidate', async () => {
    const summary = {
      id: 17,
      messageId: '<portfolio@example>',
      subject: '林欢 | 10年以上，应聘 整合营销负责人 | 广州12-18K【BOSS直聘】',
      sender: 'cv@service.bosszhipin.com',
      receivedAt: '2026-07-31T07:51:00.000Z',
      candidateId: 9,
      candidateName: '林欢',
      extractedJobTitle: '整合营销负责人',
      matchedJobTitle: null,
      status: 'needs_review',
      error: null,
      attachmentCount: 1,
    };
    const resume = {
      id: 31, filename: 'resume.pdf', displayFilename: '林欢【正式简历-31】.pdf', contentType: 'application/pdf',
      size: 1_024, sha256: 'a'.repeat(64), parseError: null, textLength: 2_000, documentType: 'resume', createdAt: summary.receivedAt,
    };
    const portfolio = {
      id: 32, filename: 'portfolio.pdf', displayFilename: '林欢【作品集-32】.pdf', contentType: 'application/pdf',
      size: 2_048, sha256: 'b'.repeat(64), parseError: '未提取到文本', textLength: 0, documentType: 'portfolio', createdAt: summary.receivedAt,
    };

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/mail/status') return json({ configured: true, enabled: true, syncing: false, importedCount: 2 });
      if (url.startsWith('/api/mail/messages?')) return json({ total: 1, page: 1, pageSize: 10, items: [summary] });
      if (url === '/api/mail/messages/17') return json({ ...summary, recipient: null, textBody: '', parsedFields: {}, attachments: [portfolio], candidateAttachments: [portfolio, resume] });
      if (url === '/api/job-descriptions') return json({ source: 'database', writable: true, items: [] });
      return json({});
    });

    render(<MailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /林欢/ }));

    expect(await screen.findByText('简历：')).toBeInTheDocument();
    expect(screen.getByText('林欢【正式简历-31】.pdf')).toBeInTheDocument();
    expect(screen.getByText('作品集：')).toBeInTheDocument();
    expect(screen.getByText('林欢【作品集-32】.pdf')).toBeInTheDocument();
    expect(screen.queryByText('该人才暂无作品集')).not.toBeInTheDocument();
  });

  it('shows an explicit empty state when the candidate has no portfolio', async () => {
    const summary = {
      id: 18, messageId: '<resume@example>', subject: '张三 | 5年，应聘 运营 | 广州【BOSS直聘】', sender: 'cv@service.bosszhipin.com',
      receivedAt: '2026-07-31T07:51:00.000Z', candidateId: 10, candidateName: '张三', extractedJobTitle: '运营', matchedJobTitle: '运营',
      status: 'imported', error: null, attachmentCount: 1,
    };
    const resume = {
      id: 41, filename: 'resume.pdf', displayFilename: '张三【正式简历-41】.pdf', contentType: 'application/pdf', size: 1_024,
      sha256: 'c'.repeat(64), parseError: null, textLength: 1_000, documentType: 'resume', createdAt: summary.receivedAt,
    };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/mail/status') return json({ configured: true, enabled: true, syncing: false, importedCount: 1 });
      if (url.startsWith('/api/mail/messages?')) return json({ total: 1, page: 1, pageSize: 10, items: [summary] });
      if (url === '/api/mail/messages/18') return json({ ...summary, recipient: null, textBody: '', parsedFields: {}, attachments: [resume], candidateAttachments: [resume] });
      if (url === '/api/job-descriptions') return json({ source: 'database', writable: true, items: [] });
      return json({});
    });

    render(<MailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /张三/ }));

    expect(await screen.findByText('该人才暂无作品集')).toBeInTheDocument();
  });
});
