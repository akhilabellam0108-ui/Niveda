import { Router } from 'express';
import { z } from 'zod';
import type { MedicationScheduleView } from '@shared/api';
import { AppError, isMedicationActive } from '@shared/api';
import type { MedicalRecord, MedicationReminder } from '@shared/types';
import { adherence, dosesFor, localNow, normaliseTimes, takenOn } from '@shared/reminders';
import { toISODate } from '@shared/dates';
import { brand } from '@shared/brand';
import type { Db } from '../db/db';
import { json } from '../db/db';
import { toDoseLog, toReminder } from '../db/mappers';
import { uid } from '../lib/ids';
import { ctxOf, h, prefsFor, touchPatient } from '../core';
import { loadRecords } from '../services/records';

export async function patientTimezone(db: Db, userId: string) {
  return (await prefsFor(db, userId)).timezone;
}

export async function scheduleData(db: Db, patientId: string) {
  const records = (await loadRecords(db, patientId)).filter((r) => r.type === 'medication');
  const reminders = (await db.query('SELECT * FROM medication_reminders WHERE patient_id = $1', [patientId])).map(toReminder);
  const logs = (await db.query(`SELECT * FROM dose_logs WHERE patient_id = $1 AND date > (current_date - 10)`, [patientId])).map(toDoseLog);
  return { records, reminders, logs };
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export function medicationRoutes() {
  const r = Router();

  r.get('/today', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const now = localNow(await patientTimezone(ctx.db, ctx.user.id));
    const { records, reminders, logs } = await scheduleData(ctx.db, ctx.patient!.id);
    res.json(dosesFor(now.date, records, reminders, logs, now));
  }));

  r.get('/schedules', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const now = localNow(await patientTimezone(ctx.db, ctx.user.id));
    const { records, reminders, logs } = await scheduleData(ctx.db, ctx.patient!.id);
    const out: MedicationScheduleView[] = records.filter((m) => isMedicationActive(m, now.date)).map((record) => {
      const rem = reminders.find((x) => x.recordId === record.id);
      return { record, reminder: { recordId: record.id, times: rem?.times ?? [], enabled: rem?.enabled ?? false }, adherence: adherence(record.id, records, reminders, logs, now) };
    });
    res.json(out);
  }));

  r.post('/doses', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const p = z.object({ recordId: z.string(), date: dateStr, time: timeStr, status: z.enum(['taken', 'skipped']) }).parse(req.body);
    if (!(await ctx.db.one(`SELECT 1 FROM records WHERE id = $1 AND patient_id = $2 AND type = 'medication'`, [p.recordId, ctx.patient!.id]))) throw new AppError('NOT_FOUND', 'Medication not found.');
    await ctx.db.query(
      `INSERT INTO dose_logs (id, patient_id, record_id, date, time, status, logged_at) VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (record_id, date, time) DO UPDATE SET status = EXCLUDED.status, logged_at = now()`,
      [uid('dose'), ctx.patient!.id, p.recordId, p.date, p.time, p.status],
    );
    await touchPatient(ctx.db, ctx.patient!.id);
    res.json({ ok: true });
  }));

  r.delete('/doses', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const p = z.object({ recordId: z.string(), date: dateStr, time: timeStr }).parse(req.body);
    await ctx.db.query('DELETE FROM dose_logs WHERE patient_id = $1 AND record_id = $2 AND date = $3 AND time = $4', [ctx.patient!.id, p.recordId, p.date, p.time]);
    await touchPatient(ctx.db, ctx.patient!.id);
    res.json({ ok: true });
  }));

  r.put('/:recordId/reminder', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const p = z.object({ times: z.array(z.string()).max(12), enabled: z.boolean() }).parse(req.body);
    if (!(await ctx.db.one(`SELECT 1 FROM records WHERE id = $1 AND patient_id = $2 AND type = 'medication'`, [req.params.recordId, ctx.patient!.id]))) throw new AppError('NOT_FOUND', 'Medication not found.');
    const times = normaliseTimes(p.times);
    if (p.enabled && !times.length) throw new AppError('VALIDATION', 'Add at least one reminder time, or turn reminders off.');
    await ctx.db.query(
      `INSERT INTO medication_reminders (record_id, patient_id, times, enabled, updated_at) VALUES ($1,$2,$3::jsonb,$4,now())
       ON CONFLICT (record_id) DO UPDATE SET times = EXCLUDED.times, enabled = EXCLUDED.enabled, updated_at = now()`,
      [req.params.recordId, ctx.patient!.id, json(times), p.enabled],
    );
    await touchPatient(ctx.db, ctx.patient!.id);
    res.json({ ok: true });
  }));

  /** iCalendar feed: a repeating event with an alarm per dose, for phones and paired smartwatches. */
  r.get('/calendar.ics', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const now = localNow(await patientTimezone(ctx.db, ctx.user.id));
    const { records, reminders } = await scheduleData(ctx.db, ctx.patient!.id);
    const ics = buildCalendar(records, reminders, now.date);
    if (!ics.count) throw new AppError('VALIDATION', 'There are no active reminders to add. Set reminder times for a medicine first.');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${brand.name.toLowerCase()}-medicine-reminders.ics"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Reminder-Count', String(ics.count));
    res.send(ics.text);
  }));

  return r;
}

function nextWeekday(from: string, like: string): string {
  const target = new Date(`${like}T00:00:00`).getDay();
  const d = new Date(`${from}T00:00:00`);
  while (d.getDay() !== target) d.setDate(d.getDate() + 1);
  return toISODate(d).replace(/-/g, '');
}

export function buildCalendar(records: MedicalRecord[], reminders: MedicationReminder[], today: string) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${brand.name}//Medicine reminders//EN`, 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${brand.name} medicines`];
  let count = 0;
  for (const rem of reminders.filter((x) => x.enabled)) {
    const rec = records.find((x) => x.id === rem.recordId);
    if (!rec || !isMedicationActive(rec, today)) continue;
    const start = rec.date > today ? rec.date : today;
    const weekly = rec.data.frequency === 'Weekly';
    if (!weekly && !takenOn(rec, start)) continue;
    for (const t of rem.times) {
      const [hh, mm] = t.split(':');
      const until = rec.data.endDate ? `;UNTIL=${String(rec.data.endDate).replace(/-/g, '')}T235959` : '';
      lines.push(
        'BEGIN:VEVENT', `UID:${rec.id}-${t.replace(':', '')}@niveda`, `DTSTAMP:${stamp}`,
        `DTSTART:${weekly ? nextWeekday(start, rec.date) : start.replace(/-/g, '')}T${hh}${mm}00`, 'DURATION:PT10M',
        `RRULE:FREQ=${weekly ? 'WEEKLY' : 'DAILY'}${until}`,
        `SUMMARY:${esc(`Take ${rec.data.name} ${rec.data.dosage ?? ''}`.trim())}`,
        `DESCRIPTION:${esc([rec.data.instructions, rec.data.reason ? `For ${rec.data.reason}` : '', `Mark it as taken in ${brand.name}.`].filter(Boolean).join('\n'))}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Time to take ${rec.data.name}`)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT',
      );
      count++;
    }
  }
  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n'), count };
}
