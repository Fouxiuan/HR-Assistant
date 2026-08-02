import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogs } from './useLogs';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
}

describe('useLogs', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(['initial']), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
  });

  it('loads initial logs and closes the stream on unmount', async () => {
    const { result, unmount } = renderHook(() => useLogs());
    await waitFor(() => expect(result.current.logs).toEqual(['initial']));
    expect(FakeEventSource.instances[0]?.url).toBe('/api/logs/stream');

    unmount();
    expect(FakeEventSource.instances[0]?.close).toHaveBeenCalledOnce();
  });
});
