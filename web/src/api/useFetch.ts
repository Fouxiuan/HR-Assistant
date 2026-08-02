import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './client';

interface UseFetchResult<T> {
  data: T | undefined;
  error: ApiError | Error | undefined;
  mutate: (value?: T) => void;
}

export function useFetch<T>(key: string | null, interval = 0): UseFetchResult<T> {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<ApiError | Error | undefined>();
  const keyRef = useRef(key);
  const mountedRef = useRef(true);

  useEffect(() => {
    keyRef.current = key;
    mountedRef.current = true;
    let cancelled = false;
    let timer: number | undefined;

    const doFetch = () => {
      const url = keyRef.current;
      if (!url) return;
      api<T>(url)
        .then((result) => { if (!cancelled && mountedRef.current) setData(result); })
        .catch((err) => { if (!cancelled && mountedRef.current) setError(err as ApiError | Error); });
    };

    doFetch();
    if (interval > 0) timer = window.setInterval(doFetch, interval);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [key, interval]);

  return { data, error, mutate: (value?: T) => { if (value !== undefined) { setData(value); return; } const url = keyRef.current; if (!url) return; api<T>(url).then((r) => setData(r)).catch((e) => setError(e as ApiError | Error)); } };
}
