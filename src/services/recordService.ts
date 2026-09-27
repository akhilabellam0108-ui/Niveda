import type { Actor, ChangeType, Database, MedicalRecord, PermissionKey, RecordData, RecordType } from '../types';
import { delay, getDb, mutate, mutateQuiet } from '../mock/db';
import { now, nowISO, todayISO, toISODate, addDays, fmtDate } from '../lib/dates';
import { uid } from '../lib/ids';
import { RECORD_TYPES, cleanData, recordTitle, validateData } from '../lib/recordMeta';
import { AppError, audit, notify, patientUserId, recentlyLogged, requireCtx, requireGrant, type Ctx } from './core';
import { storeFile, type NewFile } from './documentService';
import { ensureReminder } from './medicationService';

export interface NewRecordInput {
  patientId?: string; // doctors must pass it; patients default to themselves
  type: RecordType;
  date: string;
  data: RecordData;
  parentId?: string;
  files?: NewFile[];
  attachDocumentIds?: string[];
  /** For medications: reminder times ("HH:MM"). Defaults from the frequency. */
  reminderTimes?: string[];
}

export interface PrescriptionInput {
  name: string;
  dosage: string;
  frequency: string;
  durationDays?: number;
  startDate: string;
  endDate?: string;
  instructions?: string;
  reason?: string;
}

export interface ConsultationBundleInput {
  patientId: string;
  date: string;
  reason: string;
  symptoms?: string;
  notes?: string;
  followUp?: string;
  diagnosis?: { condition: string; status: string; severity?: string; notes?: string };
  prescriptions: PrescriptionInput[];
  labOrders: { test: string; laboratory?: string; reason?: string }[];
  files: NewFile[];
}

export interface ConsultationBundleResult {
  consultation: MedicalRecord;
  created: MedicalRecord[];
}

/* ---------- Visibility ---------- */

/** Records a context may see: all of the patient's own, or the permitted subset for a doctor. */
function visibleRecords(ctx: Ctx, patientId: string): MedicalRecord[] {
  const all = ctx.db.records.filter((r) => r.patientId === patientId);
  if (ctx.user.role === 'patient') {
    if (ctx.patient!.id !== patientId) throw new AppError('ACCESS_DENIED', 'You can only view your own record.');
    return all;
  }
  const grant = requireGrant(ctx.db, ctx.doctor!.id, patientId);
  return all.filter((r) => grant.permissions.includes(RECORD_TYPES[r.type].permission));
}

function assertCanWrite(ctx: Ctx, patientId: string, type: RecordType) {
  const meta = RECORD_TYPES[type];
  if (ctx.user.role === 'patient') {
    if (ctx.patient!.id !== patientId) throw new AppError('ACCESS_DENIED', 'You can only add to your own record.');
    if (!meta.patientCanAdd) throw new AppError('VALIDATION', `${meta.label} entries are added by your doctor.`);
    return;
  }
  if (!meta.doctorCanAdd) throw new AppError('VALIDATION', `${meta.label} entries can only be added by the patient.`);
  requireGrant(ctx.db, ctx.doctor!.id, patientId, meta.permission);
}

export const isMedicationActive = (r: MedicalRecord, today = todayISO()) =>
  r.type === 'medication' && r.data.medStatus !== 'discontinued' && (!r.data.endDate || String(r.data.endDate) >= today);

/* ---------- Creation (shared by patient and doctor) ---------- */

function buildRecord(ctx: Ctx, patientId: string, type: RecordType, date: string, data: RecordData, parentId?: string): MedicalRecord {
  const clean = cleanData(type, data);
  const errors = validateData(type, clean);
  if (Object.keys(errors).length) throw new AppError('VALIDATION', Object.values(errors)[0]);
  if (!date) throw new AppError('VALIDATION', 'Date is required.');
  if (date > toISODate(addDays(now(), 366))) throw new AppError('VALIDATION', 'That date is too far in the future.');
  const t = nowISO();
  const org = ctx.doctor ? ctx.db.hospitals.find((h) => h.id === ctx.doctor!.hospitalId) : undefined;
  return {
    id: uid('rec'), patientId, type, date, data: clean, createdAt: t, updatedAt: t,
    createdBy: ctx.actor, organization: org ? { id: org.id, name: org.name } : undefined,
    attachments: [], parentId, source: ctx.user.role === 'doctor' ? 'doctor' : 'patient', version: 1,
    versions: [{ version: 1, date, data: clean, changedAt: t, changedBy: ctx.actor, changeType: 'created' }],
  };
}

function linkDocs(db: Database, record: MedicalRecord, ids: string[]) {
  for (const id of ids) {
    const d = db.documents.find((x) => x.id === id && x.patientId === record.patientId);
    if (!d) continue;
    d.recordId = record.id;
    if (!record.attachments.includes(id)) record.attachments.push(id);
  }
}

