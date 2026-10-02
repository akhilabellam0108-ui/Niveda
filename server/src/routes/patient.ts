import { Router } from 'express';
import { z } from 'zod';
import type { OnboardingPayload, EmergencyProfile, HealthSummary } from '@shared/api';
import { AppError, phoneOk, summarise, validateOnboarding } from '@shared/api';
import { isSevereAllergy } from '@shared/recordMeta';
import { todayISO } from '@shared/dates';
import type { MedicalRecord, RecordData } from '@shared/types';
import { json } from '../db/db';
import { toPatient } from '../db/mappers';
import { audit, ctxOf, h, recentlyLogged, requireGrant, touchPatient } from '../core';
import { buildRecord, ensureReminder, insertRecord, loadRecords, storeUploads, withUploads } from '../services/records';
import { payloadOf, upload, uploadsOf } from './uploads';

const contact = z.object({ name: z.string().trim().max(120), relationship: z.string().trim().max(60), phone: z.string().trim().max(30) });
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function patientRoutes() {
  const r = Router();

  r.get('/summary', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const pid = ctx.patient!.id;
    const records = await loadRecords(ctx.db, pid);
    const docs = await ctx.db.one<{ n: string }>('SELECT count(*) AS n FROM documents WHERE patient_id = $1', [pid]);
    const out: HealthSummary = {
      ...summarise(ctx.patient!, records),
      counts: {
        records: records.length,
        doctors: new Set(records.filter((x) => x.createdBy.role === 'doctor').map((x) => x.createdBy.id)).size,
        documents: Number(docs?.n ?? 0),
        years: new Set(records.map((x) => x.date.slice(0, 4))).size,
      },
    };
    res.json(out);
  }));

  r.patch('/profile', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const p = z.object({
      fullName: z.string().trim().min(1, 'Name can’t be empty.').max(120).optional(),
      phone: z.string().trim().max(30).optional(),
      email: z.string().trim().email().max(200).optional(),
      dateOfBirth: dateStr.optional(),
      bloodGroup: z.string().max(5).nullable().optional(),
      sex: z.enum(['female', 'male', 'other', '']).optional(),
      photoDataUrl: z.string().max(400_000).regex(/^data:image\/(jpeg|png|webp);base64,/, 'Use a JPEG, PNG or WebP image').optional(),
      emergencyContact: contact.nullable().optional(),
      importantNotes: z.string().max(1000).nullable().optional(),
      emergencyCardEnabled: z.boolean().optional(),
    }).parse(req.body);
    if ('emergencyContact' in p) {
      const c = p.emergencyContact;
      if (!c?.name || !c.relationship || !c.phone) throw new AppError('VALIDATION', 'An emergency contact with name, relationship and phone is required.');
      if (!phoneOk(c.phone)) throw new AppError('VALIDATION', 'Enter a valid phone number for your emergency contact.');
    }
    const cols: Record<string, [string, unknown]> = {
      fullName: ['full_name', p.fullName], phone: ['phone', p.phone], email: ['email', p.email?.toLowerCase()], dateOfBirth: ['date_of_birth', p.dateOfBirth],
      bloodGroup: ['blood_group', p.bloodGroup || null], sex: ['sex', p.sex || null], photoDataUrl: ['photo_data_url', p.photoDataUrl],
      emergencyContact: ['emergency_contact', json(p.emergencyContact)], importantNotes: ['important_notes', p.importantNotes || null], emergencyCardEnabled: ['emergency_card_enabled', p.emergencyCardEnabled],
    };
    await ctx.db.tx(async (q) => {
      for (const [k, [col, val]] of Object.entries(cols)) {
        if (!(k in p)) continue;
        await q.query(`UPDATE patients SET ${col} = $2${col === 'emergency_contact' ? '::jsonb' : ''} WHERE id = $1`, [ctx.patient!.id, val]);
      }
      if (p.email) {
        if (await q.one('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [p.email.toLowerCase(), ctx.user.id])) throw new AppError('CONFLICT', 'That email is already used by another account.');
        await q.query('UPDATE users SET email = $2 WHERE id = $1', [ctx.user.id, p.email.toLowerCase()]);
      }
      if (p.phone) await q.query('UPDATE users SET phone = $2, phone_digits = $3 WHERE id = $1', [ctx.user.id, p.phone, p.phone.replace(/\D/g, '').slice(-10)]);
    });
    await touchPatient(ctx.db, ctx.patient!.id);
    res.json(toPatient((await ctx.db.one('SELECT * FROM patients WHERE id = $1', [ctx.patient!.id]))!));
  }));

  /** Compulsory setup. Answers become records; files are encrypted and linked; all in one transaction. */
  r.post('/onboarding', upload.array('files'), h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const p = payloadOf<OnboardingPayload>(req);
    const problem = validateOnboarding(p);
    if (problem) throw new AppError('VALIDATION', problem);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length !== p.documents.length) throw new AppError('VALIDATION', 'Every listed document needs its file.');
    const uploads = uploadsOf(req, p.documents.map((d) => ({ name: d.name, category: d.category, date: d.date })));
    const today = todayISO();
    const pid = ctx.patient!.id;
    await withUploads(ctx.db, async (q, written) => {
      const ids: Record<string, string> = {};
      const add = async (key: string, type: MedicalRecord['type'], data: RecordData, date = today, times?: string[]) => {
        const rec = buildRecord(ctx, pid, type, date, data);
        await insertRecord(q, rec);
        await ensureReminder(q, rec, times);
        await audit(q, { patientId: pid, actor: ctx.actor, action: 'record_added', target: { type, id: rec.id, label: key }, metadata: { recordDate: date }, ip: ctx.ip });
        ids[key] = rec.id;
      };
      for (const [i, a] of p.allergies.entries()) await add(`allergy:${i}`, 'allergy', { ...a, notes: 'Added during account setup' });
      for (const [i, c] of p.conditions.entries()) await add(`condition:${i}`, 'diagnosis', { condition: c.condition, status: 'Active', notes: 'Added during account setup' }, c.since || today);
      for (const [i, m] of p.medications.entries()) await add(`medication:${i}`, 'medication', { name: m.name, dosage: m.dosage, frequency: m.frequency }, today, m.times);
      for (const [i, x] of p.history.entries()) {
        if (x.kind === 'surgery') await add(`history:${i}`, 'surgery', { procedure: x.name, facility: x.hospital }, x.date);
        else await add(`history:${i}`, 'hospitalization', { reason: x.name, facility: x.hospital }, x.date);
      }
      for (const [i, u] of uploads.entries()) {
        const link = p.documents[i].linkTo;
        await storeUploads(q, ctx, pid, [u], p.documents[i].date, link ? ids[link] : undefined, written);
      }
      await q.query(
        `UPDATE patients SET blood_group = $2, emergency_contact = $3::jsonb, emergency_card_enabled = true, important_notes = COALESCE($4, important_notes), declarations = $5::jsonb WHERE id = $1`,
        [pid, p.bloodGroup === 'Unknown' ? null : p.bloodGroup, json({ name: p.emergencyContact.name.trim(), relationship: p.emergencyContact.relationship.trim(), phone: p.emergencyContact.phone.trim() }),
          p.importantNotes?.trim() || null,
          json({ noAllergies: p.noAllergies || undefined, noConditions: p.noConditions || undefined, noMedications: p.noMedications || undefined, noSurgeries: p.noHistory || undefined, noDocuments: p.noDocuments || undefined, confirmedAt: new Date().toISOString() })],
      );
      if (p.photoDataUrl) await q.query('UPDATE patients SET photo_data_url = $2 WHERE id = $1', [pid, p.photoDataUrl]);
      await q.query('UPDATE users SET onboarded = true WHERE id = $1', [ctx.user.id]);
    });
    await touchPatient(ctx.db, pid);
    res.json({ ok: true });
  }));

  /** Emergency card. Patients see their own; doctors need an active grant. */
  r.get('/emergency', h(async (req, res) => {
    const ctx = ctxOf(req);
    const pid = ctx.patient?.id ?? String(req.query.patientId ?? '');
    if (ctx.doctor) await requireGrant(ctx.db, ctx.doctor.id, pid);
    const row = await ctx.db.one('SELECT * FROM patients WHERE id = $1', [pid]);
    if (!row) throw new AppError('NOT_FOUND', 'Patient not found.');
    const patient = toPatient(row);
    const s = summarise(patient, await loadRecords(ctx.db, pid));
    const warnings: string[] = [];
    for (const a of s.allergies.filter(isSevereAllergy)) warnings.push(`${String(a.data.severity).toUpperCase()} ALLERGY: ${a.data.allergen} — ${a.data.reaction}`);
    if (patient.importantNotes) warnings.push(patient.importantNotes);
    if (ctx.doctor && !(await recentlyLogged(ctx.db, ctx.actor.id, 'emergency_viewed', undefined, pid))) {
      await audit(ctx.db, { patientId: pid, actor: ctx.actor, action: 'emergency_viewed', target: { type: 'emergency', label: 'Emergency profile' }, ip: ctx.ip });
    }
    const out: EmergencyProfile = { ...s, warnings };
    res.json(out);
  }));

  return r;
}

