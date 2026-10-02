/**
 * HTTP client for the Niveda API. Every request is same-origin with the session cookie;
 * state-changing requests carry the X-Niveda header the server requires (CSRF defence).
 */
import { AppError, type ErrorCode } from '@shared/api';
import type { DocumentCategory } from '@shared/types';

export { AppError };

type Listener = () => void;
const listeners = new Set<Listener>();
let authFailure: ((e: AppError) => void) | undefined;

/** The session context registers here so an expired session signs the user out everywhere. */
export const onAuthFailure = (fn: (e: AppError) => void) => { authFailure = fn; };

/** A file chosen in the browser, waiting to be uploaded. */
export interface NewFile {
  name: string;
  type: string;
  blob: Blob;
  category: DocumentCategory;
  date?: string;
}

interface Options {
  body?: unknown;
  form?: FormData;
  raw?: boolean;
  silent?: boolean; // don't trigger a UI refresh after a successful change
}

export async function api<T>(method: string, path: string, opts: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(method !== 'GET' ? { 'X-Niveda': '1' } : {}),
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new AppError('NETWORK', 'Can’t reach Niveda right now. Check your internet connection and try again.');
  }
  if (!res.ok) {
    let code: ErrorCode = 'UNKNOWN';
    let message = 'Something went wrong. Please try again.';
    try {
      const j = await res.json();
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch { /* not JSON */ }
    if (res.status === 429) code = 'RATE_LIMITED';
    const err = new AppError(code, message);
    if ((code === 'SESSION_EXPIRED' || code === 'NOT_SIGNED_IN') && !path.startsWith('/auth/')) authFailure?.(err);
    throw err;
  }
  if (method !== 'GET' && !opts.silent) emitChange();
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const get = <T>(path: string) => api<T>('GET', path);
export const send = <T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown, silent?: boolean) => api<T>(method, path, { body: body ?? {}, silent });

/** Multipart request: JSON "payload" field plus files (their metadata goes in payload.files). */
export function upload<T>(path: string, payload: Record<string, unknown>, files: NewFile[] = []) {
  const form = new FormData();
  form.append('payload', JSON.stringify({ ...payload, files: files.map((f) => ({ name: f.name, category: f.category, date: f.date })) }));
  for (const f of files) form.append('files', f.blob, f.name);
  return api<T>('POST', path, { form });
}

export const qs = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString();
  return s ? `?${s}` : '';
};

/* ---------------- Live updates (Server-Sent Events) ---------------- */

let source: EventSource | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let liveEnabled = false;

/** Live updates only run while someone is signed in. */
export function setLiveEnabled(on: boolean) {
  liveEnabled = on;
  if (!on) { source?.close(); source = null; }
  else if (listeners.size) connect();
}

function emitChange() {
  clearTimeout(timer);
  timer = setTimeout(() => listeners.forEach((l) => l()), 40);
}

function connect() {
  if (source || !liveEnabled || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  source.addEventListener('change', emitChange);
  // After a reconnect, refresh in case we missed something while offline.
  source.onopen = () => emitChange();
}

/** Re-open the live connection (e.g. after signing in as someone else). */
export function reconnectLive() {
  source?.close();
  source = null;
  if (listeners.size) connect();
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  connect();
  return () => {
    listeners.delete(l);
    if (!listeners.size) { source?.close(); source = null; }
  };
}

export function closeLive() {
  source?.close();
  source = null;
}
