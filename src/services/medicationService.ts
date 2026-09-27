/**
 * Medicine reminders and dose tracking. The schedule belongs to the patient (they
 * can change times freely); the prescription itself stays in the clinical record.
 */
import type { Database, DoseLog, MedicalRecord, MedicationReminder } from '../types';
import { delay, mutate } from '../mock/db';
import { now, nowISO, todayISO, toISODate } from '../lib/dates';
import { uid } from '../lib/ids';
import { adherence, defaultTimes, dosesFor, normaliseTimes, takenOn, type Dose } from '../lib/reminders';
import { brand } from '../config/brand';
import { AppError, requireCtx } from './core';

/** Creates a default reminder for a new medication (called whenever one is added). */
export function ensureReminder(db: Database, record: MedicalRecord, times?: string[]) {
  if (record.type !== 'medication') return;
  const existing = db.reminders.find((r) => r.recordId === record.id);
  const t = normaliseTimes(times ?? defaultTimes(String(record.data.frequency)));
  if (existing) return;
  db.reminders.push({ recordId: record.id, patientId: record.patientId, times: t, enabled: t.length > 0, updatedAt: nowISO() });
}

export interface MedicationSchedule {
  record: MedicalRecord;
  reminder: MedicationReminder;
  adherence: { due: number; taken: number; pct?: number };
}

const isActive = (r: MedicalRecord, today: string) => r.type === 'medication' && r.data.medStatus !== 'discontinued' && (!r.data.endDate || String(r.data.endDate) >= today);

export const medicationService = {
  /** Today's doses for the signed-in patient. No artificial delay — polled by the alarm. */
  async today(): Promise<Dose[]> {
    const ctx = await requireCtx('patient');
    const pid = ctx.patient!.id;
    const records = ctx.db.records.filter((r) => r.patientId === pid);
    return dosesFor(todayISO(), records, ctx.db.reminders.filter((r) => r.patientId === pid), ctx.db.doseLogs.filter((l) => l.patientId === pid), now());
  },

  async logDose(recordId: string, date: string, time: string, status: DoseLog['status']): Promise<void> {
    const ctx = await requireCtx('patient');
    const pid = ctx.patient!.id;
    if (!ctx.db.records.some((r) => r.id === recordId && r.patientId === pid)) throw new AppError('NOT_FOUND', 'Medication not found.');
    await mutate((db) => {
      const existing = db.doseLogs.find((l) => l.recordId === recordId && l.date === date && l.time === time);
      if (existing) { existing.status = status; existing.loggedAt = nowISO(); return; }
      db.doseLogs.push({ id: uid('dose'), patientId: pid, recordId, date, time, status, loggedAt: nowISO() });
    });
  },

  async undoDose(recordId: string, date: string, time: string): Promise<void> {
    const ctx = await requireCtx('patient');
    await mutate((db) => {
      db.doseLogs = db.doseLogs.filter((l) => !(l.patientId === ctx.patient!.id && l.recordId === recordId && l.date === date && l.time === time));
    });
  },

  /** Current medications with their reminder schedule and last-7-day adherence. */
  async schedules(): Promise<MedicationSchedule[]> {
    await delay();
    const ctx = await requireCtx('patient');
    const pid = ctx.patient!.id;
    const today = todayISO();
    const records = ctx.db.records.filter((r) => r.patientId === pid);
    const reminders = ctx.db.reminders.filter((r) => r.patientId === pid);
    const logs = ctx.db.doseLogs.filter((l) => l.patientId === pid);
    return records.filter((r) => isActive(r, today)).map((record) => {
      const reminder = reminders.find((x) => x.recordId === record.id) ?? { recordId: record.id, patientId: pid, times: [], enabled: false, updatedAt: record.createdAt };
      return { record, reminder, adherence: adherence(record.id, records, reminders, logs, now()) };
    });
  },

  async setReminder(recordId: string, times: string[], enabled: boolean): Promise<void> {
    await delay(150);
    const ctx = await requireCtx('patient');
    const rec = ctx.db.records.find((r) => r.id === recordId && r.patientId === ctx.patient!.id && r.type === 'medication');
    if (!rec) throw new AppError('NOT_FOUND', 'Medication not found.');
    const t = normaliseTimes(times);
    if (enabled && !t.length) throw new AppError('VALIDATION', 'Add at least one reminder time, or turn reminders off.');
    await mutate((db) => {
      const r = db.reminders.find((x) => x.recordId === recordId);
      if (r) Object.assign(r, { times: t, enabled, updatedAt: nowISO() });
      else db.reminders.push({ recordId, patientId: rec.patientId, times: t, enabled, updatedAt: nowISO() });
    });
  },

  /**
   * An iCalendar file with a repeating event and alarm per reminder time. Importing it into
   * Google Calendar, Apple Calendar or Outlook makes the phone — and a paired smartwatch — ring.
   */
  async calendarFile(): Promise<{ filename: string; blob: Blob; count: number }> {
    const ctx = await requireCtx('patient');
    const pid = ctx.patient!.id;
    const today = todayISO();
    const stamp = nowISO().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${brand.name}//Medicine reminders//EN`, 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${brand.name} medicines`];
    let count = 0;
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
    for (const rem of ctx.db.reminders.filter((r) => r.patientId === pid && r.enabled)) {
      const rec = ctx.db.records.find((r) => r.id === rem.recordId);
      if (!rec || !isActive(rec, today)) continue;
      const start = rec.date > today ? rec.date : today;
      if (!takenOn(rec, start) && rec.data.frequency !== 'Weekly') continue;
      for (const t of rem.times) {
        const [hh, mm] = t.split(':');
        const d = start.replace(/-/g, '');
        const weekly = rec.data.frequency === 'Weekly';
        const firstDate = weekly ? nextWeekday(start, rec.date) : d;
        const until = rec.data.endDate ? `;UNTIL=${String(rec.data.endDate).replace(/-/g, '')}T235959` : '';
        lines.push(
          'BEGIN:VEVENT', `UID:${rec.id}-${t.replace(':', '')}@${brand.name.toLowerCase()}`, `DTSTAMP:${stamp}`,
          `DTSTART:${firstDate}T${hh}${mm}00`, `DURATION:PT10M`, `RRULE:FREQ=${weekly ? 'WEEKLY' : 'DAILY'}${until}`,
          `SUMMARY:${esc(`Take ${rec.data.name} ${rec.data.dosage ?? ''}`.trim())}`,
          `DESCRIPTION:${esc([rec.data.instructions, rec.data.reason ? `For ${rec.data.reason}` : '', `Mark it as taken in ${brand.name}.`].filter(Boolean).join('\n'))}`,
          'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Time to take ${rec.data.name}`)}`, 'TRIGGER:PT0M', 'END:VALARM',
          'END:VEVENT',
        );
        count++;
      }
    }
    lines.push('END:VCALENDAR');
    if (!count) throw new AppError('VALIDATION', 'There are no active reminders to add. Set reminder times for a medicine first.');
    return { filename: `${brand.name.toLowerCase()}-medicine-reminders.ics`, blob: new Blob([lines.join('\r\n')], { type: 'text/calendar' }), count };
  },
};

function nextWeekday(from: string, like: string): string {
  const target = new Date(`${like}T00:00:00`).getDay();
  const d = new Date(`${from}T00:00:00`);
  while (d.getDay() !== target) d.setDate(d.getDate() + 1);
  return toISODate(d).replace(/-/g, '');
}

export type { Dose };
