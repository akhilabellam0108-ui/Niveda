/** Per-tab storage for small conveniences (drafts, which alarms were shown). Never holds medical data. */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

function wrap(s: Storage | undefined): KV {
  const mem = new Map<string, string>();
  const ok = (() => { try { s?.setItem('__n', '1'); s?.removeItem('__n'); return !!s; } catch { return false; } })();
  if (!ok) return { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v), remove: (k) => void mem.delete(k) };
  return {
    get: (k) => { try { return s!.getItem(k); } catch { return null; } },
    set: (k, v) => { try { s!.setItem(k, v); } catch { /* quota */ } },
    remove: (k) => { try { s!.removeItem(k); } catch { /* ignore */ } },
  };
}

export const perTab: KV = wrap(typeof window !== 'undefined' ? window.sessionStorage : undefined);
