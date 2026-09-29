// Talks to the local ATS server (server/index.mjs).
// When the server is running, data and files are saved in the project's storage/ folder.
// When it isn't (e.g. a static preview), the app falls back to this browser's storage.
import type { AppData, StoredFile } from '../types';

export type BackendMode = 'server' | 'browser';

export interface ServerInfo {
  ok: boolean;
  server: boolean;
  storage: string; // absolute path of the storage folder on the computer running the server
}

export async function detectServer(): Promise<ServerInfo | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) return null;
    const info = (await res.json()) as ServerInfo;
    return info.server ? info : null;
  } catch {
    return null;
  }
}

export async function loadServerData(): Promise<unknown | null> {
  const res = await fetch('/api/data', { cache: 'no-store' });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Could not load data (${res.status})`);
  return res.json();
}

export type SaveResult = { ok: true; revision: number } | { ok: false; conflict: unknown };

/** Saves all data. baseRevision is the revision this browser last saw; a newer one on the server means a conflict. */
export async function saveServerData(data: AppData, baseRevision: number, user: string): Promise<SaveResult> {
  const res = await fetch('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Base-Revision': String(baseRevision), 'X-User': encodeURIComponent(user) },
    body: JSON.stringify(data),
  });
  if (res.status === 409) return { ok: false, conflict: await res.json() };
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
  const body = (await res.json()) as { revision: number };
  return { ok: true, revision: body.revision };
}

export async function getRevision(): Promise<{ revision: number; savedAt: string | null; savedBy: string | null } | null> {
  try {
    const res = await fetch('/api/data/revision', { cache: 'no-store' });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

/** Revision stamped on data by the server (0 when nothing has been saved yet). */
export function revisionOf(raw: unknown): number {
  const r = (raw as { _revision?: number } | null)?._revision;
  return typeof r === 'number' ? r : raw ? 1 : 0;
}

/** Saves a file under storage/clients/<client>/<kind>/... and returns where it went. */
export async function storeFile(file: Blob, opts: { client: string; kind: 'uploads' | 'reports'; name: string }): Promise<StoredFile> {
  const q = new URLSearchParams({ client: opts.client, kind: opts.kind, name: opts.name });
  const res = await fetch(`/api/files?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new Error((await res.text()) || `Upload failed (${res.status})`);
  return res.json();
}

export interface ListedFile extends StoredFile {
  name: string;
}

export async function listFiles(client: string, kind: 'uploads' | 'reports'): Promise<ListedFile[]> {
  const res = await fetch(`/api/files?${new URLSearchParams({ client, kind })}`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export const downloadUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}download=1`;
