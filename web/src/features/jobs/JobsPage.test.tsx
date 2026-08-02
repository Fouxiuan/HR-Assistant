import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsPage } from './JobsPage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('JobsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return jsonResponse({ item: { id: 2, ...body, updatedAt: '2026-07-29T00:00:00.000Z' } }, 201);
      }
      return jsonResponse({
        source: 'database',
        writable: true,
        items: [{
          id: 1, title: '测试岗位', content: '# 测试岗位', sourceFilename: 'test.md',
          updatedAt: '2026-07-29T00:00:00.000Z', updatedBy: '管理员',
        }],
      });
    }));
  });

  it('shows the database source and uploads a newly authored JD', async () => {
    render(<JobsPage />);
    expect(await screen.findByText('本机 SQLite 数据库')).toBeInTheDocument();
    expect(screen.getByText('测试岗位')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新建 JD' }));
    fireEvent.change(screen.getByLabelText('岗位名称'), { target: { value: '新岗位' } });
    fireEvent.change(screen.getByLabelText('JD Markdown 内容'), { target: { value: '# 新岗位\n职责' } });
    fireEvent.click(screen.getByRole('button', { name: '上传到数据库' }));

    await waitFor(() => expect(screen.getByText('JD 已上传到数据库')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/job-descriptions', expect.objectContaining({ method: 'POST' }));
  });
});
