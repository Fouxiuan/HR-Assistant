import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CandidatesPage } from './CandidatesPage';

describe('CandidatesPage', () => {
  it('shows the candidate service error without telling employees to configure a database', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      available: false,
      message: 'database unavailable',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })));

    render(<CandidatesPage />);

    expect(await screen.findByText(/database unavailable/i)).not.toHaveTextContent('DATABASE_URL');
    expect(fetch).not.toHaveBeenCalledWith('/api/candidates/failure-stats');
  });

  it('renders candidate statuses in Chinese with distinct color tones', async () => {
    const statuses = ['greeted', 'rejected', 'error', 'evaluated'] as const;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/candidates/stats') {
        return new Response(JSON.stringify({ total: 4, greeted: 1, avgScore: 80, byJob: [] }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.startsWith('/api/candidates?')) {
        return new Response(JSON.stringify({
          total: 4,
          page: 1,
          pageSize: 10,
          items: statuses.map((status, index) => ({
            id: index + 1,
            name: `候选人${index + 1}`,
            education: '本科',
            years: '5年',
            lastSeenAt: '2026-07-31T08:00:00.000Z',
            latest: { jobTitle: '运营', aiScore: 80, status, stage: 'ai', createdAt: '2026-07-31T08:00:00.000Z' },
          })),
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    }));

    render(<CandidatesPage />);

    expect(await screen.findByText('已打招呼', { selector: '.candidate-status' })).toHaveClass('success');
    expect(screen.getByText('已跳过', { selector: '.candidate-status' })).toHaveClass('warning');
    expect(screen.getByText('异常', { selector: '.candidate-status' })).toHaveClass('danger');
    expect(screen.getByText('已完成评估', { selector: '.candidate-status' })).toHaveClass('info');
  });
});
