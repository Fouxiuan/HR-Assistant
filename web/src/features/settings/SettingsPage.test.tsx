import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

const runtimeSettings = {
  selectedJob: '测试岗位', bossJobTitle: '测试岗位', bossFilters: { location: '广州' },
  candidateAgeMin: 23, candidateAgeMax: 30, minScore: 70, totalGreetTarget: 20,
  maxEmptyScrolls: 3, actionDelayMs: 3000, maxCandidates: 50,
  scanIntervalSec: 1, evaluateIntervalSec: 1, greetIntervalSec: 1, closeDetailIntervalSec: 1,
};

const aiConfig = {
  provider: 'deepseek', apiKey: '••••••••', model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com/v1', hasKey: true,
  providers: [{ key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' }],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('SettingsPage', () => {
  beforeEach(() => {
    window.location.hash = '#/settings?section=jobs';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        if (url === '/api/ai-config') return json(aiConfig);
        return json({ ok: true });
      }
      if (url === '/api/job-descriptions') return json({ source: 'database', writable: true, items: [{ id: 1, title: '测试岗位', content: '# 测试岗位', sourceFilename: 'test.md', updatedAt: null, updatedBy: null }] });
      if (url === '/api/jobs') return json(['测试岗位']);
      if (url === '/api/settings') return json(runtimeSettings);
      if (url.startsWith('/api/config/keywords')) return json({ excludeKeywords: [], genericWords: [], skillLibrary: [], preferredCompanies: [], matchThreshold: 3, aiPrompt: '' });
      if (url === '/api/ai-config') return json(aiConfig);
      if (url === '/api/data/backup/status') return json({ busy: false, operation: 'idle' });
      return json({});
    }));
  });

  it('switches between all setting sections and saves editable configuration once', async () => {
    render(<SettingsPage />);

    expect(await screen.findByText('本机 SQLite 数据库')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(expect.arrayContaining([
      'JD 管理本机岗位内容', '关键词本机筛选词库', '运行参数批次与条件', 'AI 配置模型与密钥', '数据与备份导出与恢复',
    ]));

    fireEvent.click(screen.getByRole('tab', { name: /运行参数/ }));
    expect(await screen.findByText('页面筛选')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保存全部设置' }));

    await waitFor(() => expect(screen.getByText(/全部设置已保存在本机/)).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenCalledWith('/api/config/keywords', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenCalledWith('/api/ai-config', expect.objectContaining({ method: 'POST' }));
  });
});
