import type { DoseLog, MedicalRecord, MedicationReminder } from './types';
import { parseDate, toISODate, addDays } from './dates';

/** Sensible default reminder times for a prescription frequency. */
export function defaultTimes(frequency: string | undefined): string[] {
  switch (frequency) {
    case 'Once daily': return ['08:00'];
    case 'Twice daily': return ['08:00', '20:00'];
    case 'Three times daily': return ['08:00', '14:00', '20:00'];
    case 'Four times daily': return ['08:00', '12:00', '16:00', '20:00'];
    case 'Every night': return ['21:00'];
    case 'Weekly': return ['09:00'];
    default: return []; // "As needed" and unknown: no fixed schedule
  }
}

export const isScheduledFrequency = (f: unknown) => defaultTimes(String(f ?? '')).length > 0;

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normaliseTimes(times: string[]): string[] {
  return [...new Set(times.map((t) => t.trim()).filter((t) => TIME_RE.test(t)))].sort();
}

export function fmtClock(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/** Is this medication taken on this date (within start/end, not stopped, right weekday for weekly)? */
export function takenOn(r: MedicalRecord, date: string): boolean {
  if (r.type !== 'medication') return false;
  if (date < r.date) return false;
  if (r.data.endDate && date > String(r.data.endDate)) return false;
  if (r.data.discontinuedOn && date >= String(r.data.discontinuedOn)) return false;
  if (r.data.frequency === 'Weekly') return parseDate(date).getDay() === parseDate(r.date).getDay();
  return true;
}

/** A wall-clock moment in the patient's own time zone. */
export interface LocalNow {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since local midnight
}

/** Local date/time for an IANA time zone (e.g. "Asia/Kolkata"). Falls back to the runtime's zone. */
export function localNow(timeZone?: string, at: Date = new Date()): LocalNow {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
  } catch {
    return { date: toISODate(at), minutes: at.getHours() * 60 + at.getMinutes() };
  }
}

export const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export interface Dose {
  key: string; // recordId|date|time
  recordId: string;
  name: string;
  dosage: string;
  instructions?: string;
  date: string;
  time: string;
  status: 'taken' | 'skipped' | 'due' | 'upcoming' | 'missed';
  loggedAt?: string;
}

export const doseKey = (recordId: string, date: string, time: string) => `${recordId}|${date}|${time}`;

/** Every scheduled dose on a date, with its status relative to `now`. */
export function dosesFor(date: string, records: MedicalRecord[], reminders: MedicationReminder[], logs: DoseLog[], now: LocalNow): Dose[] {
  const out: Dose[] = [];
  for (const rem of reminders) {
    if (!rem.enabled || !rem.times.length) continue;
    const r = records.find((x) => x.id === rem.recordId);
    if (!r || !takenOn(r, date)) continue;
    for (const time of rem.times) {
      const log = logs.find((l) => l.recordId === r.id && l.date === date && l.time === time);
      const mins = date < now.date ? Infinity : date > now.date ? -Infinity : now.minutes - toMinutes(time);
      const status: Dose['status'] = log ? log.status : mins < 0 ? 'upcoming' : mins <= 120 ? 'due' : 'missed';
      out.push({
        key: doseKey(r.id, date, time), recordId: r.id, name: String(r.data.name), dosage: String(r.data.dosage ?? ''),
        instructions: r.data.instructions ? String(r.data.instructions) : undefined, date, time, status, loggedAt: log?.loggedAt,
      });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
}

/** Share of scheduled doses marked taken over the last `days` days (today excluded). */
export function adherence(recordId: string, records: MedicalRecord[], reminders: MedicationReminder[], logs: DoseLog[], now: LocalNow, days = 7) {
  let due = 0;
  let taken = 0;
  const rem = reminders.filter((r) => r.recordId === recordId);
  for (let i = 1; i <= days; i++) {
    const d = toISODate(addDays(parseDate(now.date), -i));
    for (const dose of dosesFor(d, records, rem, logs, now)) {
      due++;
      if (dose.status === 'taken') taken++;
    }
  }
  return { due, taken, pct: due ? Math.round((taken / due) * 100) : undefined };
}
