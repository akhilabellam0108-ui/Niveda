/**
 * Works out which medicine alarms the phone should have scheduled. Pure, so it can
 * be tested; ../lib/nativeAlarms.ts hands the result to Android.
 *
 * Each dose in the coming days becomes its own alarm at an exact time, so a
 * course that ends stops ringing, a dose already marked taken doesn't ring, and
 * changing a time in the app moves the alarm. The app re-plans every time it's
 * opened, so the window keeps rolling forward.
 */
import type { MedicalRecord, MedicationReminder } from '../types';
import { fmtClock, takenOn } from './reminders';
import { toISODate } from './dates';

export const ALARM_DAYS = 14;
/** Android keeps at most ~500 pending alarms per app; stay well below. */
export const MAX_ALARMS = 400;

export interface PlannedAlarm {
  id: number;
  at: Date;
  title: string;
  body: string;
  recordId: string;
  date: string;
  time: string;
}

export interface PlanInput {
  schedules: { record: MedicalRecord; reminder: MedicationReminder }[];
  /** Doses already marked taken or skipped, as `${recordId}|${date}|${time}`. */
  logged: Set<string>;
  now: Date;
  enabled: boolean;
  days?: number;
}

/** A stable, positive 31-bit id for a dose (Android notification ids are ints). */
export function alarmId(recordId: string, date: string, time: string): number {
  let h = 2166136261;
  for (const ch of `${recordId}|${date}|${time}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) || 1;
}

export function planAlarms({ schedules, logged, now, enabled, days = ALARM_DAYS }: PlanInput): PlannedAlarm[] {
  if (!enabled) return [];
  const out: PlannedAlarm[] = [];
  for (let d = 0; d < days; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const date = toISODate(day);
    for (const { record, reminder } of schedules) {
      if (!reminder.enabled || !reminder.times.length || !takenOn(record, date)) continue;
      for (const time of reminder.times) {
        const [hh, mm] = time.split(':').map(Number);
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm);
        if (at <= now || logged.has(`${record.id}|${date}|${time}`)) continue;
        const name = String(record.data.name ?? 'your medicine');
        const dosage = record.data.dosage ? String(record.data.dosage) : '';
        const instructions = record.data.instructions ? String(record.data.instructions) : '';
        out.push({
          id: alarmId(record.id, date, time), at, recordId: record.id, date, time,
          title: `Time for ${name}`,
          body: [dosage, fmtClock(time), instructions].filter(Boolean).join(' · '),
        });
      }
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_ALARMS);
}
