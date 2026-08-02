import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('App routing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ isRunning: false, phase: 'idle', message: 'ready', results: 0 })));
  });

  it('renders all feature routes in the application shell', async () => {
    window.location.hash = '#/guide';
    render(<App />);

    await waitFor(() => expect(window.location.hash).toBe('#/guide'));
    const routeLinks = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(routeLinks).toEqual(expect.arrayContaining([
      '#/guide', '#/run', '#/settings', '#/results', '#/candidates', '#/mail',
    ]));
    expect(routeLinks).not.toEqual(expect.arrayContaining(['#/jobs', '#/keywords', '#/ai-config', '#/account']));
    expect(screen.getByText('WORKFLOW')).toBeInTheDocument();
  });

  it('enters the application shell without requesting setup status', async () => {
    window.location.hash = '#/guide';
    render(<App />);

    await waitFor(() => expect(screen.getByText('WORKFLOW')).toBeInTheDocument());
    const requestedUrls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(requestedUrls).not.toContain('/api/setup/status');
  });
});
