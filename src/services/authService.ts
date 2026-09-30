/**
 * MOCK AUTHENTICATION — isolated here so it can be swapped for a real provider
 * (e.g. an OIDC/identity service). Nothing in this file is production-grade:
 * passwords are hashed in the browser and sessions live in sessionStorage.
 */
import type { DoctorApplicationInput, Patient, Session, User } from '../types';
import { delay, getDb, mutate } from '../mock/db';
import { perTab } from '../mock/storage';
import { addHours, nowISO } from '../lib/dates';
import { hashPassword, patientCode, uid } from '../lib/ids';
import { brand } from '../config/brand';
import { AppError, SESSION_KEY, actorFor, audit, requireCtx } from './core';
import { otpService, type OtpChallenge } from './otpService';
import { DEMO_ONLY_MESSAGE } from './applicationService';

const SESSION_HOURS = 12;

export interface SignUpInput {
  fullName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  password: string;
}

interface PendingSignup extends SignUpInput { challengeId: string }
interface PendingLogin { challengeId: string; userId: string; phone: string }
let pendingSignup: PendingSignup | null = null;
let pendingLogin: PendingLogin | null = null;
let pendingReset: { challengeId: string; userId: string } | null = null;

const norm = (s: string) => s.trim().toLowerCase();
const normPhone = (s: string) => s.replace(/\D/g, '').slice(-10);

