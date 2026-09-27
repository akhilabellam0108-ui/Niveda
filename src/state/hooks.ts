import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribe } from '../services';
import { AppError } from '../services/core';
import { useSession } from './SessionContext';

export interface Live<T> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/**
 * Loads data from a service and keeps it fresh: re-fetches silently whenever
 * the store changes (including from another tab). First load shows loading state.
 */
export function useLive<T>(loader: () => Promise<T>, deps: unknown[] = []): Live<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const seq = useRef(0);
  const { handleAuthError } = useSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);

  const run = useCallback((silent: boolean) => {
    const id = ++seq.current;
    if (!silent) setLoading(true);
    load()
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(undefined);
      })
      .catch((e) => {
        if (id !== seq.current) return;
        if (e instanceof AppError && (e.code === 'SESSION_EXPIRED' || e.code === 'NOT_SIGNED_IN')) handleAuthError(e);
        setError(e);
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  }, [load, handleAuthError]);

  useEffect(() => {
    run(false);
    let t: ReturnType<typeof setTimeout> | undefined;
    const unsub = subscribe(() => {
      clearTimeout(t);
      t = setTimeout(() => run(true), 30);
    });
    return () => { unsub(); clearTimeout(t); };
  }, [run]);

  return { data, loading: loading && data === undefined, error, reload: () => run(false) };
}

/** Wraps an async action with pending state. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const run = useCallback(async (...args: A): Promise<R> => {
    setPending(true);
    try {
      return await fn(...args);
    } finally {
      setPending(false);
    }
  }, [fn]);
  return [run, pending] as const;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [title]);
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
