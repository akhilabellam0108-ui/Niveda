/**
 * Key-value persistence used by the mock backend.
 * Browser: localStorage / sessionStorage. Tests or restricted sandboxes: in-memory.
 * A real deployment replaces the whole mock layer with API calls — nothing sensitive
 * should live in browser storage in production.
 */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const memory = (): KV => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
};

function wrap(s: Storage | undefined): KV | null {
  try {
    if (!s) return null;
    const probe = '__niveda_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return {
      get: (k) => { try { return s.getItem(k); } catch { return null; } },
      set: (k, v) => { try { s.setItem(k, v); } catch { /* quota or blocked */ } },
      remove: (k) => { try { s.removeItem(k); } catch { /* ignore */ } },
    };
  } catch {
    return null;
  }
}

const hasWindow = typeof window !== 'undefined';
export const persistent: KV = (hasWindow && wrap(window.localStorage)) || memory();
/** Per-tab storage, so one tab can be signed in as the patient and another as the doctor. */
export const perTab: KV = (hasWindow && wrap(window.sessionStorage)) || memory();