function describeDevice(): string {
  if (typeof navigator === 'undefined') return 'Test runner';
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

async function startSession(userId: string): Promise<Session> {
  return mutate((db) => {
    const t = nowISO();
    const s: Session = { id: uid('ses'), userId, device: describeDevice(), location: 'This device', createdAt: t, lastActiveAt: t, expiresAt: addHours(t, SESSION_HOURS) };
    db.sessions.push(s);
    const user = db.users.find((u) => u.id === userId)!;
    const actor = actorFor(db, user);
    audit(db, { patientId: user.role === 'patient' ? user.profileId : undefined, actor, action: 'signed_in', target: { type: 'session', id: s.id, label: s.device } });
    perTab.set(SESSION_KEY, JSON.stringify({ sessionId: s.id }));
    return s;
  });
}

export const authService = {
  /** Doctors apply with their registration; the Niveda team verifies it (live backend only). */
  async startDoctorApplication(_input: DoctorApplicationInput & { email: string; password: string }): Promise<OtpChallenge> {
    throw new AppError('VALIDATION', DEMO_ONLY_MESSAGE);
  },

  async startSignUp(input: SignUpInput): Promise<OtpChallenge> {
    await delay();
    const db = await getDb();
    if (db.users.some((u) => norm(u.email) === norm(input.email))) throw new AppError('CONFLICT', 'An account with this email already exists. Try signing in instead.');
    if (db.users.some((u) => normPhone(u.phone) === normPhone(input.phone))) throw new AppError('CONFLICT', 'This phone number is already linked to an account.');
    const challenge = otpService.request('signup', input.phone);
    pendingSignup = { ...input, challengeId: challenge.id };
    return challenge;
  },

  async completeSignUp(challengeId: string, code: string): Promise<User> {
    await delay();
    if (!pendingSignup || pendingSignup.challengeId !== challengeId) throw new AppError('OTP_EXPIRED', 'Your sign-up has timed out. Please start again.');
    otpService.verify(challengeId, code, 'signup');
    const input = pendingSignup;
    const salt = uid('salt');
    const hash = await hashPassword(input.password, salt);
    const user = await mutate((db) => {
      const t = nowISO();
      const userId = uid('usr');
      const patient: Patient = {
        id: uid('pat'), userId, patientCode: patientCode(brand.patientIdPrefix), fullName: input.fullName.trim(),
        dateOfBirth: input.dateOfBirth, email: input.email.trim(), phone: input.phone.trim(), emergencyCardEnabled: false, createdAt: t,
      };
      const u: User = { id: userId, role: 'patient', email: patient.email, phone: patient.phone, passwordHash: hash, passwordSalt: salt, createdAt: t, profileId: patient.id, onboarded: false };
      db.users.push(u);
      db.patients.push(patient);
      audit(db, { patientId: patient.id, actor: { id: patient.id, role: 'patient', name: patient.fullName }, action: 'account_created', target: { type: 'account', label: 'Patient account' } });
      db.notifications.push({ id: uid('ntf'), userId, kind: 'security', title: `Welcome to ${brand.name}`, body: 'Your record is private by default. Only doctors you grant access to can see it, and every view is logged.', createdAt: t, read: false, link: '/app/privacy' });
      return u;
    });
    pendingSignup = null;
    await startSession(user.id);
    return user;
  },

  /** Step 1 of sign-in: check the password, then send a one-time code. */
  async startLogin(identifier: string, password: string): Promise<OtpChallenge> {
    await delay();
    const db = await getDb();
    const id = identifier.trim();
    const user = id.includes('@') ? db.users.find((u) => norm(u.email) === norm(id)) : db.users.find((u) => normPhone(u.phone) === normPhone(id) && normPhone(id).length >= 10);
    const ok = user && (await hashPassword(password, user.passwordSalt)) === user.passwordHash;
    if (!user || !ok) throw new AppError('AUTH_FAILED', 'That email/phone and password don’t match our records.');
    const challenge = otpService.request('login', user.phone);
    pendingLogin = { challengeId: challenge.id, userId: user.id, phone: user.phone };
    return challenge;
  },

  async completeLogin(challengeId: string, code: string): Promise<User> {
    await delay();
    if (!pendingLogin || pendingLogin.challengeId !== challengeId) throw new AppError('OTP_EXPIRED', 'Your sign-in has timed out. Please start again.');
    otpService.verify(challengeId, code, 'login');
    const userId = pendingLogin.userId;
    pendingLogin = null;
    await startSession(userId);
    const db = await getDb();
    return db.users.find((u) => u.id === userId)!;
  },

  resendCode(purpose: 'signup' | 'login'): OtpChallenge {
    if (purpose === 'signup' && pendingSignup) {
      const c = otpService.request('signup', pendingSignup.phone);
      pendingSignup.challengeId = c.id;
      return c;
    }
    if (purpose === 'login' && pendingLogin) {
      const c = otpService.request('login', pendingLogin.phone);
      pendingLogin.challengeId = c.id;
      return c;
    }
    throw new AppError('OTP_EXPIRED', 'Please start again.');
  },

  hasPending(purpose: 'signup' | 'login') {
    return purpose === 'signup' ? !!pendingSignup : !!pendingLogin;
  },

  async startPasswordReset(identifier: string): Promise<OtpChallenge | null> {
    await delay();
    const db = await getDb();
    const id = identifier.trim();
    const user = db.users.find((u) => norm(u.email) === norm(id) || (normPhone(id).length >= 10 && normPhone(u.phone) === normPhone(id)));
    // Don't reveal whether an account exists: callers show the same message either way.
    if (!user) return null;
    const c = otpService.request('reset_password', user.phone);
    pendingReset = { challengeId: c.id, userId: user.id };
    return c;
  },

  async completePasswordReset(challengeId: string, code: string, newPassword: string): Promise<void> {
    await delay();
    if (!pendingReset || pendingReset.challengeId !== challengeId) throw new AppError('OTP_EXPIRED', 'This reset link has expired. Please start again.');
    otpService.verify(challengeId, code, 'reset_password');
    const salt = uid('salt');
    const hash = await hashPassword(newPassword, salt);
    const userId = pendingReset.userId;
    await mutate((db) => {
      const u = db.users.find((x) => x.id === userId)!;
      u.passwordSalt = salt;
      u.passwordHash = hash;
      db.sessions = db.sessions.filter((s) => s.userId !== userId);
      audit(db, { patientId: u.role === 'patient' ? u.profileId : undefined, actor: actorFor(db, u), action: 'password_changed', target: { type: 'account', label: 'Password reset' } });
    });
    pendingReset = null;
  },

  async changePassword(current: string, next: string): Promise<void> {
    await delay();
    const ctx = await requireCtx();
    if ((await hashPassword(current, ctx.user.passwordSalt)) !== ctx.user.passwordHash) throw new AppError('AUTH_FAILED', 'Your current password is incorrect.');
    const salt = uid('salt');
    const hash = await hashPassword(next, salt);
    await mutate((db) => {
      const u = db.users.find((x) => x.id === ctx.user.id)!;
      u.passwordSalt = salt;
      u.passwordHash = hash;
      audit(db, { patientId: ctx.patient?.id, actor: ctx.actor, action: 'password_changed', target: { type: 'account', label: 'Password changed' } });
    });
  },

  /** Returns the signed-in user, or null. Throws SESSION_EXPIRED if a session timed out. */
  async currentUser(): Promise<User | null> {
    if (!perTab.get(SESSION_KEY)) return null;
    const ctx = await requireCtx();
    return ctx.user;
  },

  async logout(): Promise<void> {
    try {
      const ctx = await requireCtx();
      await mutate((db) => {
        db.sessions = db.sessions.filter((s) => s.id !== ctx.session.id);
        audit(db, { patientId: ctx.patient?.id, actor: ctx.actor, action: 'signed_out', target: { type: 'session', id: ctx.session.id, label: ctx.session.device } });
      });
    } catch {
      /* already signed out */
    }
    perTab.remove(SESSION_KEY);
  },

  async listSessions(): Promise<(Session & { current: boolean })[]> {
    await delay();
    const ctx = await requireCtx();
    return ctx.db.sessions
      .filter((s) => s.userId === ctx.user.id)
      .map((s) => ({ ...s, current: s.id === ctx.session.id }))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt));
  },

  async revokeSession(sessionId: string): Promise<void> {
    const ctx = await requireCtx();
    if (sessionId === ctx.session.id) throw new AppError('VALIDATION', 'Use “Log out” to end this session.');
    await mutate((db) => {
      db.sessions = db.sessions.filter((s) => !(s.id === sessionId && s.userId === ctx.user.id));
      audit(db, { patientId: ctx.patient?.id, actor: ctx.actor, action: 'sessions_revoked', target: { type: 'session', id: sessionId, label: 'Signed out a device' } });
    });
  },

  async revokeOtherSessions(): Promise<number> {
    const ctx = await requireCtx();
    return mutate((db) => {
      const before = db.sessions.length;
      db.sessions = db.sessions.filter((s) => s.userId !== ctx.user.id || s.id === ctx.session.id);
      const n = before - db.sessions.length;
      audit(db, { patientId: ctx.patient?.id, actor: ctx.actor, action: 'sessions_revoked', target: { type: 'session', label: `Signed out ${n} other device${n === 1 ? '' : 's'}` } });
      return n;
    });
  },

};
