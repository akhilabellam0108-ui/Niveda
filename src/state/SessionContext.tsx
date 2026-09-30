import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Doctor, Hospital, Patient, Preferences, User } from '../types';
import { authService, doctorService, patientService, settingsService, subscribe, DEFAULT_PREFS } from '../services';
import { AppError } from '../services/core';
import { clearNativeAlarms } from '../lib/nativeAlarms';

interface SessionState {
  status: 'loading' | 'signed-out' | 'signed-in';
  user?: User;
  patient?: Patient;
  doctor?: Doctor & { hospital?: Hospital };
  prefs: Preferences;
  /** Message shown on the sign-in page, e.g. after a session expires. */
  notice?: string;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  handleAuthError: (e: AppError) => void;
  clearNotice: () => void;
}

const Ctx = createContext<SessionState | null>(null);

export function applyTheme(theme: Preferences['theme']) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<SessionState, 'refresh' | 'signOut' | 'handleAuthError' | 'clearNotice'>>({ status: 'loading', prefs: DEFAULT_PREFS });

  const refresh = useCallback(async () => {
    try {
      const user = await authService.currentUser();
      if (!user) {
        setState((s) => ({ status: 'signed-out', prefs: DEFAULT_PREFS, notice: s.notice }));
        applyTheme('system');
        return;
      }
      const prefs = await settingsService.get();
      applyTheme(prefs.theme);
      if (user.role === 'patient') {
        const patient = await patientService.me();
        setState((s) => ({ status: 'signed-in', user, patient, prefs, notice: s.notice }));
      } else if (user.role === 'applicant') {
        setState((s) => ({ status: 'signed-in', user, prefs, notice: s.notice }));
      } else {
        const doctor = await doctorService.me();
        setState((s) => ({ status: 'signed-in', user, doctor, prefs, notice: s.notice }));
      }
    } catch (e) {
      const msg = e instanceof AppError ? e.message : undefined;
      setState({ status: 'signed-out', prefs: DEFAULT_PREFS, notice: msg });
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Keep profile/prefs in sync with edits made anywhere (including other tabs).
    let t: ReturnType<typeof setTimeout>;
    const unsub = subscribe(() => { clearTimeout(t); t = setTimeout(() => void refresh(), 60); });
    return () => { unsub(); clearTimeout(t); };
  }, [refresh]);

  const signOut = useCallback(async () => {
    await clearNativeAlarms().catch(() => undefined);
    await authService.logout();
    setState({ status: 'signed-out', prefs: DEFAULT_PREFS });
    applyTheme('system');
  }, []);

  const handleAuthError = useCallback((e: AppError) => {
    setState({ status: 'signed-out', prefs: DEFAULT_PREFS, notice: e.code === 'SESSION_EXPIRED' ? e.message : undefined });
  }, []);

  const clearNotice = useCallback(() => setState((s) => ({ ...s, notice: undefined })), []);

  const value = useMemo(() => ({ ...state, refresh, signOut, handleAuthError, clearNotice }), [state, refresh, signOut, handleAuthError, clearNotice]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}
