import { useEffect, useState } from 'react';
import { api, apiUrl } from './client';

const POLL_INTERVAL_MS = 2000;

export function useLogs(): { logs: string[]; connected: boolean } {
  const [logs, setLogs] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let disposed = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let stream: EventSource | undefined;

    const load = async () => {
      try {
        const next = await api<string[]>('/api/logs');
        if (!disposed) setLogs(next);
      } catch {
        if (!disposed) setConnected(false);
      }
    };
    const startPolling = () => {
      if (pollTimer || disposed) return;
      void load();
      pollTimer = setInterval(() => void load(), POLL_INTERVAL_MS);
    };

    void load();
    if (typeof EventSource === 'undefined') {
      startPolling();
    } else {
      stream = new EventSource(apiUrl('/api/logs/stream'));
      stream.onopen = () => {
        if (disposed) return;
        setConnected(true);
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = undefined;
      };
      stream.onmessage = event => {
        if (!disposed) setLogs(current => [...current, event.data].slice(-200));
      };
      stream.onerror = () => {
        if (disposed) return;
        setConnected(false);
        stream?.close();
        startPolling();
      };
    }

    return () => {
      disposed = true;
      stream?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  return { logs, connected };
}
