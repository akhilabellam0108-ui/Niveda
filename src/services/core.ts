/**
 * Shared helpers for the service layer. In production these rules run on the
 * server; the browser must never be the place that enforces access control.
 */
import type { AccessGrant, Actor, AuditLog, Database, Doctor, Notification, Patient, PermissionKey, Session, User } from '../types';
import { getDb } from '../mock/db';
import { perTab } from '../mock/storage';
import { now, nowISO } from '../lib/dates';
import { uid } from '../lib/ids';
import { RECORD_TYPES } from '../lib/recordMeta';

export type ErrorCode =
  | 'ACCESS_DENIED' | 'SESSION_EXPIRED' | 'NOT_SIGNED_IN' | 'NOT_FOUND' | 'VALIDATION'
  | 'OTP_INVALID' | 'OTP_EXPIRED' | 'AUTH_FAILED' | 'CONFLICT' | 'UNKNOWN';

/** Errors carry a message that is safe to show to people. */
export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

export const friendlyError = (e: unknown, fallback = 'Something went wrong. Please try again.') =>
  e instanceof AppError ? e.message : fallback;

export const SESSION_KEY = 'niveda.session';

export interface Ctx {
  db: Database;
  user: User;
  session: Session;
  actor: Actor;
  patient?: Patient;
  doctor?: Doctor;
}

export function actorFor(db: Database, user: User): Actor {
  if (user.role === 'doctor') {
    const d = db.doctors.find((x) => x.id === user.profileId)!;
    return { id: d.id, role: 'doctor', name: d.fullName, organization: db.hospitals.find((h) => h.id === d.hospitalId)?.name };
  }
  const p = db.patients.find((x) => x.id === user.profileId)!;
  return { id: p.id, role: 'patient', name: p.fullName };
}

export async function requireCtx(role?: User['role']): Promise<Ctx> {
  const db = await getDb();
  const raw = perTab.get(SESSION_KEY);
  if (!raw) throw new AppError('NOT_SIGNED_IN', 'Please sign in to continue.');
  const { sessionId } = JSON.parse(raw) as { sessionId: string };
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session || new Date(session.expiresAt) <= now()) {
    perTab.remove(SESSION_KEY);
    throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) throw new AppError('NOT_SIGNED_IN', 'Please sign in to continue.');
  if (role && user.role !== role) throw new AppError('ACCESS_DENIED', 'This area isn’t available for your account.');
  session.lastActiveAt = nowISO();
  return {
    db, user, session, actor: actorFor(db, user),
    patient: user.role === 'patient' ? db.patients.find((p) => p.id === user.profileId) : undefined,
    doctor: user.role === 'doctor' ? db.doctors.find((d) => d.id === user.profileId) : undefined,
  };
}

export function audit(db: Database, entry: Omit<AuditLog, 'id' | 'timestamp'> & { timestamp?: string }) {
  db.audit.push({ id: uid('aud'), timestamp: entry.timestamp ?? nowISO(), ...entry });
}

/** True if the same actor logged the same view of the same target recently (avoids log spam on refresh). */
export function recentlyLogged(db: Database, actorId: string, action: AuditLog['action'], targetId: string | undefined, patientId: string, minutes = 10): boolean {
  const cutoff = now().getTime() - minutes * 60000;
  return db.audit.some((a) => a.actor.id === actorId && a.action === action && a.patientId === patientId && (a.target?.id ?? '') === (targetId ?? '') && new Date(a.timestamp).getTime() > cutoff);
}

export function notify(db: Database, n: Omit<Notification, 'id' | 'createdAt' | 'read'> & { createdAt?: string }) {
  const prefs = db.preferences[n.userId];
  if (prefs) {
    if (n.kind === 'record' && !prefs.notifyRecords) return;
    if ((n.kind === 'access' || n.kind === 'request') && !prefs.notifyAccess) return;
    if (n.kind === 'reminder' && !prefs.notifyReminders) return;
  }
  db.notifications.push({ id: uid('ntf'), createdAt: n.createdAt ?? nowISO(), read: false, ...n });
}

export const patientUserId = (db: Database, patientId: string) => db.patients.find((p) => p.id === patientId)?.userId;
export const doctorUserId = (db: Database, doctorId: string) => db.doctors.find((d) => d.id === doctorId)?.userId;

/**
 * Marks grants whose time is up as expired, and sends a one-time reminder the
 * day before. Runs on every read in the prototype; a backend would use a job.
 */
export function sweepGrants(db: Database): boolean {
  let changed = false;
  const t = now().getTime();
  for (const g of db.grants) {
    if (g.status !== 'active') continue;
    const exp = new Date(g.expiresAt).getTime();
    const doctor = db.doctors.find((d) => d.id === g.doctorId);
    if (exp <= t) {
      g.status = 'expired';
      changed = true;
      if (!g.expiryLogged) {
        g.expiryLogged = true;
        audit(db, { patientId: g.patientId, actor: { id: 'system', role: 'system', name: 'Niveda' }, action: 'access_expired', target: { type: 'doctor', id: g.doctorId, label: doctor?.fullName ?? 'Doctor' }, timestamp: g.expiresAt });
        const pu = patientUserId(db, g.patientId);
        if (pu) notify(db, { userId: pu, kind: 'access', title: 'Access expired', body: `${doctor?.fullName} can no longer see your records.`, link: '/app/access?tab=history', createdAt: g.expiresAt });
        const du = doctorUserId(db, g.doctorId);
        const p = db.patients.find((x) => x.id === g.patientId);
        if (du) notify(db, { userId: du, kind: 'access', title: 'Access ended', body: `Your access to ${p?.fullName}’s records has expired.`, createdAt: g.expiresAt });
      }
    } else if (!g.reminderSent && exp - t < 24 * 3600000) {
      g.reminderSent = true;
      changed = true;
      const pu = patientUserId(db, g.patientId);
      if (pu) notify(db, { userId: pu, kind: 'reminder', title: 'Access ends soon', body: `${doctor?.fullName}’s access to your records ends within 24 hours.`, link: '/app/access' });
    }
  }
  return changed;
}

export function activeGrant(db: Database, doctorId: string, patientId: string): AccessGrant | undefined {
  const t = now().getTime();
  return db.grants.find((g) => g.doctorId === doctorId && g.patientId === patientId && g.status === 'active' && new Date(g.expiresAt).getTime() > t);
}

/** Throws unless the doctor currently has an active grant (optionally covering a permission). */
export function requireGrant(db: Database, doctorId: string, patientId: string, permission?: PermissionKey): AccessGrant {
  sweepGrants(db);
  const g = activeGrant(db, doctorId, patientId);
  if (!g) throw new AppError('ACCESS_DENIED', 'You no longer have access to this patient’s records. Ask the patient to grant access again.');
  if (permission && !g.permissions.includes(permission)) {
    throw new AppError('ACCESS_DENIED', 'The patient hasn’t shared this part of their record with you.');
  }
  return g;
}

export const permissionForType = (type: keyof typeof RECORD_TYPES) => RECORD_TYPES[type].permission;
