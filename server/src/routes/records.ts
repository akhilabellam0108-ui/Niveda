import { Router } from 'express';
import { z } from 'zod';
import type { ConsultationPayload, NewRecordPayload } from '@shared/api';
import type { RecordData, RecordType } from '@shared/types';
import { RECORD_TYPES, recordTitle } from '@shared/recordMeta';
import { audit, ctxOf, h, recentlyLogged, requireGrant, resolvePatient } from '../core';
import { addConsultation, addLabResult, amendRecord, createRecord, discontinueMedication, getRecord, visibleRecords } from '../services/records';
import { payloadOf, upload, uploadsOf } from './uploads';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const data = z.record(z.string().max(60), z.union([z.string().max(5000), z.number()]).optional());
const fileMeta = z.object({ name: z.string().max(200), category: z.string(), date: dateStr.optional().or(z.literal('')) });

export function recordRoutes() {
  const r = Router();

  r.get('/', h(async (req, res) => {
    const ctx = ctxOf(req);
    const { patientId } = await resolvePatient(ctx, req.query.patientId as string | undefined);
    res.json(await visibleRecords(ctx, patientId));
  }));

  r.get('/:id', h(async (req, res) => {
    const ctx = ctxOf(req);
    const detail = await getRecord(ctx, req.params.id);
    if (ctx.doctor && !(await recentlyLogged(ctx.db, ctx.actor.id, 'viewed_record', detail.record.id, detail.record.patientId))) {
      await audit(ctx.db, { patientId: detail.record.patientId, actor: ctx.actor, action: 'viewed_record', target: { type: detail.record.type, id: detail.record.id, label: `${RECORD_TYPES[detail.record.type].label}: ${recordTitle(detail.record)}` }, ip: ctx.ip });
    }
    res.json(detail);
  }));

  /** Doctors opening a patient's history is logged (at most every 30 minutes). */
  r.post('/history-view', h(async (req, res) => {
    const ctx = ctxOf(req, 'doctor');
    const { patientId } = z.object({ patientId: z.string() }).parse(req.body);
    await requireGrant(ctx.db, ctx.doctor!.id, patientId);
    if (!(await recentlyLogged(ctx.db, ctx.actor.id, 'viewed_history', undefined, patientId, 30))) {
      await audit(ctx.db, { patientId, actor: ctx.actor, action: 'viewed_history', target: { type: 'record', label: 'Medical history' }, ip: ctx.ip });
    }
    res.json({ ok: true });
  }));

  r.post('/', upload.array('files'), h(async (req, res) => {
    const ctx = ctxOf(req);
    const p = z.object({
      patientId: z.string().optional(), type: z.string(), date: dateStr, data, parentId: z.string().optional(),
      reminderTimes: z.array(z.string().max(5)).max(12).optional(), files: z.array(fileMeta).optional(),
    }).parse(payloadOf<NewRecordPayload>(req));
    res.json(await createRecord(ctx, { ...p, type: p.type as RecordType, data: p.data as RecordData }, uploadsOf(req, p.files as never)));
  }));

  r.post('/consultation', upload.array('files'), h(async (req, res) => {
    const ctx = ctxOf(req, 'doctor');
    const s = z.string().max(5000).optional();
    const p = z.object({
      patientId: z.string(), date: dateStr, reason: z.string().trim().min(1, 'Reason for visit is required').max(500), symptoms: s, notes: s, followUp: dateStr.optional(),
      diagnosis: z.object({ condition: z.string().max(300), status: z.string().max(40), severity: z.string().max(40).optional(), notes: s }).optional(),
      prescriptions: z.array(z.object({
        name: z.string().trim().min(1, 'Medicine name is required').max(200), dosage: z.string().trim().min(1, 'Dose is required').max(100), frequency: z.string().max(40),
        durationDays: z.number().int().positive().max(3650).optional(), startDate: dateStr, endDate: dateStr.optional(), instructions: s, reason: s,
      })).max(20),
      labOrders: z.array(z.object({ test: z.string().trim().min(1, 'Test name is required').max(200), laboratory: s, reason: s })).max(20),
      files: z.array(fileMeta).optional(),
    }).parse(payloadOf<ConsultationPayload>(req));
    res.json(await addConsultation(ctx, p as ConsultationPayload, uploadsOf(req, p.files as never)));
  }));

  r.post('/:id/amend', h(async (req, res) => {
    const ctx = ctxOf(req);
    const p = z.object({ date: dateStr, data, reason: z.string().max(1000) }).parse(req.body);
    res.json(await amendRecord(ctx, req.params.id, p as { date: string; data: RecordData; reason: string }));
  }));

  r.post('/:id/discontinue', h(async (req, res) => {
    const ctx = ctxOf(req);
    const p = z.object({ reason: z.string().max(500).default(''), date: dateStr.optional() }).parse(req.body);
    await discontinueMedication(ctx, req.params.id, p.reason, p.date);
    res.json({ ok: true });
  }));

  r.post('/:id/lab-result', upload.array('files'), h(async (req, res) => {
    const ctx = ctxOf(req);
    const p = z.object({ data, date: dateStr, files: z.array(fileMeta).optional() }).parse(payloadOf(req));
    res.json(await addLabResult(ctx, req.params.id, p.data as RecordData, p.date, uploadsOf(req, p.files as never)));
  }));

  return r;
}
