/**
 * Request context, error mapping, audit and notification helpers used by every route.
 * All access-control decisions happen here on the server.
 */
import type { NextFunction, Request, Response } from 'express';
import type { AccessGrant, Actor, AuditAction, AuditLog, Doctor, Notification, Patient, PermissionKey, Preferences, Role, User } from '@shared/types';
import { AppError, type ErrorCode } from '@shared/api';
import { RECORD_TYPES } from '@shared/recordMeta';
import type { Db } from './db/db';
import { json } from './db/db';
import { toDoctor, toGrant, toPatient, toUser } from './db/mappers';
import { uid } from './lib/ids';
import { events } from './events';

export { AppError };

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400, OTP_INVALID: 400, OTP_EXPIRED: 400, AUTH_FAILED: 401, NOT_SIGNED_IN: 401, SESSION_EXPIRED: 401,
  ACCESS_DENIED: 403, NOT_FOUND: 404, CONFLICT: 409, RATE_LIMITED: 429, NETWORK: 503, UNKNOWN: 500,
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  void _next;
  if (err instanceof AppError) {
    res.status(STATUS[err.code] ?? 400).json({ error: { code: err.code, message: err.message } });
    return;
  }
  const e = err as { name?: string; issues?: { path: (string | number)[]; message: string }[]; code?: string; type?: string };
  if (e?.name === 'ZodError' && e.issues) {
    const first = e.issues[0];
    res.status(400).json({ error: { code: 'VALIDATION', message: `${first.path.join('.') || 'Request'}: ${first.message}` } });
    return;
  }
  if (e?.code === 'LIMIT_FILE_SIZE') { res.status(400).json({ error: { code: 'VALIDATION', message: 'Files must be 15 MB or smaller.' } }); return; }
  if (e?.type === 'entity.too.large') { res.status(413).json({ error: { code: 'VALIDATION', message: 'That request is too large.' } }); return; }
  console.error(err);
  // Never leak internals to the client.
  res.status(500).json({ error: { code: 'UNKNOWN', message: 'Something went wrong on our side. Please try again.' } });
}

/** Wraps async route handlers so thrown errors reach the error handler. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

export interface Ctx {
  db: Db;
  user: User;
  sessionId: string;
  actor: Actor;
  patient?: Patient;
  doctor?: Doctor;
  ip?: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: Ctx;
    db: Db;
  }
}

export function ctxOf(req: Request, role?: Role): Ctx {
  const ctx = req.ctx;
  if (!ctx) throw new AppError('NOT_SIGNED_IN', 'Please sign in to continue.');
  if (role && ctx.user.role !== role) throw new AppError('ACCESS_DENIED', 'This area isn’t available for your account.');
  return ctx;
}

export async function loadCtx(db: Db, userId: string, sessionId: string, ip?: string): Promise<Ctx | undefined> {
  const u = await db.one('SELECT * FROM users WHERE id = $1', [userId]);
  if (!u) return undefined;
  const user = toUser(u);
  if (user.role === 'patient') {
    const p = await db.one('SELECT * FROM patients WHERE id = $1', [user.profileId]);
    const patient = toPatient(p!);
    return { db, user, sessionId, ip, patient, actor: { id: patient.id, role: 'patient', name: patient.fullName } };
  }
  const d = await db.one('SELECT d.*, h.name AS hospital_name FROM doctors d JOIN hospitals h ON h.id = d.hospital_id WHERE d.id = $1', [user.profileId]);
  const doctor = toDoctor(d!);
  return { db, user, sessionId, ip, doctor, actor: { id: doctor.id, role: 'doctor', name: doctor.fullName, organization: String(d!.hospital_name) } };
}

/* ---------------- Audit ---------------- */

export async function audit(db: Db, e: { patientId?: string; actor: Actor; action: AuditAction; target?: AuditLog['target']; metadata?: AuditLog['metadata']; at?: string; ip?: string }) {
  await db.query(
    'INSERT INTO audit_logs (id, patient_id, actor, action, target, ts, metadata, ip) VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,COALESCE($6::timestamptz, now()),$7::jsonb,$8)',
    [uid('aud'), e.patientId ?? null, json(e.actor), e.action, json(e.target), e.at ?? null, json(e.metadata), e.ip ?? null],
  );
}

/** True if the same actor logged the same view recently (avoids log spam on refresh). */
export async function recentlyLogged(db: Db, actorId: string, action: AuditAction, targetId: string | undefined, patientId: string, minutes = 10) {
  const r = await db.one(
    `SELECT 1 FROM audit_logs WHERE actor->>'id' = $1 AND action = $2 AND patient_id = $3 AND COALESCE(target->>'id','') = $4 AND ts > now() - ($5 || ' minutes')::interval LIMIT 1`,
    [actorId, action, patientId, targetId ?? '', String(minutes)],
  );
  return !!r;
}

/* ---------------- Notifications ---------------- */

export const SYSTEM_ACTOR: Actor = { id: 'system', role: 'system', name: 'Niveda' };

export async function prefsFor(db: Db, userId: string): Promise<Partial<Preferences>> {
  const r = await db.one<{ data: Partial<Preferences> }>('SELECT data FROM preferences WHERE user_id = $1', [userId]);
  return r?.data ?? {};
}