function logAndNotifyAdd(db: Database, ctx: Ctx, records: MedicalRecord[], headline?: string) {
  for (const r of records) {
    audit(db, {
      patientId: r.patientId, actor: ctx.actor, action: 'record_added',
      target: { type: r.type, id: r.id, label: `${RECORD_TYPES[r.type].label}: ${recordTitle(r)}` },
      metadata: { recordDate: r.date, ...(r.attachments.length ? { attachments: r.attachments.length } : {}) },
    });
  }
  if (ctx.user.role === 'doctor') {
    const pu = patientUserId(db, records[0].patientId);
    const main = records[0];
    if (pu) notify(db, {
      userId: pu, kind: 'record', title: 'New entry in your record',
      body: headline ?? `${ctx.actor.name} added ${aOrAn(RECORD_TYPES[main.type].label.toLowerCase())} to your medical record.`,
      link: `/app/timeline?record=${main.id}`,
    });
  }
}

const aOrAn = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);

export const recordService = {
  async list(patientId?: string): Promise<MedicalRecord[]> {
    await delay();
    const ctx = await requireCtx();
    const pid = patientId ?? ctx.patient?.id;
    if (!pid) throw new AppError('VALIDATION', 'Choose a patient.');
    return visibleRecords(ctx, pid).slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  },

  async get(recordId: string): Promise<{ record: MedicalRecord; children: MedicalRecord[]; parent?: MedicalRecord }> {
    await delay(150);
    const ctx = await requireCtx();
    const r = ctx.db.records.find((x) => x.id === recordId);
    if (!r) throw new AppError('NOT_FOUND', 'This record could not be found.');
    const visible = visibleRecords(ctx, r.patientId);
    if (!visible.some((x) => x.id === r.id)) throw new AppError('ACCESS_DENIED', 'The patient hasn’t shared this part of their record with you.');
    // Views are logged without triggering a UI refresh (a refresh would re-read and re-log).
    if (ctx.doctor && !recentlyLogged(ctx.db, ctx.actor.id, 'viewed_record', r.id, r.patientId)) {
      await mutateQuiet((db) => audit(db, { patientId: r.patientId, actor: ctx.actor, action: 'viewed_record', target: { type: r.type, id: r.id, label: `${RECORD_TYPES[r.type].label}: ${recordTitle(r)}` } }));
    }
    return {
      record: r,
      children: visible.filter((x) => x.parentId === r.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      parent: r.parentId ? visible.find((x) => x.id === r.parentId) : undefined,
    };
  },

  /** Doctors opening a patient's history is logged (at most every 30 minutes per patient). */
  async logHistoryView(patientId: string): Promise<void> {
    const ctx = await requireCtx('doctor');
    requireGrant(ctx.db, ctx.doctor!.id, patientId);
    if (recentlyLogged(ctx.db, ctx.actor.id, 'viewed_history', undefined, patientId, 30)) return;
    await mutateQuiet((db) => audit(db, { patientId, actor: ctx.actor, action: 'viewed_history', target: { type: 'record', label: 'Medical history' } }));
  },

  async create(input: NewRecordInput): Promise<MedicalRecord> {
    await delay();
    const ctx = await requireCtx();
    const pid = input.patientId ?? ctx.patient?.id;
    if (!pid) throw new AppError('VALIDATION', 'Choose a patient.');
    assertCanWrite(ctx, pid, input.type);
    const data = { ...input.data };
    const record = buildRecord(ctx, pid, input.type, input.date, data, input.parentId);
    const docIds: string[] = [...(input.attachDocumentIds ?? [])];
    for (const f of input.files ?? []) docIds.push(await storeFile(ctx, pid, f, input.date));
    return mutate((db) => {
      db.records.push(record);
      linkDocs(db, record, docIds);
      ensureReminder(db, record, input.reminderTimes);
      logAndNotifyAdd(db, ctx, [record]);
      return record;
    });
  },

  /**
   * The doctor's "Add to medical record" action. One visit becomes a consultation
   * plus linked diagnosis, prescriptions (which appear in the medication list),
   * lab orders and attachments — all inside the patient's existing record.
   */
  async addConsultation(input: ConsultationBundleInput): Promise<ConsultationBundleResult> {
    await delay(400);
    const ctx = await requireCtx('doctor');
    const pid = input.patientId;
    assertCanWrite(ctx, pid, 'consultation');
    if (input.diagnosis?.condition) assertCanWrite(ctx, pid, 'diagnosis');
    if (input.prescriptions.length) assertCanWrite(ctx, pid, 'medication');
    if (input.labOrders.length) assertCanWrite(ctx, pid, 'lab_test');

    const doctorName = ctx.actor.name;
    const facility = ctx.actor.organization;
    const rxSummary = input.prescriptions.map((p) => `${p.name} ${p.dosage}, ${p.frequency.toLowerCase()}`).join('\n');
    const consultation = buildRecord(ctx, pid, 'consultation', input.date, {
      reason: input.reason, doctor: doctorName, facility, symptoms: input.symptoms, diagnosis: input.diagnosis?.condition,
      medications: rxSummary || undefined, followUp: input.followUp, notes: input.notes,
    });
    const created: MedicalRecord[] = [consultation];
    if (input.diagnosis?.condition?.trim()) {
      created.push(buildRecord(ctx, pid, 'diagnosis', input.date, { ...input.diagnosis, doctor: doctorName, facility }, consultation.id));
    }
    for (const p of input.prescriptions) {
      const end = p.endDate || (p.durationDays ? toISODate(addDays(new Date(`${p.startDate}T00:00:00`), p.durationDays)) : undefined);
      created.push(buildRecord(ctx, pid, 'medication', p.startDate || input.date, {
        name: p.name, dosage: p.dosage, frequency: p.frequency, endDate: end, prescriber: doctorName,
        reason: p.reason || input.diagnosis?.condition || input.reason, instructions: p.instructions,
      }, consultation.id));
    }
    for (const l of input.labOrders) {
      created.push(buildRecord(ctx, pid, 'lab_test', input.date, { test: l.test, status: 'Ordered', laboratory: l.laboratory, orderedBy: doctorName, reason: l.reason || input.reason }, consultation.id));
    }
    if (input.followUp) {
      created.push(buildRecord(ctx, pid, 'follow_up', input.followUp, { purpose: `Review: ${input.diagnosis?.condition || input.reason}`, doctor: doctorName, facility }, consultation.id));
    }
    const docIds: string[] = [];
    for (const f of input.files) docIds.push(await storeFile(ctx, pid, f, input.date));

    await mutate((db) => {
      db.records.push(...created);
      linkDocs(db, consultation, docIds);
      created.forEach((r) => ensureReminder(db, r));
      const parts = [
        'a consultation',
        created.some((r) => r.type === 'diagnosis') && 'a diagnosis',
        input.prescriptions.length && `${input.prescriptions.length} prescription${input.prescriptions.length > 1 ? 's' : ''}`,
        input.labOrders.length && `${input.labOrders.length} lab order${input.labOrders.length > 1 ? 's' : ''}`,
        docIds.length && `${docIds.length} attachment${docIds.length > 1 ? 's' : ''}`,
      ].filter(Boolean) as string[];
      const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
      logAndNotifyAdd(db, ctx, created, `${doctorName} added ${list} to your medical record.${input.prescriptions.length ? ' Reminders are set for the new medicines — you can change the times in Medications.' : ''}`);
    });
    return { consultation, created };
  },

  /**
   * Corrections never overwrite history: the old version is kept, and the new
   * version records who changed what, when and why. Attribution is untouched.
   */
  async amend(recordId: string, change: { date: string; data: RecordData; reason: string }): Promise<MedicalRecord> {
    await delay();
    const ctx = await requireCtx();
    if (!change.reason.trim()) throw new AppError('VALIDATION', 'Give a reason for the correction.');
    const r = ctx.db.records.find((x) => x.id === recordId);
    if (!r) throw new AppError('NOT_FOUND', 'This record could not be found.');
    if (ctx.user.role === 'patient') {
      if (r.patientId !== ctx.patient!.id) throw new AppError('ACCESS_DENIED', 'You can only change your own record.');
      if (r.createdBy.role === 'doctor') throw new AppError('ACCESS_DENIED', 'Entries added by a doctor can only be corrected by a doctor. You can add a note as a new record.');
    } else {
      requireGrant(ctx.db, ctx.doctor!.id, r.patientId, RECORD_TYPES[r.type].permission);
    }
    const internal = Object.fromEntries(Object.entries(r.data).filter(([k]) => ['medStatus', 'discontinuedOn', 'discontinueReason', 'resultRecordId', 'orderRecordId'].includes(k)));
    const next = cleanData(r.type, { ...change.data, ...internal });
    const errors = validateData(r.type, next);
    if (Object.keys(errors).length) throw new AppError('VALIDATION', Object.values(errors)[0]);
    const changed = Object.keys({ ...r.data, ...next }).filter((k) => String(r.data[k] ?? '') !== String(next[k] ?? ''));
    if (!changed.length && change.date === r.date) throw new AppError('VALIDATION', 'Nothing has changed.');
    return mutate((db) => {
      const rec = db.records.find((x) => x.id === recordId)!;
      pushVersion(rec, ctx.actor, 'amended', next, change.date, change.reason.trim());
      audit(db, {
        patientId: rec.patientId, actor: ctx.actor, action: 'record_amended',
        target: { type: rec.type, id: rec.id, label: `${RECORD_TYPES[rec.type].label}: ${recordTitle(rec)}` },
        metadata: { reason: change.reason.trim(), fields: changed.concat(change.date !== r.date ? ['date'] : []), version: rec.version },
      });
      if (ctx.user.role === 'doctor') {
        const pu = patientUserId(db, rec.patientId);
        if (pu) notify(db, { userId: pu, kind: 'record', title: 'Record corrected', body: `${ctx.actor.name} amended “${recordTitle(rec)}”. The original is kept in its history.`, link: `/app/timeline?record=${rec.id}` });
      }
      return rec;
    });
  },

  async discontinueMedication(recordId: string, reason: string, date = todayISO()): Promise<void> {
    await delay();
    const ctx = await requireCtx();
    const r = ctx.db.records.find((x) => x.id === recordId && x.type === 'medication');
    if (!r) throw new AppError('NOT_FOUND', 'Medication not found.');
    if (ctx.user.role === 'patient' && r.patientId !== ctx.patient!.id) throw new AppError('ACCESS_DENIED', 'You can only change your own record.');
    if (ctx.doctor) requireGrant(ctx.db, ctx.doctor.id, r.patientId, 'medications');
    if (!isMedicationActive(r)) throw new AppError('VALIDATION', 'This medication is already stopped.');
    await mutate((db) => {
      const rec = db.records.find((x) => x.id === recordId)!;
      pushVersion(rec, ctx.actor, 'discontinued', { ...rec.data, medStatus: 'discontinued', discontinuedOn: date, discontinueReason: reason.trim() || undefined }, rec.date, reason.trim() || 'Stopped');
      audit(db, { patientId: rec.patientId, actor: ctx.actor, action: 'medication_discontinued', target: { type: 'medication', id: rec.id, label: recordTitle(rec) }, metadata: { reason: reason.trim() || '—', date: fmtDate(date) } });
      if (ctx.doctor) {
        const pu = patientUserId(db, rec.patientId);
        if (pu) notify(db, { userId: pu, kind: 'record', title: 'Medication stopped', body: `${ctx.actor.name} stopped ${recordTitle(rec)}.`, link: `/app/medications` });
      }
    });
  },

  /** Adds the result for an ordered lab test and marks the order completed. */
  async addLabResult(orderId: string, data: RecordData, date: string, files: NewFile[] = []): Promise<MedicalRecord> {
    await delay();
    const ctx = await requireCtx();
    const order = ctx.db.records.find((x) => x.id === orderId && x.type === 'lab_test');
    if (!order) throw new AppError('NOT_FOUND', 'Lab order not found.');
    assertCanWrite(ctx, order.patientId, 'lab_result');
    const result = buildRecord(ctx, order.patientId, 'lab_result', date, { laboratory: order.data.laboratory, ...data, test: data.test || order.data.test }, orderId);
    const docIds: string[] = [];
    for (const f of files) docIds.push(await storeFile(ctx, order.patientId, f, date));
    return mutate((db) => {
      db.records.push(result);
      linkDocs(db, result, docIds);
      const o = db.records.find((x) => x.id === orderId)!;
      pushVersion(o, ctx.actor, 'result_added', { ...o.data, status: 'Completed', resultRecordId: result.id }, o.date, 'Result added');
      logAndNotifyAdd(db, ctx, [result], `${ctx.actor.name} added your ${recordTitle(result)} result.`);
      return result;
    });
  },

  typesDoctorCanWrite(permissions: PermissionKey[]): RecordType[] {
    return (Object.keys(RECORD_TYPES) as RecordType[]).filter((t) => RECORD_TYPES[t].doctorCanAdd && permissions.includes(RECORD_TYPES[t].permission));
  },
};

function pushVersion(rec: MedicalRecord, actor: Actor, changeType: ChangeType, data: RecordData, date: string, reason?: string) {
  const t = nowISO();
  rec.version += 1;
  rec.versions.push({ version: rec.version, date, data, changedAt: t, changedBy: actor, changeType, reason });
  rec.data = data;
  rec.date = date;
  rec.updatedAt = t;
}

/** Used by the export and emergency features to read the patient's own data without latency. */
export async function ownRecords(): Promise<{ ctx: Ctx; records: MedicalRecord[] }> {
  const ctx = await requireCtx('patient');
  const db = await getDb();
  return { ctx, records: db.records.filter((r) => r.patientId === ctx.patient!.id) };
}
