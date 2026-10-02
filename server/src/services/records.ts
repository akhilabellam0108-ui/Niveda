/**
 * Medical records on the server. Every read is filtered by the caller's access; every
 * write checks the grant, keeps immutable attribution, versions corrections, links
 * attachments, sets medicine reminders, audits and notifies.
 */
import type { Actor, ChangeType, DocumentCategory, MedicalRecord, PermissionKey, RecordData, RecordType } from '@shared/types';
import type { ConsultationPayload, FileMeta, PrescriptionInput } from '@shared/api';
import { AppError, fileProblem } from '@shared/api';
import { RECORD_TYPES, cleanData, recordTitle, validateData, INTERNAL_KEYS } from '@shared/recordMeta';
import { addDays, fmtDate, toISODate, todayISO } from '@shared/dates';
import { defaultTimes, normaliseTimes } from '@shared/reminders';
import type { Db } from '../db/db';
import { json } from '../db/db';
import { toRecord, toVersion } from '../db/mappers';
import { uid } from '../lib/ids';
import { audit, notify, patientUserId, requireGrant, touchPatient, type Ctx } from '../core';
import { putFile, removeFile } from './storage';

export interface Upload {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  meta: FileMeta;
}

/* ---------------- Loading ---------------- */

export async function loadRecords(db: Db, patientId: string, ids?: string[]): Promise<MedicalRecord[]> {
  const rows = ids
    ? await db.query('SELECT * FROM records WHERE patient_id = $1 AND id = ANY($2::text[])', [patientId, ids])
    : await db.query('SELECT * FROM records WHERE patient_id = $1', [patientId]);
  if (!rows.length) return [];
  const recIds = rows.map((r) => r.id as string);
  const versions = await db.query('SELECT * FROM record_versions WHERE record_id = ANY($1::text[]) ORDER BY version', [recIds]);
  const docs = await db.query<{ id: string; record_id: string }>('SELECT id, record_id FROM documents WHERE record_id = ANY($1::text[]) ORDER BY uploaded_at', [recIds]);
  return rows
    .map((r) => toRecord(r, versions.filter((v) => v.record_id === r.id).map(toVersion), docs.filter((d) => d.record_id === r.id).map((d) => d.id)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/** All of the patient's own records, or the permitted subset for a doctor. */
export async function visibleRecords(ctx: Ctx, patientId: string): Promise<MedicalRecord[]> {
  if (ctx.patient) {
    if (ctx.patient.id !== patientId) throw new AppError('ACCESS_DENIED', 'You can only view your own record.');
    return loadRecords(ctx.db, patientId);
  }
  const grant = await requireGrant(ctx.db, ctx.doctor!.id, patientId);
  return (await loadRecords(ctx.db, patientId)).filter((r) => grant.permissions.includes(RECORD_TYPES[r.type].permission));
}

export async function assertCanWrite(ctx: Ctx, patientId: string, type: RecordType) {
  const meta = RECORD_TYPES[type];
  if (!meta) throw new AppError('VALIDATION', 'Unknown record type.');
  if (ctx.patient) {
    if (ctx.patient.id !== patientId) throw new AppError('ACCESS_DENIED', 'You can only add to your own record.');
    if (!meta.patientCanAdd) throw new AppError('VALIDATION', `${meta.label} entries are added by your doctor.`);
    return;
  }
  if (!meta.doctorCanAdd) throw new AppError('VALIDATION', `${meta.label} entries can only be added by the patient.`);
  await requireGrant(ctx.db, ctx.doctor!.id, patientId, meta.permission);
}

/* ---------------- Building & saving ---------------- */

export function buildRecord(ctx: Ctx, patientId: string, type: RecordType, date: string, data: RecordData, parentId?: string): MedicalRecord {
  if (!RECORD_TYPES[type]) throw new AppError('VALIDATION', 'Unknown record type.');
  const clean = cleanData(type, data);
  const errors = validateData(type, clean);
  if (Object.keys(errors).length) throw new AppError('VALIDATION', Object.values(errors)[0]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('VALIDATION', 'Date is required.');
  if (date > toISODate(addDays(new Date(), 366))) throw new AppError('VALIDATION', 'That date is too far in the future.');
  const t = new Date().toISOString();
  const org = ctx.doctor ? { id: ctx.doctor.hospitalId, name: ctx.actor.organization ?? '' } : undefined;
  return {
    id: uid('rec'), patientId, type, date, data: clean, createdAt: t, updatedAt: t, createdBy: ctx.actor, organization: org,
    attachments: [], parentId, source: ctx.doctor ? 'doctor' : 'patient', version: 1,
    versions: [{ version: 1, date, data: clean, changedAt: t, changedBy: ctx.actor, changeType: 'created' }],
  };
}

export async function insertRecord(q: Db, r: MedicalRecord) {
  await q.query(
    `INSERT INTO records (id, patient_id, type, date, data, created_at, updated_at, created_by, organization, parent_id, source, version)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
    [r.id, r.patientId, r.type, r.date, json(r.data), r.createdAt, r.updatedAt, json(r.createdBy), json(r.organization), r.parentId ?? null, r.source, r.version],
  );
  for (const v of r.versions) {
    await q.query('INSERT INTO record_versions (record_id, version, date, data, changed_at, changed_by, change_type, reason) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8)',
      [r.id, v.version, v.date, json(v.data), v.changedAt, json(v.changedBy), v.changeType, v.reason ?? null]);
  }
}

export async function pushVersion(q: Db, rec: MedicalRecord, actor: Actor, changeType: ChangeType, data: RecordData, date: string, reason?: string) {
  const t = new Date().toISOString();
  const version = rec.version + 1;
  await q.query('INSERT INTO record_versions (record_id, version, date, data, changed_at, changed_by, change_type, reason) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8)',
    [rec.id, version, date, json(data), t, json(actor), changeType, reason ?? null]);
  // Optimistic concurrency: only succeeds if nobody else changed the record meanwhile.
  const updated = await q.query('UPDATE records SET data = $2::jsonb, date = $3, version = $4, updated_at = $5 WHERE id = $1 AND version = $6 RETURNING id', [rec.id, json(data), date, version, t, rec.version]);
  if (!updated.length) throw new AppError('CONFLICT', 'This entry was changed by someone else. Reload and try again.');
}

/** Creates a default reminder for a new medication. */
export async function ensureReminder(q: Db, r: MedicalRecord, times?: string[]) {
  if (r.type !== 'medication') return;
  const t = normaliseTimes(times ?? defaultTimes(String(r.data.frequency)));
  await q.query('INSERT INTO medication_reminders (record_id, patient_id, times, enabled, updated_at) VALUES ($1,$2,$3::jsonb,$4,now()) ON CONFLICT (record_id) DO NOTHING',
    [r.id, r.patientId, json(t), t.length > 0]);
}

/** Encrypts and stores uploaded files, returning document ids. Cleans up files if anything fails later (see withUploads). */
export async function storeUploads(q: Db, ctx: Ctx, patientId: string, uploads: Upload[], fallbackDate: string, recordId: string | undefined, written: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const u of uploads) {
    const problem = fileProblem({ name: u.originalname, type: u.mimetype, size: u.buffer.length });
    if (problem) throw new AppError('VALIDATION', problem);
    const id = uid('doc');
    const key = uid('f').replace('f_', '');
    const { sha256 } = await putFile(key, u.buffer);
    written.push(key);
    const category: DocumentCategory = u.meta.category;
    await q.query(
      `INSERT INTO documents (id, patient_id, record_id, name, mime_type, size, category, date, uploaded_by, uploaded_at, storage_key, sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now(),$10,$11)`,
      [id, patientId, recordId ?? null, (u.meta.name || u.originalname).slice(0, 200), u.mimetype || 'application/octet-stream', u.buffer.length, category, u.meta.date || fallbackDate, json(ctx.actor), key, sha256],
    );
    await audit(q, { patientId, actor: ctx.actor, action: 'document_uploaded', target: { type: 'document', id, label: u.meta.name || u.originalname }, ip: ctx.ip });
    ids.push(id);
  }
  return ids;
}

/** Runs a transaction that may write files; deletes the files again if the transaction fails. */
export async function withUploads<T>(db: Db, fn: (q: Db, written: string[]) => Promise<T>): Promise<T> {
  const written: string[] = [];
  try {
    return await db.tx((q) => fn(q, written));
  } catch (e) {
    await Promise.all(written.map((k) => removeFile(k)));
    throw e;
  }
}

async function logAndNotifyAdd(q: Db, ctx: Ctx, records: MedicalRecord[], headline?: string) {
  for (const r of records) {
    await audit(q, {
      patientId: r.patientId, actor: ctx.actor, action: 'record_added', ip: ctx.ip,
      target: { type: r.type, id: r.id, label: `${RECORD_TYPES[r.type].label}: ${recordTitle(r)}` },
      metadata: { recordDate: r.date },
    });
  }
  if (ctx.doctor && records.length) {
    const main = records[0];
    const pu = await patientUserId(q, main.patientId);
    const label = RECORD_TYPES[main.type].label.toLowerCase();
    if (pu) await notify(q, { userId: pu, kind: 'record', title: 'New entry in your record', body: headline ?? `${ctx.actor.name} added ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label} to your medical record.`, link: `/app/timeline?record=${main.id}` });
  }
}

/* ---------------- Operations ---------------- */

export async function createRecord(ctx: Ctx, input: { patientId?: string; type: RecordType; date: string; data: RecordData; parentId?: string; reminderTimes?: string[] }, uploads: Upload[] = []): Promise<MedicalRecord> {
  const pid = ctx.patient?.id ?? input.patientId;
  if (!pid) throw new AppError('VALIDATION', 'Choose a patient.');
  await assertCanWrite(ctx, pid, input.type);
  if (input.parentId && !(await ctx.db.one('SELECT 1 FROM records WHERE id = $1 AND patient_id = $2', [input.parentId, pid]))) throw new AppError('NOT_FOUND', 'The linked entry wasn’t found.');
  const record = buildRecord(ctx, pid, input.type, input.date, input.data, input.parentId);
  await withUploads(ctx.db, async (q, written) => {
    await insertRecord(q, record);
    record.attachments = await storeUploads(q, ctx, pid, uploads, input.date, record.id, written);
    await ensureReminder(q, record, input.reminderTimes);
    await logAndNotifyAdd(q, ctx, [record]);
  });
  await touchPatient(ctx.db, pid);
  return record;
}

/**
 * The doctor's "Add to medical record": a visit becomes a consultation plus linked diagnosis,
 * prescriptions (with reminders), lab orders, a follow-up and attachments — in one transaction.
 */
export async function addConsultation(ctx: Ctx, input: ConsultationPayload, uploads: Upload[] = []) {
  if (!ctx.doctor) throw new AppError('ACCESS_DENIED', 'Only doctors can add consultations this way.');
  const pid = input.patientId;
  await assertCanWrite(ctx, pid, 'consultation');
  if (input.diagnosis?.condition?.trim()) await assertCanWrite(ctx, pid, 'diagnosis');
  if (input.prescriptions.length) await assertCanWrite(ctx, pid, 'medication');
  if (input.labOrders.length) await assertCanWrite(ctx, pid, 'lab_test');

  const doctorName = ctx.actor.name;
  const facility = ctx.actor.organization;
  const rx = (p: PrescriptionInput) => `${p.name} ${p.dosage}, ${p.frequency.toLowerCase()}`;
  const consultation = buildRecord(ctx, pid, 'consultation', input.date, {
    reason: input.reason, doctor: doctorName, facility, symptoms: input.symptoms, diagnosis: input.diagnosis?.condition,
    medications: input.prescriptions.map(rx).join('\n') || undefined, followUp: input.followUp, notes: input.notes,
  });
  const created: MedicalRecord[] = [consultation];
  if (input.diagnosis?.condition?.trim()) created.push(buildRecord(ctx, pid, 'diagnosis', input.date, { ...input.diagnosis, doctor: doctorName, facility }, consultation.id));
  for (const p of input.prescriptions) {
    const start = p.startDate || input.date;
    const end = p.endDate || (p.durationDays ? toISODate(addDays(new Date(`${start}T00:00:00`), p.durationDays)) : undefined);
    created.push(buildRecord(ctx, pid, 'medication', start, {
      name: p.name, dosage: p.dosage, frequency: p.frequency, endDate: end, prescriber: doctorName,
      reason: p.reason || input.diagnosis?.condition || input.reason, instructions: p.instructions,
    }, consultation.id));
  }
  for (const l of input.labOrders) created.push(buildRecord(ctx, pid, 'lab_test', input.date, { test: l.test, status: 'Ordered', laboratory: l.laboratory, orderedBy: doctorName, reason: l.reason || input.reason }, consultation.id));
  if (input.followUp) {
    if (input.followUp < input.date) throw new AppError('VALIDATION', 'Follow-up must be after the visit.');
    created.push(buildRecord(ctx, pid, 'follow_up', input.followUp, { purpose: `Review: ${input.diagnosis?.condition || input.reason}`, doctor: doctorName, facility }, consultation.id));
  }

  await withUploads(ctx.db, async (q, written) => {
    for (const r of created) await insertRecord(q, r);
    consultation.attachments = await storeUploads(q, ctx, pid, uploads, input.date, consultation.id, written);
    for (const r of created) await ensureReminder(q, r);
    const parts = [
      'a consultation',
      created.some((r) => r.type === 'diagnosis') && 'a diagnosis',
      input.prescriptions.length && `${input.prescriptions.length} prescription${input.prescriptions.length > 1 ? 's' : ''}`,
      input.labOrders.length && `${input.labOrders.length} lab order${input.labOrders.length > 1 ? 's' : ''}`,
      uploads.length && `${uploads.length} attachment${uploads.length > 1 ? 's' : ''}`,
    ].filter(Boolean) as string[];
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    await logAndNotifyAdd(q, ctx, created, `${doctorName} added ${list} to your medical record.${input.prescriptions.length ? ' Reminders are set for the new medicines — you can change the times in Medications.' : ''}`);
  });
  await touchPatient(ctx.db, pid);
  return { consultation, created };
}

async function loadOne(ctx: Ctx, id: string): Promise<MedicalRecord> {
  const row = await ctx.db.one<{ patient_id: string }>('SELECT patient_id FROM records WHERE id = $1', [id]);
  if (!row) throw new AppError('NOT_FOUND', 'This record could not be found.');
  const [rec] = await loadRecords(ctx.db, row.patient_id, [id]);
  return rec;
}

/** Corrections never overwrite history: a new version records who, when and why. Attribution never changes. */
export async function amendRecord(ctx: Ctx, id: string, change: { date: string; data: RecordData; reason: string }) {
  if (!change.reason?.trim()) throw new AppError('VALIDATION', 'Give a reason for the correction.');
  const r = await loadOne(ctx, id);
  if (ctx.patient) {
    if (r.patientId !== ctx.patient.id) throw new AppError('ACCESS_DENIED', 'You can only change your own record.');
    if (r.createdBy.role === 'doctor') throw new AppError('ACCESS_DENIED', 'Entries added by a doctor can only be corrected by a doctor. You can add a note as a new record.');
  } else {
    await requireGrant(ctx.db, ctx.doctor!.id, r.patientId, RECORD_TYPES[r.type].permission);
  }
  const internal = Object.fromEntries(Object.entries(r.data).filter(([k]) => INTERNAL_KEYS.has(k)));
  const next = cleanData(r.type, { ...change.data, ...internal });
  const errors = validateData(r.type, next);
  if (Object.keys(errors).length) throw new AppError('VALIDATION', Object.values(errors)[0]);
  const changed = Object.keys({ ...r.data, ...next }).filter((k) => String(r.data[k] ?? '') !== String(next[k] ?? ''));
  if (!changed.length && change.date === r.date) throw new AppError('VALIDATION', 'Nothing has changed.');
  await ctx.db.tx(async (q) => {
    await pushVersion(q, r, ctx.actor, 'amended', next, change.date, change.reason.trim());
    await audit(q, {
      patientId: r.patientId, actor: ctx.actor, action: 'record_amended', ip: ctx.ip,
      target: { type: r.type, id: r.id, label: `${RECORD_TYPES[r.type].label}: ${recordTitle({ type: r.type, data: next })}` },
      metadata: { reason: change.reason.trim(), fields: changed.concat(change.date !== r.date ? ['date'] : []), version: r.version + 1 },
    });
    if (ctx.doctor) {
      const pu = await patientUserId(q, r.patientId);
      if (pu) await notify(q, { userId: pu, kind: 'record', title: 'Record corrected', body: `${ctx.actor.name} amended “${recordTitle({ type: r.type, data: next })}”. The original is kept in its history.`, link: `/app/timeline?record=${r.id}` });
    }
  });
  await touchPatient(ctx.db, r.patientId);
  return loadOne(ctx, id);
}

export async function discontinueMedication(ctx: Ctx, id: string, reason: string, date = todayISO()) {
  const r = await loadOne(ctx, id);
  if (r.type !== 'medication') throw new AppError('NOT_FOUND', 'Medication not found.');
  if (ctx.patient && r.patientId !== ctx.patient.id) throw new AppError('ACCESS_DENIED', 'You can only change your own record.');
  if (ctx.doctor) await requireGrant(ctx.db, ctx.doctor.id, r.patientId, 'medications');
  if (r.data.medStatus === 'discontinued') throw new AppError('VALIDATION', 'This medication is already stopped.');
  await ctx.db.tx(async (q) => {
    await pushVersion(q, r, ctx.actor, 'discontinued', { ...r.data, medStatus: 'discontinued', discontinuedOn: date, discontinueReason: reason.trim() || undefined }, r.date, reason.trim() || 'Stopped');
    await audit(q, { patientId: r.patientId, actor: ctx.actor, action: 'medication_discontinued', target: { type: 'medication', id: r.id, label: recordTitle(r) }, metadata: { reason: reason.trim() || '—', date: fmtDate(date) }, ip: ctx.ip });
    if (ctx.doctor) {
      const pu = await patientUserId(q, r.patientId);
      if (pu) await notify(q, { userId: pu, kind: 'record', title: 'Medication stopped', body: `${ctx.actor.name} stopped ${recordTitle(r)}.`, link: '/app/medications' });
    }
  });
  await touchPatient(ctx.db, r.patientId);
}

export async function addLabResult(ctx: Ctx, orderId: string, data: RecordData, date: string, uploads: Upload[] = []) {
  const order = await loadOne(ctx, orderId);
  if (order.type !== 'lab_test') throw new AppError('NOT_FOUND', 'Lab order not found.');
  await assertCanWrite(ctx, order.patientId, 'lab_result');
  const result = buildRecord(ctx, order.patientId, 'lab_result', date, { laboratory: order.data.laboratory, ...data, test: data.test || order.data.test }, orderId);
  await withUploads(ctx.db, async (q, written) => {
    await insertRecord(q, result);
    result.attachments = await storeUploads(q, ctx, order.patientId, uploads, date, result.id, written);
    await pushVersion(q, order, ctx.actor, 'result_added', { ...order.data, status: 'Completed', resultRecordId: result.id }, order.date, 'Result added');
    await logAndNotifyAdd(q, ctx, [result], `${ctx.actor.name} added your ${recordTitle(result)} result.`);
  });
  await touchPatient(ctx.db, order.patientId);
  return result;
}

export async function getRecord(ctx: Ctx, id: string) {
  const row = await ctx.db.one<{ patient_id: string }>('SELECT patient_id FROM records WHERE id = $1', [id]);
  if (!row) throw new AppError('NOT_FOUND', 'This record could not be found.');
  const visible = await visibleRecords(ctx, row.patient_id);
  const record = visible.find((r) => r.id === id);
  if (!record) throw new AppError('ACCESS_DENIED', 'The patient hasn’t shared this part of their record with you.');
  return {
    record,
    children: visible.filter((x) => x.parentId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    parent: record.parentId ? visible.find((x) => x.id === record.parentId) : undefined,
  };
}

export const typesDoctorCanWrite = (permissions: PermissionKey[]): RecordType[] =>
  (Object.keys(RECORD_TYPES) as RecordType[]).filter((t) => RECORD_TYPES[t].doctorCanAdd && permissions.includes(RECORD_TYPES[t].permission));