export async function notify(db: Db, n: Omit<Notification, 'id' | 'createdAt' | 'read'> & { createdAt?: string }) {
  const p = await prefsFor(db, n.userId);
  if (n.kind === 'record' && p.notifyRecords === false) return;
  if ((n.kind === 'access' || n.kind === 'request') && p.notifyAccess === false) return;
  if (n.kind === 'reminder' && p.notifyReminders === false) return;
  await db.query(
    'INSERT INTO notifications (id, user_id, kind, title, body, link, created_at) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()))',
    [uid('ntf'), n.userId, n.kind, n.title, n.body, n.link ?? null, n.createdAt ?? null],
  );
  events.touchUsers([n.userId]);
}

export async function patientUserId(db: Db, patientId: string) {
  return (await db.one<{ user_id: string }>('SELECT user_id FROM patients WHERE id = $1', [patientId]))?.user_id;
}
export async function doctorUserId(db: Db, doctorId: string) {
  return (await db.one<{ user_id: string }>('SELECT user_id FROM doctors WHERE id = $1', [doctorId]))?.user_id;
}

/** Tell every open app that can see this patient's record to refresh. */
export async function touchPatient(db: Db, patientId: string) {
  const rows = await db.query<{ user_id: string }>(
    `SELECT user_id FROM patients WHERE id = $1
     UNION SELECT d.user_id FROM access_grants g JOIN doctors d ON d.id = g.doctor_id WHERE g.patient_id = $1
     UNION SELECT d.user_id FROM access_requests r JOIN doctors d ON d.id = r.doctor_id WHERE r.patient_id = $1`,
    [patientId],
  );
  events.touchUsers(rows.map((r) => r.user_id));
}

/* ---------------- Access checks ---------------- */

/** Marks overdue grants expired (logging and notifying once). Called by the background job and before access checks. */
export async function expireGrants(db: Db, filter?: { patientId?: string; doctorId?: string }) {
  const rows = await db.query(
    `UPDATE access_grants SET status = 'expired' WHERE status = 'active' AND expires_at <= now()
       AND ($1::text IS NULL OR patient_id = $1) AND ($2::text IS NULL OR doctor_id = $2)
     RETURNING *`,
    [filter?.patientId ?? null, filter?.doctorId ?? null],
  );
  for (const r of rows) {
    const g = toGrant(r);
    if (g.expiryLogged) continue;
    await db.query('UPDATE access_grants SET expiry_logged = true WHERE id = $1', [g.id]);
    const d = await db.one<{ full_name: string; user_id: string }>('SELECT full_name, user_id FROM doctors WHERE id = $1', [g.doctorId]);
    const p = await db.one<{ full_name: string; user_id: string }>('SELECT full_name, user_id FROM patients WHERE id = $1', [g.patientId]);
    await audit(db, { patientId: g.patientId, actor: SYSTEM_ACTOR, action: 'access_expired', target: { type: 'doctor', id: g.doctorId, label: d?.full_name ?? 'Doctor' }, at: g.expiresAt });
    if (p) await notify(db, { userId: p.user_id, kind: 'access', title: 'Access expired', body: `${d?.full_name} can no longer see your records.`, link: '/app/access?tab=history', createdAt: g.expiresAt });
    if (d) await notify(db, { userId: d.user_id, kind: 'access', title: 'Access ended', body: `Your access to ${p?.full_name}’s records has expired.`, createdAt: g.expiresAt });
    await touchPatient(db, g.patientId);
  }
  return rows.length;
}

export async function activeGrant(db: Db, doctorId: string, patientId: string): Promise<AccessGrant | undefined> {
  const r = await db.one(`SELECT * FROM access_grants WHERE doctor_id = $1 AND patient_id = $2 AND status = 'active' AND expires_at > now() ORDER BY granted_at DESC LIMIT 1`, [doctorId, patientId]);
  return r ? toGrant(r) : undefined;
}

/** Throws unless the doctor currently has an active grant (optionally covering a permission). */
export async function requireGrant(db: Db, doctorId: string, patientId: string, permission?: PermissionKey): Promise<AccessGrant> {
  await expireGrants(db, { doctorId, patientId });
  const g = await activeGrant(db, doctorId, patientId);
  if (!g) throw new AppError('ACCESS_DENIED', 'You no longer have access to this patient’s records. Ask the patient to grant access again.');
  if (permission && !g.permissions.includes(permission)) throw new AppError('ACCESS_DENIED', 'The patient hasn’t shared this part of their record with you.');
  return g;
}

/** For a patient: their own id. For a doctor: the requested patient, after checking access. */
export async function resolvePatient(ctx: Ctx, patientId?: string): Promise<{ patientId: string; grant?: AccessGrant }> {
  if (ctx.patient) {
    if (patientId && patientId !== ctx.patient.id) throw new AppError('ACCESS_DENIED', 'You can only view your own record.');
    return { patientId: ctx.patient.id };
  }
  if (!patientId) throw new AppError('VALIDATION', 'Choose a patient.');
  return { patientId, grant: await requireGrant(ctx.db, ctx.doctor!.id, patientId) };
}

export const permissionFor = (type: keyof typeof RECORD_TYPES) => RECORD_TYPES[type].permission;
