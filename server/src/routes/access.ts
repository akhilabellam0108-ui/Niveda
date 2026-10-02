import { Router } from 'express';
import { z } from 'zod';
import type { AccessGrant, GrantMethod, PermissionKey } from '@shared/types';
import type { DoctorGrantView, GrantView, RequestView } from '@shared/api';
import { AppError, EMAIL_RE, durationLabel, maskName } from '@shared/api';
import { PERMISSIONS, permissionLabel } from '@shared/recordMeta';
import type { Db } from '../db/db';
import { json } from '../db/db';
import { toDoctor, toGrant, toHospital, toInvite, toRequest } from '../db/mappers';
import { uid } from '../lib/ids';
import { activeGrant, audit, ctxOf, doctorUserId, expireGrants, h, notify, patientUserId, touchPatient, type Ctx } from '../core';
import { verifyChallenge } from '../services/otp';
import { sendEmail } from '../services/messaging';
import { config } from '../config';

const permissions = z.array(z.enum(PERMISSIONS.map((p) => p.key) as [PermissionKey, ...PermissionKey[]])).min(1, 'Choose at least one part of the record to share.');
const hours = z.number().int().min(1, 'Access can last between 1 hour and 90 days.').max(24 * 90, 'Access can last between 1 hour and 90 days.');
const verification = z.object({ challengeId: z.string(), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

const METHOD_LABEL: Record<GrantMethod, string> = {
  directory: 'Doctor directory', code: 'Doctor access code', qr: 'QR code', invite: 'Invitation', request: 'Approved request',
};

async function doctorsById(db: Db, ids: string[]) {
  const rows = await db.query('SELECT d.*, h.id AS h_id, h.name AS h_name, h.city AS h_city, h.type AS h_type FROM doctors d JOIN hospitals h ON h.id = d.hospital_id WHERE d.id = ANY($1::text[])', [ids]);
  return new Map(rows.map((r) => [r.id as string, { doctor: toDoctor(r), hospital: toHospital({ id: r.h_id, name: r.h_name, city: r.h_city, type: r.h_type }) }]));
}

/** Creates a grant (replacing any active one for the same doctor), audits and notifies. Call inside a transaction. */
async function createGrant(q: Db, ctx: Ctx, doctorId: string, perms: PermissionKey[], hrs: number, method: GrantMethod, requestId?: string): Promise<AccessGrant> {
  const patient = ctx.patient!;
  const d = await q.one<{ full_name: string; user_id: string }>('SELECT full_name, user_id FROM doctors WHERE id = $1', [doctorId]);
  if (!d) throw new AppError('NOT_FOUND', 'We couldn’t find that doctor.');
  await q.query(`UPDATE access_grants SET status = 'revoked', revoked_at = now() WHERE patient_id = $1 AND doctor_id = $2 AND status = 'active'`, [patient.id, doctorId]);
  const id = uid('grt');
  const row = await q.one(
    `INSERT INTO access_grants (id, patient_id, doctor_id, permissions, granted_at, expires_at, status, method, verified_at, request_id)
     VALUES ($1,$2,$3,$4::jsonb,now(),now() + ($5 || ' hours')::interval,'active',$6,now(),$7) RETURNING *`,
    [id, patient.id, doctorId, json(perms), String(hrs), method, requestId ?? null],
  );
  await audit(q, {
    patientId: patient.id, actor: ctx.actor, action: 'access_granted', target: { type: 'doctor', id: doctorId, label: d.full_name }, ip: ctx.ip,
    metadata: { permissions: perms.map(permissionLabel), duration: durationLabel(hrs), method: METHOD_LABEL[method] },
  });
  await notify(q, { userId: d.user_id, kind: 'access', title: 'Access granted', body: `${patient.fullName} gave you access to their records for ${durationLabel(hrs)}.`, link: `/doctor/patients/${patient.id}` });
  return toGrant(row!);
}

export function accessRoutes() {
  const r = Router();

  /* ---------------- Patient ---------------- */

  r.get('/', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const pid = ctx.patient!.id;
    await expireGrants(ctx.db, { patientId: pid });
    const grants = (await ctx.db.query('SELECT * FROM access_grants WHERE patient_id = $1 ORDER BY granted_at DESC', [pid])).map(toGrant);
    const requests = (await ctx.db.query(`SELECT * FROM access_requests WHERE patient_id = $1 AND status = 'pending' ORDER BY created_at DESC`, [pid])).map(toRequest);
    const docs = await doctorsById(ctx.db, [...grants.map((g) => g.doctorId), ...requests.map((x) => x.doctorId)]);
    const views: GrantView[] = grants.map((g) => ({ ...g, ...docs.get(g.doctorId)!, effectiveStatus: g.status }));
    const reqViews: RequestView[] = requests.map((x) => ({ ...x, ...docs.get(x.doctorId)! }));
    const invites = (await ctx.db.query(`SELECT * FROM doctor_invites WHERE patient_id = $1 AND status = 'sent' ORDER BY created_at DESC`, [pid])).map(toInvite);
    res.json({ active: views.filter((g) => g.status === 'active'), past: views.filter((g) => g.status !== 'active'), requests: reqViews, invites });
  }));

  r.get('/doctors', h(async (req, res) => {
    ctxOf(req, 'patient');
    const q = String(req.query.q ?? '').trim().toLowerCase();
    if (q.length < 2) { res.json([]); return; }
    const rows = await req.db.query(
      `SELECT d.id FROM doctors d JOIN hospitals h ON h.id = d.hospital_id
       WHERE lower(d.full_name) LIKE $1 OR lower(d.specialization) LIKE $1 OR lower(h.name) LIKE $1 ORDER BY d.full_name LIMIT 8`,
      [`%${q.replace(/[%_\\]/g, '')}%`],
    );
    const docs = await doctorsById(req.db, rows.map((x) => x.id as string));
    res.json(rows.map((x) => { const v = docs.get(x.id as string)!; return { ...v.doctor, hospital: v.hospital }; }));
  }));

  r.get('/doctors/by-code/:code', h(async (req, res) => {
    ctxOf(req, 'patient');
    const code = req.params.code.trim().toUpperCase().replace(/[\s-]/g, '');
    const row = await req.db.one(`SELECT id FROM doctors WHERE replace(access_code, '-', '') = $1`, [code]);
    if (!row) throw new AppError('NOT_FOUND', 'No doctor matches that code. Check it with your doctor.');
    const v = (await doctorsById(req.db, [row.id as string])).get(row.id as string)!;
    res.json({ ...v.doctor, hospital: v.hospital });
  }));

  r.post('/grants', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const p = z.object({ doctorId: z.string(), permissions, hours, method: z.enum(['directory', 'code', 'qr', 'invite', 'request']) }).merge(verification).parse(req.body);
    await verifyChallenge(ctx.db, p.challengeId, p.code, 'grant_access', ctx.user.id);
    const grant = await ctx.db.tx((q) => createGrant(q, ctx, p.doctorId, p.permissions, p.hours, p.method));
    await touchPatient(ctx.db, ctx.patient!.id);
    res.json(grant);
  }));

  r.patch('/grants/:id', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const p = z.object({ permissions, challengeId: z.string().optional(), code: z.string().optional() }).parse(req.body);
    const row = await ctx.db.one(`SELECT * FROM access_grants WHERE id = $1 AND patient_id = $2 AND status = 'active' AND expires_at > now()`, [req.params.id, ctx.patient!.id]);
    if (!row) throw new AppError('NOT_FOUND', 'This access is no longer active.');
    const g = toGrant(row);
    const widening = p.permissions.some((x) => !g.permissions.includes(x));
    if (widening) {
      if (!p.challengeId || !p.code) throw new AppError('VALIDATION', 'Sharing more requires verification.');
      await verifyChallenge(ctx.db, p.challengeId, p.code, 'change_permissions', ctx.user.id);
    }
    await ctx.db.tx(async (q) => {
      await q.query('UPDATE access_grants SET permissions = $2::jsonb WHERE id = $1', [g.id, json(p.permissions)]);
      const d = await q.one<{ full_name: string; user_id: string }>('SELECT full_name, user_id FROM doctors WHERE id = $1', [g.doctorId]);
      await audit(q, {
        patientId: g.patientId, actor: ctx.actor, action: 'access_changed', target: { type: 'doctor', id: g.doctorId, label: d!.full_name }, ip: ctx.ip,
        metadata: { added: p.permissions.filter((x) => !g.permissions.includes(x)).map(permissionLabel), removed: g.permissions.filter((x) => !p.permissions.includes(x)).map(permissionLabel) },
      });
      await notify(q, { userId: d!.user_id, kind: 'access', title: 'Permissions changed', body: `${ctx.patient!.fullName} changed what you can see.`, link: `/doctor/patients/${g.patientId}` });
    });
    await touchPatient(ctx.db, g.patientId);
    res.json({ ok: true });
  }));

  r.post('/grants/:id/revoke', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    await ctx.db.tx(async (q) => {
      const row = await q.one(`UPDATE access_grants SET status = 'revoked', revoked_at = now() WHERE id = $1 AND patient_id = $2 AND status = 'active' RETURNING *`, [req.params.id, ctx.patient!.id]);
      if (!row) throw new AppError('NOT_FOUND', 'This access has already ended.');
      const g = toGrant(row);
      const d = await q.one<{ full_name: string; user_id: string }>('SELECT full_name, user_id FROM doctors WHERE id = $1', [g.doctorId]);
      await audit(q, { patientId: g.patientId, actor: ctx.actor, action: 'access_revoked', target: { type: 'doctor', id: g.doctorId, label: d!.full_name }, ip: ctx.ip });
      await notify(q, { userId: ctx.user.id, kind: 'access', title: 'Access revoked', body: `${d!.full_name} can no longer see your records.`, link: '/app/access?tab=history' });
      await notify(q, { userId: d!.user_id, kind: 'access', title: 'Access revoked', body: `${ctx.patient!.fullName} ended your access to their records.` });
    });
    await touchPatient(ctx.db, ctx.patient!.id);
    res.json({ ok: true });
  }));

  r.post('/requests/:id/approve', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const p = z.object({ permissions, hours }).merge(verification).parse(req.body);
    await verifyChallenge(ctx.db, p.challengeId, p.code, 'approve_request', ctx.user.id);
    const grant = await ctx.db.tx(async (q) => {
      const row = await q.one(`UPDATE access_requests SET status = 'approved', responded_at = now() WHERE id = $1 AND patient_id = $2 AND status = 'pending' RETURNING *`, [req.params.id, ctx.patient!.id]);
      if (!row) throw new AppError('NOT_FOUND', 'This request has already been answered.');
      const rq = toRequest(row);
      const d = await q.one<{ full_name: string }>('SELECT full_name FROM doctors WHERE id = $1', [rq.doctorId]);
      await audit(q, { patientId: rq.patientId, actor: ctx.actor, action: 'request_approved', target: { type: 'request', id: rq.id, label: d!.full_name }, ip: ctx.ip });
      return createGrant(q, ctx, rq.doctorId, p.permissions, p.hours, 'request', rq.id);
    });
    await touchPatient(ctx.db, ctx.patient!.id);
    res.json(grant);
  }));

  r.post('/requests/:id/decline', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    await ctx.db.tx(async (q) => {
      const row = await q.one(`UPDATE access_requests SET status = 'declined', responded_at = now() WHERE id = $1 AND patient_id = $2 AND status = 'pending' RETURNING *`, [req.params.id, ctx.patient!.id]);
      if (!row) throw new AppError('NOT_FOUND', 'This request has already been answered.');
      const rq = toRequest(row);
      const d = await q.one<{ full_name: string; user_id: string }>('SELECT full_name, user_id FROM doctors WHERE id = $1', [rq.doctorId]);
      await audit(q, { patientId: rq.patientId, actor: ctx.actor, action: 'request_declined', target: { type: 'request', id: rq.id, label: d!.full_name }, ip: ctx.ip });
      await notify(q, { userId: d!.user_id, kind: 'request', title: 'Request declined', body: `${ctx.patient!.fullName} declined your access request.` });
    });
    await touchPatient(ctx.db, ctx.patient!.id);
    res.json({ ok: true });
  }));

  r.post('/invites', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const p = z.object({ doctorName: z.string().trim().min(1, 'Enter the doctor’s name').max(120), contact: z.string().trim().min(1, 'Enter an email or phone').max(200) }).parse(req.body);
    const id = uid('inv');
    const row = await ctx.db.tx(async (q) => {
      const r2 = await q.one(`INSERT INTO doctor_invites (id, patient_id, contact, doctor_name, created_at, status) VALUES ($1,$2,$3,$4,now(),'sent') RETURNING *`, [id, ctx.patient!.id, p.contact, p.doctorName]);
      await audit(q, { patientId: ctx.patient!.id, actor: ctx.actor, action: 'invite_sent', target: { type: 'invite', id, label: p.doctorName }, ip: ctx.ip });
      return r2!;
    });
    // Invitations don't share anything; they tell the doctor how to join.
    if (EMAIL_RE.test(p.contact)) {
      sendEmail(p.contact, `${ctx.patient!.fullName} invited you to Niveda`,
        `Hello ${p.doctorName},\n\n${ctx.patient!.fullName} uses Niveda to keep their lifelong health record and would like to share it with you.\nNiveda onboards clinicians after verifying their medical registration. Reply to this email or visit ${config.appUrl} to get started.\n\nThis invitation doesn’t give access to any records by itself.`,
      ).catch((e) => console.warn('Invite email failed', e));
    }
    await touchPatient(ctx.db, ctx.patient!.id);
    res.json(toInvite(row));
  }));

  r.delete('/invites/:id', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    await ctx.db.query(`UPDATE doctor_invites SET status = 'cancelled' WHERE id = $1 AND patient_id = $2`, [req.params.id, ctx.patient!.id]);
    await touchPatient(ctx.db, ctx.patient!.id);
    res.json({ ok: true });
  }));

  /* ---------------- Doctor ---------------- */

  r.get('/doctor', h(async (req, res) => {
    const ctx = ctxOf(req, 'doctor');
    const did = ctx.doctor!.id;
    await expireGrants(ctx.db, { doctorId: did });
    const rows = await ctx.db.query(
      `SELECT g.*, p.full_name, p.patient_code, p.date_of_birth, p.blood_group, p.sex FROM access_grants g JOIN patients p ON p.id = g.patient_id
       WHERE g.doctor_id = $1 ORDER BY g.granted_at DESC`, [did]);
    const toView = (x: Record<string, unknown>): DoctorGrantView => ({
      ...toGrant(x), patient: { id: x.patient_id as string, fullName: x.full_name as string, patientCode: x.patient_code as string, dateOfBirth: x.date_of_birth as string, bloodGroup: (x.blood_group as string) ?? undefined, sex: (x.sex as never) ?? undefined },
    });
    const active = rows.filter((x) => x.status === 'active').map(toView);
    const seen = new Set(active.map((g) => g.patientId));
    const past: DoctorGrantView[] = [];
    for (const x of rows.filter((y) => y.status !== 'active')) {
      if (seen.has(x.patient_id as string)) continue;
      seen.add(x.patient_id as string);
      past.push(toView(x));
    }
    const reqs = await ctx.db.query(`SELECT r.*, p.full_name, p.patient_code FROM access_requests r JOIN patients p ON p.id = r.patient_id WHERE r.doctor_id = $1 AND r.status = 'pending' ORDER BY r.created_at DESC`, [did]);
    res.json({ active, past, requests: reqs.map((x) => ({ ...toRequest(x), patientName: maskName(String(x.full_name)), patientCode: x.patient_code })) });
  }));

  /** Look up by the ID the patient shared. Without access, only a masked name is revealed. */
  r.get('/lookup/:code', h(async (req, res) => {
    const ctx = ctxOf(req, 'doctor');
    const code = req.params.code.trim().toUpperCase().replace(/[\s-]/g, '');
    const p = await ctx.db.one<{ id: string; full_name: string; patient_code: string }>(`SELECT id, full_name, patient_code FROM patients WHERE replace(patient_code, '-', '') = $1`, [code]);
    if (!p) throw new AppError('NOT_FOUND', 'No patient matches that ID. Check the ID or ask the patient to show their QR code.');
    await expireGrants(ctx.db, { doctorId: ctx.doctor!.id, patientId: p.id });
    const g = await activeGrant(ctx.db, ctx.doctor!.id, p.id);
    const pending = await ctx.db.one(`SELECT 1 FROM access_requests WHERE doctor_id = $1 AND patient_id = $2 AND status = 'pending'`, [ctx.doctor!.id, p.id]);
    res.json({ patientId: p.id, patientCode: p.patient_code, maskedName: g ? p.full_name : maskName(p.full_name), status: g ? 'active' : pending ? 'pending' : 'none' });
  }));

  r.post('/requests', h(async (req, res) => {
    const ctx = ctxOf(req, 'doctor');
    const p = z.object({ patientId: z.string(), permissions, hours, reason: z.string().trim().min(1, 'Tell the patient why you need access.').max(500) }).parse(req.body);
    const out = await ctx.db.tx(async (q) => {
      if (!(await q.one('SELECT 1 FROM patients WHERE id = $1', [p.patientId]))) throw new AppError('NOT_FOUND', 'Patient not found.');
      if (await q.one(`SELECT 1 FROM access_requests WHERE doctor_id = $1 AND patient_id = $2 AND status = 'pending'`, [ctx.doctor!.id, p.patientId])) throw new AppError('CONFLICT', 'You already have a pending request with this patient.');
      const row = await q.one(`INSERT INTO access_requests (id, patient_id, doctor_id, permissions, duration_hours, reason, created_at, status) VALUES ($1,$2,$3,$4::jsonb,$5,$6,now(),'pending') RETURNING *`,
        [uid('req'), p.patientId, ctx.doctor!.id, json(p.permissions), p.hours, p.reason]);
      const rq = toRequest(row!);
      await audit(q, { patientId: p.patientId, actor: ctx.actor, action: 'access_requested', target: { type: 'request', id: rq.id, label: `${p.permissions.map(permissionLabel).join(', ')} · ${durationLabel(p.hours)}` }, ip: ctx.ip });
      const pu = await patientUserId(q, p.patientId);
      if (pu) await notify(q, { userId: pu, kind: 'request', title: 'Access request', body: `${ctx.doctor!.fullName} (${ctx.actor.organization}) requested access to your ${p.permissions.map((k) => permissionLabel(k).toLowerCase()).join(', ')} for ${durationLabel(p.hours)}.`, link: '/app/access?tab=requests' });
      return rq;
    });
    await touchPatient(ctx.db, p.patientId);
    res.json(out);
  }));

  r.post('/requests/:id/cancel', h(async (req, res) => {
    const ctx = ctxOf(req, 'doctor');
    const row = await ctx.db.one(`UPDATE access_requests SET status = 'cancelled' WHERE id = $1 AND doctor_id = $2 AND status = 'pending' RETURNING patient_id`, [req.params.id, ctx.doctor!.id]);
    if (row) await touchPatient(ctx.db, String(row.patient_id));
    res.json({ ok: true });
  }));

  return r;
}

export { doctorUserId };
