/**
 * Real authentication with Supabase Auth. Codes arrive by email (the project's
 * email templates must include {{ .Token }} — see docs/SUPABASE_SETUP.md).
 *
 * Sign-in is two steps, like the demo: the password is checked, then a one-time
 * code is emailed and must be entered before a session exists.
 */
import type { Session, User } from '../../types';
import { uid } from '../../lib/ids';
import { AppError } from '../core';
import { maskDestination, type OtpChallenge, type OtpPurpose } from '../otpService';
import type { authService as MockAuth, SignUpInput } from '../authService';
import { account, authError, currentSessionId, emit, onAuthChanged, read, requireAccount, resetCaches, sb, write, type Account } from './client';

const CODE_MINUTES = 10;
type Flow = 'signup' | 'login' | 'reset';
let pending: { flow: Flow; email: string; challengeId: string } | null = null;

const norm = (s: string) => s.trim().toLowerCase();

export function challengeFor(purpose: OtpPurpose, email: string): OtpChallenge {
  return { id: uid('otp'), purpose, destination: maskDestination(email), expiresAt: Date.now() + CODE_MINUTES * 60000, prototypeCode: '' };
}

export function describeDevice(ua?: string | null): string {
  if (!ua) return typeof navigator === 'undefined' ? 'Unknown device' : describeDevice(navigator.userAgent);
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

function toUser(a: Account): User {
  return { id: a.id, role: a.role, email: a.email, phone: a.phone, passwordHash: '', passwordSalt: '', createdAt: a.createdAt, profileId: a.profileId, onboarded: a.onboarded, isAdmin: !!a.isAdmin };
}

async function verifyEmailCode(email: string, code: string, type: 'email' | 'recovery') {
  const token = code.replace(/\D/g, '');
  if (token.length < 6) throw new AppError('OTP_INVALID', 'Enter the code from the email.');
  const { error } = await sb().auth.verifyOtp({ email, token, type });
  if (error) throw authError(error);
  onAuthChanged();
}

async function afterSignIn(): Promise<User> {
  resetCaches();
  let a = await account();
  // A patient who confirmed their email but never finished sign-up.
  if (!a) a = await write<Account>('complete_signup');
  await read('log_session_event', { p_action: 'signed_in', p_device: describeDevice() }).catch(() => undefined);
  emit();
  return toUser(a);
}

async function sendLoginCode(email: string) {
  const { error } = await sb().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw authError(error);
}

/**
 * Step-up verification before sensitive actions. The database accepts the action
 * only if this session was created by a code in the last 10 minutes, once.
 */
export const stepUp = {
  async request(purpose: OtpPurpose): Promise<OtpChallenge> {
    const a = await requireAccount();
    await sendLoginCode(a.email);
    return challengeFor(purpose, a.email);
  },
  async verify(code: string): Promise<void> {
    const a = await requireAccount();
    const previous = await currentSessionId();
    await verifyEmailCode(a.email, code, 'email');
    // Verifying starts a fresh session; end the one it replaced so it doesn't linger as another "device".
    if (previous) await read('revoke_session', { p_id: previous }).catch(() => undefined);
  },
};

export const remoteAuthService: typeof MockAuth = {
  async startDoctorApplication(input) {
    const email = norm(input.email);
    const { email: _e, password, ...details } = input;
    const { data, error } = await sb().auth.signUp({ email, password, options: { data: { signup_kind: 'doctor', ...details } } });
    if (error) throw authError(error);
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      throw new AppError('CONFLICT', 'An account with this email already exists. Try signing in instead.');
    }
    const c = challengeFor('signup', email);
    pending = { flow: 'signup', email, challengeId: c.id };
    return c;
  },

  async startSignUp(input: SignUpInput): Promise<OtpChallenge> {
    const email = norm(input.email);
    const { data, error } = await sb().auth.signUp({
      email, password: input.password,
      options: { data: { full_name: input.fullName.trim(), date_of_birth: input.dateOfBirth, phone: input.phone.trim() } },
    });
    if (error) throw authError(error);
    // Supabase hides whether an email is taken; an empty identity list means it is.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      throw new AppError('CONFLICT', 'An account with this email already exists. Try signing in instead.');
    }
    const c = challengeFor('signup', email);
    pending = { flow: 'signup', email, challengeId: c.id };
    return c;
  },

  async completeSignUp(challengeId: string, code: string): Promise<User> {
    if (!pending || pending.flow !== 'signup' || pending.challengeId !== challengeId) throw new AppError('OTP_EXPIRED', 'Your sign-up has timed out. Please start again.');
    const { data } = await sb().auth.getSession();
    // Projects with email confirmation switched off sign in straight away.
    if (!data.session) await verifyEmailCode(pending.email, code, 'email');
    const account = await write<Account>('complete_signup');
    pending = null;
    await read('log_session_event', { p_action: 'signed_in', p_device: describeDevice() }).catch(() => undefined);
    return toUser(account);
  },

  async startLogin(identifier: string, password: string): Promise<OtpChallenge> {
    const email = norm(identifier);
    if (!email.includes('@')) throw new AppError('AUTH_FAILED', 'Sign in with the email address on your account.');
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error) throw authError(error);
    // The password was right. End that session: a session only exists after the code.
    await sb().auth.signOut({ scope: 'local' });
    await sendLoginCode(email);
    const c = challengeFor('login', email);
    pending = { flow: 'login', email, challengeId: c.id };
    return c;
  },

  async completeLogin(challengeId: string, code: string): Promise<User> {
    if (!pending || pending.flow !== 'login' || pending.challengeId !== challengeId) throw new AppError('OTP_EXPIRED', 'Your sign-in has timed out. Please start again.');
    await verifyEmailCode(pending.email, code, 'email');
    pending = null;
    return afterSignIn();
  },

  resendCode(purpose: 'signup' | 'login'): OtpChallenge {
    if (!pending || pending.flow !== purpose) throw new AppError('OTP_EXPIRED', 'Please start again.');
    const email = pending.email;
    const c = challengeFor(purpose, email);
    pending.challengeId = c.id;
    void (purpose === 'signup' ? sb().auth.resend({ type: 'signup', email }) : sb().auth.signInWithOtp({ email, options: { shouldCreateUser: false } }));
    return c;
  },

  hasPending(purpose: 'signup' | 'login') {
    return pending?.flow === purpose;
  },

  /** Always "sends" so the page never reveals whether an account exists. */
  async startPasswordReset(identifier: string): Promise<OtpChallenge | null> {
    const email = norm(identifier);
    if (!email.includes('@')) throw new AppError('VALIDATION', 'Enter the email address on your account.');
    const { error } = await sb().auth.resetPasswordForEmail(email);
    if (error && /rate limit|too many|security purposes/i.test(error.message)) throw authError(error);
    const c = challengeFor('reset_password', email);
    pending = { flow: 'reset', email, challengeId: c.id };
    return c;
  },

  async completePasswordReset(challengeId: string, code: string, newPassword: string): Promise<void> {
    if (!pending || pending.flow !== 'reset' || pending.challengeId !== challengeId) throw new AppError('OTP_EXPIRED', 'This reset has expired. Please start again.');
    await verifyEmailCode(pending.email, code, 'recovery');
    const { error } = await sb().auth.updateUser({ password: newPassword });
    if (error) throw authError(error);
    await read('revoke_other_sessions').catch(() => undefined);
    await read('log_password_changed', { p_label: 'Password reset' }).catch(() => undefined);
    await sb().auth.signOut({ scope: 'local' });
    pending = null;
    onAuthChanged();
  },

  async changePassword(current: string, next: string): Promise<void> {
    const a = await requireAccount();
    const previous = await currentSessionId();
    const { error: wrong } = await sb().auth.signInWithPassword({ email: a.email, password: current });
    if (wrong) throw new AppError('AUTH_FAILED', 'Your current password is incorrect.');
    if (previous) await read('revoke_session', { p_id: previous }).catch(() => undefined);
    const { error } = await sb().auth.updateUser({ password: next });
    if (error) throw authError(error);
    await write('log_password_changed', { p_label: 'Password changed' });
  },

  async currentUser(): Promise<User | null> {
    const { data } = await sb().auth.getSession();
    if (!data.session) return null;
    const a = await account();
    return a ? toUser(a) : null;
  },

  async logout(): Promise<void> {
    await read('log_session_event', { p_action: 'signed_out', p_device: describeDevice() }).catch(() => undefined);
    await sb().auth.signOut({ scope: 'local' });
    onAuthChanged();
  },

  async listSessions(): Promise<(Session & { current: boolean })[]> {
    const a = await requireAccount();
    const rows = await read<{ id: string; createdAt: string; lastActiveAt: string; expiresAt: string; userAgent: string | null; ip: string | null; current: boolean }[]>('list_my_sessions');
    return rows.map((s) => ({
      id: s.id, userId: a.id, device: describeDevice(s.userAgent ?? 'Unknown'), location: s.ip ?? 'Unknown location',
      createdAt: s.createdAt, lastActiveAt: s.lastActiveAt, expiresAt: s.expiresAt, current: s.current,
    }));
  },

  async revokeSession(sessionId: string): Promise<void> {
    await write('revoke_session', { p_id: sessionId });
  },

  async revokeOtherSessions(): Promise<number> {
    return write<number>('revoke_other_sessions');
  },
};
