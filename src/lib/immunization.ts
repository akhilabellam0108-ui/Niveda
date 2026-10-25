/**
 * India's Universal Immunization Programme (UIP) schedule for children, and where a child
 * is on it. Source: Ministry of Health & Family Welfare, National Immunization Schedule
 * (as taught to health workers, NHM 2024) — https://nhmodisha.gov.in/wp-content/uploads/2024/02/UIP.pdf
 *
 * The schedule is a guide for reminders, not medical advice: a child's doctor may give
 * vaccines on a different timetable, and private clinics often add others (IAP schedule).
 * Vaccine names stay in Latin script in every language, like medicine names.
 */
import type { MedicalRecord } from '../types';
import { parseDate, toISODate } from './dates';
import { t } from '../i18n';

export interface ScheduledDose {
  /** Stable id, saved on the vaccination record as data.uipKey. */
  key: string;
  vaccine: string;
  /** English, saved on the record; shown through t(). */
  dose: string;
  /** When it is due, counted from the date of birth. */
  at: { days?: number; months?: number; years?: number };
  /** Index into AGE_GROUPS. */
  group: number;
  /** Given only in some districts or states. */
  some?: string;
  /** Not given after this age — after it, ask the doctor about catch-up. */
  untilDays?: number;
}

/** English labels (shown through t()). */
export const AGE_GROUPS = ['At birth', '6 weeks', '10 weeks', '14 weeks', '9 months', '16–24 months', 'Every 6 months until 5 years', '5–6 years', '10 years', '16 years'];

/** A date some days after an ISO date. */
export const plusDays = (iso: string, n: number) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return toISODate(d); };

const JE = 'Only in districts where Japanese encephalitis occurs';

export const UIP_SCHEDULE: ScheduledDose[] = [
  { key: 'bcg', vaccine: 'BCG', dose: 'Single dose', at: { days: 0 }, group: 0, untilDays: 365 },
  { key: 'opv0', vaccine: 'OPV', dose: 'Zero dose', at: { days: 0 }, group: 0, untilDays: 15 },
  { key: 'hepb0', vaccine: 'Hepatitis B', dose: 'Birth dose', at: { days: 0 }, group: 0, untilDays: 1 },

  { key: 'opv1', vaccine: 'OPV', dose: 'Dose 1', at: { days: 42 }, group: 1 },
  { key: 'penta1', vaccine: 'Pentavalent', dose: 'Dose 1', at: { days: 42 }, group: 1, untilDays: 365 },
  { key: 'rota1', vaccine: 'Rotavirus', dose: 'Dose 1', at: { days: 42 }, group: 1, untilDays: 365 },
  { key: 'fipv1', vaccine: 'fIPV', dose: 'Dose 1', at: { days: 42 }, group: 1 },
  { key: 'pcv1', vaccine: 'PCV', dose: 'Dose 1', at: { days: 42 }, group: 1 },

  { key: 'opv2', vaccine: 'OPV', dose: 'Dose 2', at: { days: 70 }, group: 2 },
  { key: 'penta2', vaccine: 'Pentavalent', dose: 'Dose 2', at: { days: 70 }, group: 2, untilDays: 365 },
  { key: 'rota2', vaccine: 'Rotavirus', dose: 'Dose 2', at: { days: 70 }, group: 2, untilDays: 365 },

  { key: 'opv3', vaccine: 'OPV', dose: 'Dose 3', at: { days: 98 }, group: 3 },
  { key: 'penta3', vaccine: 'Pentavalent', dose: 'Dose 3', at: { days: 98 }, group: 3, untilDays: 365 },
  { key: 'rota3', vaccine: 'Rotavirus', dose: 'Dose 3', at: { days: 98 }, group: 3, untilDays: 365 },
  { key: 'fipv2', vaccine: 'fIPV', dose: 'Dose 2', at: { days: 98 }, group: 3 },
  { key: 'pcv2', vaccine: 'PCV', dose: 'Dose 2', at: { days: 98 }, group: 3 },

  { key: 'mr1', vaccine: 'MR', dose: 'Dose 1', at: { months: 9 }, group: 4 },
  { key: 'je1', vaccine: 'JE', dose: 'Dose 1', at: { months: 9 }, group: 4, some: JE },
  { key: 'fipv3', vaccine: 'fIPV', dose: 'Dose 3', at: { months: 9 }, group: 4 },
  { key: 'pcvb', vaccine: 'PCV', dose: 'Booster', at: { months: 9 }, group: 4 },
  { key: 'vita1', vaccine: 'Vitamin A', dose: 'Dose 1', at: { months: 9 }, group: 4 },

  { key: 'mr2', vaccine: 'MR', dose: 'Dose 2', at: { months: 16 }, group: 5 },
  { key: 'je2', vaccine: 'JE', dose: 'Dose 2', at: { months: 16 }, group: 5, some: JE },
  { key: 'dptb1', vaccine: 'DPT', dose: 'Booster 1', at: { months: 16 }, group: 5 },
  { key: 'opvb', vaccine: 'OPV', dose: 'Booster', at: { months: 16 }, group: 5 },
  { key: 'vita2', vaccine: 'Vitamin A', dose: 'Dose 2', at: { months: 16 }, group: 5 },

  ...[3, 4, 5, 6, 7, 8, 9].map((n) => ({ key: `vita${n}`, vaccine: 'Vitamin A', dose: `Dose ${n}`, at: { months: 16 + (n - 2) * 6 }, group: 6 })),

  { key: 'dptb2', vaccine: 'DPT', dose: 'Booster 2', at: { years: 5 }, group: 7 },
  { key: 'td10', vaccine: 'Td', dose: 'At 10 years', at: { years: 10 }, group: 8 },
  { key: 'td16', vaccine: 'Td', dose: 'At 16 years', at: { years: 16 }, group: 9 },
];

