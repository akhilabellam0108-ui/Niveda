import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { OtpChallenge, SignUpInput } from '@shared/api';
import { AppError, EMAIL_RE, PASSWORD_RULE, passwordOk, phoneOk } from '@shared/api';
import { config } from '../config';
import type { Db } from '../db/db';
import { iso } from '../db/db';
import { toDoctor, toHospital, toSession } from '../db/mappers';
import { digits, phoneDigits, sha256, token, uid } from '../lib/ids';
import { audit, ctxOf, h, loadCtx, notify, prefsFor } from '../core';
import { createChallenge, resendChallenge, verifyChallenge } from '../services/otp';

export const COOKIE = 'niveda_sid';
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export const hashPassword = (p: string) => argonHash(p, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

function describeDevice(ua = ''): string {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

/** Attaches req.ctx when a valid session cookie is present. */
export function sessionMiddleware() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const t = req.cookies?.[COOKIE];
      if (t) {
        const s = await req.db.one<{ id: string; user_id: string; expires_at: Date; last_active_at: Date }>('SELECT id, user_id, expires_at, last_active_at FROM sessions WHERE token_hash = $1', [sha256(t)]);
        if (s && new Date(iso(s.expires_at)) > new Date()) {
          req.ctx = await loadCtx(req.db, s.user_id, s.id, req.ip);
          if (Date.now() - new Date(iso(s.last_active_at)).getTime() > 60000) await req.db.query('UPDATE sessions SET last_active_at = now() WHERE id = $1', [s.id]);
        } else if (s) {
          await req.db.query('DELETE FROM sessions WHERE id = $1', [s.id]);
          (req as Request & { sessionExpired?: boolean }).sessionExpired = true;
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Rejects requests without a signed-in user (with a clear message when the session timed out). */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.ctx) return next();
  if ((req as Request & { sessionExpired?: boolean }).sessionExpired) return next(new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.'));
  next(new AppError('NOT_SIGNED_IN', 'Please sign in to continue.'));
}

async function startSession(req: Request, res: Response, userId: string) {
  const t = token();
  const id = uid('ses');
  const expires = new Date(Date.now() + config.sessionHours * 3600000);
  await req.db.query('INSERT INTO sessions (id, user_id, token_hash, device, ip, expires_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, userId, sha256(t), describeDevice(req.get('user-agent')), req.ip ?? null, expires]);
  res.cookie(COOKIE, t, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires, path: '/' });
  const ctx = (await loadCtx(req.db, userId, id, req.ip))!;
  await audit(req.db, { patientId: ctx.patient?.id, actor: ctx.actor, action: 'signed_in', target: { type: 'session', id, label: describeDevice(req.get('user-agent')) }, ip: req.ip });
  return ctx;
}

async function newPatientCode(db: Db) {
  for (;;) {
    const code = `NV-${digits(4)}-${digits(4)}`;
    if (!(await db.one('SELECT 1 FROM patients WHERE patient_code = $1', [code]))) return code;
  }
}

async function findUser(db: Db, identifier: string) {
  const id = identifier.trim();
  if (id.includes('@')) return db.one<Record<string, any>>('SELECT * FROM users WHERE email = $1', [id.toLowerCase()]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = phoneDigits(id);
  return d.length === 10 ? db.one<Record<string, any>>('SELECT * FROM users WHERE phone_digits = $1', [d]) : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Profile + preferences returned after sign-in and by /me. */
export async function mePayload(db: Db, userId: string) {
  const ctx = await loadCtx(db, userId, '');
  if (!ctx) return { user: null };
  const prefs = await prefsFor(db, userId);
  let doctor;
  if (ctx.doctor) {
    const hRow = await db.one('SELECT * FROM hospitals WHERE id = $1', [ctx.doctor.hospitalId]);
    doctor = { ...ctx.doctor, hospital: hRow ? toHospital(hRow) : undefined };
  }
  return { user: ctx.user, patient: ctx.patient, doctor, prefs };
}

const signUpSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  email: z.string().trim().max(200),
  phone: z.string().trim().max(30),
  password: z.string().max(200),
});
const codeSchema = z.object({ challengeId: z.string().min(1).max(80), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export function authRoutes() {
  const r = Router();

  r.post('/signup/start', h(async (req, res) => {
    const input = signUpSchema.parse(req.body) as SignUpInput;
    if (!EMAIL_RE.test(input.email)) throw new AppError('VALIDATION', 'Enter a valid email address.');
    if (!phoneOk(input.phone)) throw new AppError('VALIDATION', 'Enter a 10-digit mobile number.');
    if (!passwordOk(input.password)) throw new AppError('VALIDATION', PASSWORD_RULE);
    if (input.dateOfBirth > new Date().toISOString().slice(0, 10) || input.dateOfBirth < '1900-01-01') throw new AppError('VALIDATION', 'Check your date of birth.');
    const email = input.email.toLowerCase();
    if (await req.db.one('SELECT 1 FROM users WHERE email = $1', [email])) throw new AppError('CONFLICT', 'An account with this email already exists. Try signing in instead.');
    if (await req.db.one('SELECT 1 FROM users WHERE phone_digits = $1', [phoneDigits(input.phone)])) throw new AppError('CONFLICT', 'This phone number is already linked to an account.');
    const passwordHash = await hashPassword(input.password);
    const challenge = await createChallenge(req.db, 'signup', { email, phone: input.phone }, { payload: { fullName: input.fullName, dateOfBirth: input.dateOfBirth, email, phone: input.phone, passwordHash } });
    res.json(challenge);
  }));

  r.post('/signup/complete', h(async (req, res) => {
    const { challengeId, code } = codeSchema.parse(req.body);
    const { payload } = await verifyChallenge<{ fullName: string; dateOfBirth: string; email: string; phone: string; passwordHash: string }>(req.db, challengeId, code, 'signup');
    const userId = uid('usr');
    const patientId = uid('pat');
    await req.db.tx(async (q) => {
      if (await q.one('SELECT 1 FROM users WHERE email = $1 OR phone_digits = $2', [payload.email, phoneDigits(payload.phone)])) throw new AppError('CONFLICT', 'An account with these details already exists.');
      await q.query('INSERT INTO users (id, role, email, phone, phone_digits, password_hash, profile_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [userId, 'patient', payload.email, payload.phone, phoneDigits(payload.phone), payload.passwordHash, patientId]);
      await q.query('INSERT INTO patients (id, user_id, patient_code, full_name, date_of_birth, email, phone) VALUES ($1,$2,$3,$4,$5,$6,$7)', [patientId, userId, await newPatientCode(q), payload.fullName, payload.dateOfBirth, payload.email, payload.phone]);
      await audit(q, { patientId, actor: { id: patientId, role: 'patient', name: payload.fullName }, action: 'account_created', target: { type: 'account', label: 'Patient account' }, ip: req.ip });
      await notify(q, { userId, kind: 'security', title: 'Welcome to Niveda', body: 'Your record is private by default. Only doctors you grant access to can see it, and every view is logged.', link: '/app/privacy' });
    });
    await startSession(req, res, userId);
    res.json(await mePayload(req.db, userId));
  }));

  r.post('/login/start', h(async (req, res) => {
    const { identifier, password } = z.object({ identifier: z.string().max(200), password: z.string().max(200) }).parse(req.body);
    const u = await findUser(req.db, identifier);
    const generic = new AppError('AUTH_FAILED', 'That email/phone and password don’t match our records.');
    if (!u) { await hashPassword(password); throw generic; } // same timing either way
    if (u.locked_until && new Date(iso(u.locked_until)) > new Date()) throw new AppError('RATE_LIMITED', `Too many failed attempts. Try again after ${new Date(iso(u.locked_until)).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}, or reset your password.`);
    if (!(await argonVerify(u.password_hash, password))) {
      const fails = u.failed_logins + 1;
      await req.db.query('UPDATE users SET failed_logins = $2, locked_until = $3 WHERE id = $1', [u.id, fails >= LOCK_AFTER ? 0 : fails, fails >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60000) : null]);
      throw generic;
    }
    await req.db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
    res.json(await createChallenge(req.db, 'login', { email: u.email, phone: u.phone }, { userId: u.id }));
  }));

  r.post('/login/complete', h(async (req, res) => {
    const { challengeId, code } = codeSchema.parse(req.body);
    const { userId } = await verifyChallenge(req.db, challengeId, code, 'login');
    await startSession(req, res, userId!);
    res.json(await mePayload(req.db, userId!));
  }));

  r.post('/resend', h(async (req, res) => {
    const { challengeId } = z.object({ challengeId: z.string().max(80) }).parse(req.body);
    res.json(await resendChallenge(req.db, challengeId));
  }));

  r.post('/password-reset/start', h(async (req, res) => {
    const { identifier } = z.object({ identifier: z.string().max(200) }).parse(req.body);
    const u = await findUser(req.db, identifier);
    // Same response whether or not the account exists.
    const challenge: OtpChallenge | null = u ? await createChallenge(req.db, 'reset_password', { email: u.email, phone: u.phone }, { userId: u.id }) : null;
    res.json({ challenge });
  }));

  r.post('/password-reset/complete', h(async (req, res) => {
    const { challengeId, code, newPassword } = codeSchema.extend({ newPassword: z.string().max(200) }).parse(req.body);
    if (!passwordOk(newPassword)) throw new AppError('VALIDATION', PASSWORD_RULE);
    const { userId } = await verifyChallenge(req.db, challengeId, code, 'reset_password');
    const hash = await hashPassword(newPassword);
    await req.db.query('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [userId, hash]);
    await req.db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    const ctx = await loadCtx(req.db, userId!, '');
    await audit(req.db, { patientId: ctx?.patient?.id, actor: ctx!.actor, action: 'password_changed', target: { type: 'account', label: 'Password reset' }, ip: req.ip });
    res.json({ ok: true });
  }));

  r.get('/me', h(async (req, res) => {
    if (!req.ctx) {
      if ((req as Request & { sessionExpired?: boolean }).sessionExpired) throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
      res.json({ user: null });
      return;
    }
    res.json(await mePayload(req.db, req.ctx.user.id));
  }));

  r.post('/logout', h(async (req, res) => {
    if (req.ctx) {
      await req.db.query('DELETE FROM sessions WHERE id = $1', [req.ctx.sessionId]);
      await audit(req.db, { patientId: req.ctx.patient?.id, actor: req.ctx.actor, action: 'signed_out', target: { type: 'session', id: req.ctx.sessionId, label: 'Signed out' }, ip: req.ip });
    }
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  /* ----- everything below needs a session ----- */
  r.use(requireAuth);

  r.post('/verify', h(async (req, res) => {
    const ctx = ctxOf(req);
    const { purpose } = z.object({ purpose: z.enum(['grant_access', 'approve_request', 'change_permissions']) }).parse(req.body);
    res.json(await createChallenge(req.db, purpose, { email: ctx.user.email, phone: ctx.user.phone }, { userId: ctx.user.id }));
  }));

  r.post('/password', h(async (req, res) => {
    const ctx = ctxOf(req);
    const { current, next } = z.object({ current: z.string().max(200), next: z.string().max(200) }).parse(req.body);
    if (!passwordOk(next)) throw new AppError('VALIDATION', PASSWORD_RULE);
    const u = await req.db.one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [ctx.user.id]);
    if (!(await argonVerify(u!.password_hash, current))) throw new AppError('AUTH_FAILED', 'Your current password is incorrect.');
    await req.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [ctx.user.id, await hashPassword(next)]);
    await req.db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [ctx.user.id, ctx.sessionId]);
    await audit(req.db, { patientId: ctx.patient?.id, actor: ctx.actor, action: 'password_changed', target: { type: 'account', label: 'Password changed' }, ip: req.ip });
    res.json({ ok: true });
  }));

  r.get('/sessions', h(async (req, res) => {
    const ctx = ctxOf(req);
    const rows = await req.db.query('SELECT * FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_active_at DESC', [ctx.user.id]);
    res.json(rows.map((s) => ({ ...toSession(s), current: s.id === ctx.sessionId })).sort((a, b) => Number(b.current) - Number(a.current)));
  }));

  r.delete('/sessions/:id', h(async (req, res) => {
    const ctx = ctxOf(req);
    if (req.params.id === ctx.sessionId) throw new AppError('VALIDATION', 'Use “Log out” to end this session.');
    await req.db.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [req.params.id, ctx.user.id]);
    await audit(req.db, { patientId: ctx.patient?.id, actor: ctx.actor, action: 'sessions_revoked', target: { type: 'session', id: req.params.id, label: 'Signed out a device' }, ip: req.ip });
    res.json({ ok: true });
  }));

  r.post('/sessions/revoke-others', h(async (req, res) => {
    const ctx = ctxOf(req);
    const rows = await req.db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2 RETURNING id', [ctx.user.id, ctx.sessionId]);
    await audit(req.db, { patientId: ctx.patient?.id, actor: ctx.actor, action: 'sessions_revoked', target: { type: 'session', label: `Signed out ${rows.length} other device${rows.length === 1 ? '' : 's'}` }, ip: req.ip });
    res.json({ count: rows.length });
  }));

  return r;
}

export { toDoctor };
