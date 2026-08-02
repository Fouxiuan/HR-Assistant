export function navigate(path: string): void {
  const safePath = path.startsWith('/') ? path : '/guide';
  window.location.hash = safePath;
}

export function hashSearchParams(): URLSearchParams {
  const hash = window.location.hash.replace(/^#/, '');
  const queryIndex = hash.indexOf('?');
  return new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : '');
}