/** "Dose 1" in the interface language. Dose names are saved in English. */
export function doseLabel(dose: string): string {
  const m = /^Dose (\d+)$/.exec(dose);
  return m ? t('Dose {n}', { n: m[1] }) : t(dose);
}

export function dueDate(dateOfBirth: string, d: ScheduledDose): string {
  const birth = parseDate(dateOfBirth);
  if (d.at.days !== undefined) return plusDays(dateOfBirth, d.at.days);
  const due = new Date(birth.getFullYear() + (d.at.years ?? 0), birth.getMonth() + (d.at.months ?? 0), birth.getDate());
  return toISODate(due);
}

/** Days after the due date before a dose counts as overdue. */
export const GRACE_DAYS = 28;

export type DoseStatus = 'given' | 'due' | 'overdue' | 'upcoming' | 'missed';

export interface DoseState extends ScheduledDose {
  dueDate: string;
  status: DoseStatus;
  /** The vaccination record, when given. */
  record?: MedicalRecord;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Finds the vaccination entry for a scheduled dose: by its key, or by the same vaccine and dose. */
export function findGiven(d: ScheduledDose, records: MedicalRecord[]): MedicalRecord | undefined {
  const vacc = records.filter((r) => r.type === 'vaccination');
  return vacc.find((r) => r.data.uipKey === d.key)
    ?? vacc.find((r) => norm(r.data.vaccine) === norm(d.vaccine) && norm(r.data.dose) === norm(d.dose));
}

export function scheduleFor(dateOfBirth: string, records: MedicalRecord[], today: string): DoseState[] {
  return UIP_SCHEDULE.map((d) => {
    const due = dueDate(dateOfBirth, d);
    const record = findGiven(d, records);
    let status: DoseStatus;
    if (record) status = 'given';
    else if (d.untilDays !== undefined && today > plusDays(dateOfBirth, d.untilDays)) status = 'missed';
    else if (today < due) status = 'upcoming';
    else if (today < plusDays(due, GRACE_DAYS)) status = 'due';
    else status = 'overdue';
    return { ...d, dueDate: due, status, record };
  });
}

/** The schedule is for children; it is shown until the 17th birthday (the last Td is at 16). */
export function onSchedule(dateOfBirth: string, today: string): boolean {
  const b = parseDate(dateOfBirth);
  return today < toISODate(new Date(b.getFullYear() + 17, b.getMonth(), b.getDate()));
}

/** Doses to mention first: overdue, then due now, then the next upcoming ones. */
export function nextDoses(states: DoseState[]): DoseState[] {
  const open = states.filter((s) => s.status === 'overdue' || s.status === 'due');
  if (open.length) return open;
  const up = states.filter((s) => s.status === 'upcoming').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return up.filter((s) => s.dueDate === up[0]?.dueDate);
}

/** Must be 18 to open your own account (DPDP Act s.9). */
export function isAdult(dateOfBirth: string, today = new Date()): boolean {
  const d = new Date(`${dateOfBirth}T00:00:00`);
  const eighteen = new Date(d.getFullYear() + 18, d.getMonth(), d.getDate());
  return eighteen <= today;
}

/** Age in whole years on a date. */
export function ageInYears(dateOfBirth: string, on: string): number {
  const b = parseDate(dateOfBirth); const d = parseDate(on);
  let y = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) y--;
  return y;
}

/** "2 years", "8 months", "3 weeks" — a child's age in the interface language. */
export function ageLabel(dateOfBirth: string, on: string): string {
  const y = ageInYears(dateOfBirth, on);
  if (y >= 2) return t('{n} years', { n: y });
  const b = parseDate(dateOfBirth); const d = parseDate(on);
  let months = (d.getFullYear() - b.getFullYear()) * 12 + d.getMonth() - b.getMonth();
  if (d.getDate() < b.getDate()) months--;
  if (months >= 1) return months === 1 ? t('1 month') : t('{n} months', { n: months });
  const weeks = Math.max(0, Math.floor((d.getTime() - b.getTime()) / (7 * 86400000)));
  if (weeks >= 1) return weeks === 1 ? t('1 week') : t('{n} weeks', { n: weeks });
  const days = Math.max(0, Math.round((d.getTime() - b.getTime()) / 86400000));
  return days === 1 ? t('1 day') : t('{n} days', { n: days });
}
