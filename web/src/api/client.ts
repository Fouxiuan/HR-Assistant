export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function apiUrl(path: string): string {
  const base = (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__SERVER_URL__ as string) || '';
  return base + path;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: init?.body
      ? { 'Content-Type': 'application/json', ...init.headers }
      : init?.headers,
  });
  const body = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) {
    throw new ApiError(response.status, body?.message || `请求失败 (${response.status})`);
  }
  return body as T;
}

export const fetcher = <T>(path: string) => api<T>(path);

export function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
}
