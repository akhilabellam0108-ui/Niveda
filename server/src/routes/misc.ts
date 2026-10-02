import { Router } from 'express';
import { z } from 'zod';
import type { PatientOverview, RecentEntry, DoctorAuditView } from '@shared/api';
import { summarise } from '@shared/api';
import type { Preferences } from '@shared/types';
import { RECORD_TYPES } from '@shared/recordMeta';
import { json } from '../db/db';
import { toAudit, toNotification, toPatient, toRecord } from '../db/mappers';
import { ctxOf, h, requireGrant } from '../core';
import { events } from '../events';
import { loadRecords } from '../services/records';

export const DEFAULT_PREFS: Preferences = { theme: 'system', language: 'en', medAlarms: true, medAlarmSound: true, notifyRecords: true, notifyAccess: true, notifyReminders: true };

export function doctorRoutes() {
  const r = Router();

  r.patch('/profile', h(async (req, res) => {
    const ctx = ctxOf(req, 'doctor');
    const p = z.object({ phone: z.string().trim().min(10).max(30).optional(), qualifications: z.string().trim().max(200).optional() }).parse(req.body);
    if (p.phone) {
      await ctx.db.query('UPDATE doctors SET phone = $2 WHERE id = $1', [ctx.doctor!.id, p.phone]);
      await ctx.db.query('UPDATE users SET phone = $2, phone_digits = $3 WHERE id = $1', [ctx.user.id, p.phone, p.phone.replace(/\D/g, '').slice(-10)]);
    }
    if (p.qualifications !== undefined) await ctx.db.query('UPDATE doctors SET qualifications = $2 WHERE id = $1', [ctx.doctor!.id, p.qualifications]);
    events.touchUsers([ctx.user.id]);
    res.json({ ok: true });
  }));

  /** Summary of an authorised patient, filtered by the permissions the patient granted. */
  r.get('/patients/:id/overview', h(async (req, res) => {
    const ctx = ctxOf(req, 'doctor');
    const grant = await requireGrant(ctx.db, ctx.doctor!.id, req.params.id);
    const patient = toPatient((await ctx.db.one('SELECT * FROM patients WHERE id = $1', [req.params.id]))!);
    const records = (await loadRecords(ctx.db, patient.id)).filter((x) => grant.permissions.includes(RECORD_TYPES[x.type].permission));
    const safe = { ...patient, email: '', phone: '' };
    const out: PatientOverview = { grant, ...summarise(safe, records), grantedBy: patient.fullName };
    res.json(out);
  }));

  r.get('/entries', h(async (req, res) => {
    const ctx = ctxOf(req, 'doctor');
    const rows = await ctx.db.query(
      `SELECT r.*, p.full_name AS patient_name FROM records r JOIN patients p ON p.id = r.patient_id
       WHERE r.created_by->>'id' = $1 AND r.parent_id IS NULL ORDER BY r.created_at DESC LIMIT 8`, [ctx.doctor!.id]);
    const out: RecentEntry[] = rows.map((x) => ({ ...toRecord(x), patientName: String(x.patient_name) }));
    res.json(out);
  }));

  return r;
}

export function notificationRoutes() {
  const r = Router();
  r.get('/', h(async (req, res) => {
    const ctx = ctxOf(req);
    res.json((await ctx.db.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200', [ctx.user.id])).map(toNotification));
  }));
  r.get('/unread-count', h(async (req, res) => {
    const ctx = ctxOf(req);
    const n = await ctx.db.one<{ n: string }>('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND NOT read', [ctx.user.id]);
    res.json({ count: Number(n?.n ?? 0) });
  }));
  r.post('/:id/read', h(async (req, res) => {
    const ctx = ctxOf(req);
    await ctx.db.query('UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2', [req.params.id, ctx.user.id]);
    events.touchUsers([ctx.user.id]);
    res.json({ ok: true });
  }));
  r.post('/read-all', h(async (req, res) => {
    const ctx = ctxOf(req);
    await ctx.db.query('UPDATE notifications SET read = true WHERE user_id = $1', [ctx.user.id]);
    events.touchUsers([ctx.user.id]);
    res.json({ ok: true });
  }));
  return r;
}

export function auditRoutes() {
  const r = Router();
  /** Everything that happened to the signed-in patient's record. */
  r.get('/patient', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    res.json((await ctx.db.query('SELECT * FROM audit_logs WHERE patient_id = $1 ORDER BY ts DESC LIMIT 1000', [ctx.patient!.id])).map(toAudit));
  }));
  /** A doctor's own actions. */
  r.get('/doctor', h(async (req, res) => {
    const ctx = ctxOf(req, 'doctor');
    const rows = await ctx.db.query(`SELECT a.*, p.full_name AS patient_name FROM audit_logs a LEFT JOIN patients p ON p.id = a.patient_id WHERE a.actor->>'id' = $1 ORDER BY a.ts DESC LIMIT 500`, [ctx.doctor!.id]);
    const out: DoctorAuditView[] = rows.map((x) => ({ ...toAudit(x), patientName: (x.patient_name as string) ?? undefined }));
    res.json(out);
  }));
  r.get('/sign-ins', h(async (req, res) => {
    const ctx = ctxOf(req);
    const rows = await ctx.db.query(`SELECT * FROM audit_logs WHERE actor->>'id' = $1 AND action IN ('signed_in','signed_out','password_changed','sessions_revoked') ORDER BY ts DESC LIMIT 50`, [ctx.actor.id]);
    res.json(rows.map(toAudit));
  }));
  return r;
}

export function settingsRoutes() {
  const r = Router();
  r.get('/', h(async (req, res) => {
    const ctx = ctxOf(req);
    const row = await ctx.db.one<{ data: Partial<Preferences> }>('SELECT data FROM preferences WHERE user_id = $1', [ctx.user.id]);
    res.json({ ...DEFAULT_PREFS, ...row?.data });
  }));
  r.patch('/', h(async (req, res) => {
    const ctx = ctxOf(req);
    const p = z.object({
      theme: z.enum(['system', 'light', 'dark']).optional(), language: z.literal('en').optional(),
      medAlarms: z.boolean().optional(), medAlarmSound: z.boolean().optional(), notifyRecords: z.boolean().optional(),
      notifyAccess: z.boolean().optional(), notifyReminders: z.boolean().optional(),
      timezone: z.string().max(60).refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown time zone').optional(),
    }).parse(req.body);
    const row = await ctx.db.one<{ data: Partial<Preferences> }>('SELECT data FROM preferences WHERE user_id = $1', [ctx.user.id]);
    const next = { ...DEFAULT_PREFS, ...row?.data, ...p };
    await ctx.db.query('INSERT INTO preferences (user_id, data) VALUES ($1,$2::jsonb) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data', [ctx.user.id, json(next)]);
    events.touchUsers([ctx.user.id]);
    res.json(next);
  }));
  return r;
}
