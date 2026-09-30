/**
 * Connection to Supabase, error translation and the change signal the UI
 * listens to. Only used when the app runs against a live backend.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { backend } from '../../config/backend';
import { AppError, type ErrorCode } from '../core';

let client: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  if (!client) {
    if (!backend.supabaseUrl || !backend.supabaseAnonKey) throw new AppError('UNKNOWN', 'The app isn’t connected to a backend.');
    client = createClient(backend.supabaseUrl, backend.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'niveda.auth' },
    });
  }
  return client;
}

/* ---------------- errors ---------------- */

const APP_CODES = new Set<ErrorCode>(['ACCESS_DENIED', 'SESSION_EXPIRED', 'NOT_SIGNED_IN', 'NOT_FOUND', 'VALIDATION', 'OTP_INVALID', 'OTP_EXPIRED', 'AUTH_FAILED', 'CONFLICT']);

/** The database raises "CODE: message"; anything else becomes a safe, generic message. */
export function toAppError(e: { message?: string; code?: string; status?: number } | null | undefined): AppError {
  const msg = e?.message ?? '';
  const m = /^([A-Z_]+): ([\s\S]*)$/.exec(msg);
  if (m && APP_CODES.has(m[1] as ErrorCode)) return new AppError(m[1] as ErrorCode, m[2]);
  if (m && m[1] === 'IMMUTABLE') return new AppError('ACCESS_DENIED', m[2]);
  if (/jwt expired|invalid jwt|refresh token|not authenticated/i.test(msg) || e?.status === 401) {
    return new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  if (/row-level security|permission denied/i.test(msg)) return new AppError('ACCESS_DENIED', 'You don’t have access to this.');
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
    return new AppError('UNKNOWN', 'Can’t reach Niveda right now. Check your internet connection and try again.');
  }
  if (typeof console !== 'undefined') console.error('[niveda]', e);
  return new AppError('UNKNOWN', 'Something went wrong. Please try again.');
}

/** Maps Supabase Auth errors to messages people can act on. */
export function authError(e: { message?: string; status?: number; code?: string }): AppError {
  const msg = e.message ?? '';
  if (/invalid login credentials/i.test(msg)) return new AppError('AUTH_FAILED', 'That email and password don’t match our records.');
  if (/email not confirmed/i.test(msg)) return new AppError('AUTH_FAILED', 'Please confirm your email first — enter the code from the sign-up email, or sign up again to get a new one.');
  if (/token has expired|invalid.*(otp|token)|otp.*(expired|invalid)/i.test(msg)) return new AppError('OTP_INVALID', 'That code doesn’t match or has expired. Check it, or request a new one.');
  if (/already registered|already been registered|user already exists/i.test(msg)) return new AppError('CONFLICT', 'An account with this email already exists. Try signing in instead.');
  if (/rate limit|too many|security purposes/i.test(msg) || e.status === 429) return new AppError('VALIDATION', 'Too many attempts. Please wait a minute and try again.');
  if (/password/i.test(msg) && /(weak|short|at least|characters)/i.test(msg)) return new AppError('VALIDATION', 'Choose a stronger password: at least 8 characters with letters and numbers.');
  if (/signups not allowed|signup is disabled/i.test(msg)) return new AppError('VALIDATION', 'New sign-ups are closed right now.');
  return toAppError(e);
}

/* ---------------- change signal ---------------- */

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  startRealtime();
  return () => { listeners.delete(l); };
}

let emitTimer: ReturnType<typeof setTimeout> | undefined;
/** Tells every open screen to re-read. Debounced so a burst of changes refreshes once. */
export function emit() {
  clearTimeout(emitTimer);
  emitTimer = setTimeout(() => listeners.forEach((l) => l()), 20);
}

/* Changes made by the other party (a doctor adding an entry, a patient
 * granting access) arrive as new notifications or grant/request updates.
 * Realtime applies row-level security, so each person hears only about their own rows. */
let realtimeUserId: string | null = null;
let channel: ReturnType<SupabaseClient['channel']> | null = null;

function startRealtime() {
  if (typeof window === 'undefined' || !backend.supabaseUrl) return;
  void sb().auth.getSession().then(({ data }) => {
    const uid = data.session?.user.id ?? null;
    if (uid === realtimeUserId) return;
    if (channel) { void sb().removeChannel(channel); channel = null; }
    realtimeUserId = uid;
    if (!uid) return;
    channel = sb().channel(`niveda-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, emit)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'access_grants' }, emit)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'access_requests' }, emit)
      .subscribe();
  });
}

/** Re-point live updates when someone signs in or out. */
export function onAuthChanged() {
  resetCaches();
  startRealtime();
}

/* ---------------- calls ---------------- */

/** Calls a database function that only reads (or only logs a view). */
export async function read<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}

/** Calls a database function that changes data, then refreshes open screens. */
export async function write<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const data = await read<T>(fn, args);
  resetCaches();
  emit();
  return data;
}

/** Unwraps a table query. */
export async function q<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw toAppError(error);
  return data as T;
}

/** Reads every row of a query, a page at a time (PostgREST caps each response). */
export async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, size = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const rows = await q(page(from, from + size - 1));
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

/* ---------------- who is signed in ---------------- */

export interface Account {
  id: string;
  role: 'patient' | 'doctor' | 'applicant';
  isAdmin?: boolean;
  onboarded: boolean;
  createdAt: string;
  profileId: string;
  email: string;
  phone: string;
}

let accountCache: Promise<Account | null> | null = null;

/** The signed-in account (cached until sign-in state or data changes). */
export function account(): Promise<Account | null> {
  if (!accountCache) {
    accountCache = (async () => {
      const { data } = await sb().auth.getSession();
      if (!data.session) return null;
      return read<Account | null>('my_account');
    })();
    accountCache.catch(() => { accountCache = null; });
  }
  return accountCache;
}

export async function requireAccount(role?: Account['role']): Promise<Account> {
  const a = await account();
  if (!a) throw new AppError('NOT_SIGNED_IN', 'Please sign in to continue.');
  if (role && a.role !== role) throw new AppError('ACCESS_DENIED', 'This area isn’t available for your account.');
  return a;
}

export function resetCaches() {
  accountCache = null;
}

/** The session id inside the current access token (used to tidy up after re-verification). */
export async function currentSessionId(): Promise<string | undefined> {
  const { data } = await sb().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return undefined;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.session_id as string | undefined;
  } catch {
    return undefined;
  }
}

export const nowIso = () => new Date().toISOString();
