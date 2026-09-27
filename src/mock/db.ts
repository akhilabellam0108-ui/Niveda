/**
 * The mock backend's data store. Everything is kept in one Database object,
 * persisted to browser storage and broadcast to other tabs, so a patient tab
 * and a doctor tab see each other's changes live.
 *
 * Replace this file (and the services' use of it) with real API calls when a
 * backend exists; UI code only talks to services.
 */
import type { Database } from '../types';
import { buildSeed, SCHEMA_VERSION } from './seed';
import { persistent } from './storage';
import { clearBlobs } from './blobStore';

const KEY = 'niveda.db';
type Listener = () => void;
const listeners = new Set<Listener>();
let db: Database | null = null;
let loading: Promise<Database> | null = null;

/** Simulated network latency so loading states are real. Tests set it to 0. */
export const latency = { ms: 260 };
export const delay = (ms = latency.ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms + Math.random() * ms * 0.5)) : Promise.resolve());

function load(): Database | null {
  const raw = persistent.get(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Database;
    return parsed.schemaVersion === SCHEMA_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export async function getDb(): Promise<Database> {
  if (db) return db;
  if (!loading) {
    loading = (async () => {
      const existing = load();
      db = existing ?? (await buildSeed());
      if (!existing) save();
      return db;
    })();
  }
  return loading;
}

function save() {
  if (db) persistent.set(KEY, JSON.stringify(db));
}

function emit() {
  listeners.forEach((l) => l());
}

/** Apply a change, persist it and notify subscribers. */
export async function mutate<T>(fn: (d: Database) => T): Promise<T> {
  const d = await getDb();
  const result = fn(d);
  save();
  emit();
  return result;
}

/**
 * Persist a change without notifying this tab (used for housekeeping during reads,
 * such as logging a view). Return false from fn to skip saving when nothing changed —
 * every save also refreshes other open tabs.
 */
export async function mutateQuiet(fn: (d: Database) => boolean | void): Promise<void> {
  const d = await getDb();
  if (fn(d) !== false) save();
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function resetDemoData(): Promise<void> {
  persistent.remove(KEY);
  await clearBlobs();
  db = await buildSeed();
  loading = Promise.resolve(db);
  save();
  emit();
}

// Cross-tab sync: when another tab saves, reload and notify.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const next = load();
    if (next) {
      db = next;
      loading = Promise.resolve(next);
      emit();
    }
  });
}
