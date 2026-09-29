import { useEffect, useState } from 'react';

// Minimal hash router: works on any static host (Vercel, file previews) with no config.

function current(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h || '/';
}

export function useRoute(): string {
  const [path, setPath] = useState(current);
  useEffect(() => {
    const on = () => {
      setPath(current());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

export function navigate(to: string, replace = false): void {
  const hash = `#${to}`;
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}

/** Matches "/c/:clientId/accounts/:id" style patterns. Returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const [pathOnly] = path.split('?');
  const s = pathOnly.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function query(path: string): URLSearchParams {
  return new URLSearchParams(path.split('?')[1] ?? '');
}
