/**
 * The pre-visit brief: everything a doctor needs before a consultation, built
 * from the structured record so it can be read in about a minute instead of
 * paging through old files. Every line points back to the entry it came from.
 *
 * Pure and backend-independent: it only sees the records the doctor is
 * allowed to see, so the brief never reveals a section the patient hasn't shared.
 */
import type { MedicalRecord, PermissionKey } from '../types';
import { ALLERGY_SEVERITY_RANK, PERMISSIONS, recordTitle } from './recordMeta';
import { addDays, fmtDate, parseDate, toISODate } from './dates';

export type Flag = 'danger' | 'warn' | 'ok' | 'info' | undefined;

export interface BriefLine {
  /** The entry this line came from — open it to check the source. */
  recordId: string;
  date: string;
  title: string;
  detail?: string;
  flag?: Flag;
  flagLabel?: string;
}

export interface LabTrend {
  test: string;
  latest: BriefLine;
  /** Earlier results of the same test, newest first. */
  earlier: { recordId: string; date: string; result: string; status?: string }[];
}

export interface OpenItem extends BriefLine { kind: 'follow_up' | 'lab_pending' | 'vaccine_due' }

export interface PreVisitBrief {
  stats: { entries: number; since?: string; doctors: number; facilities: number };
  allergies: BriefLine[];
  lastVisit?: BriefLine & { handoverNote?: string; doctor?: string; facility?: string };
  activeProblems: BriefLine[];
  pastProblems: BriefLine[];
  currentMeds: BriefLine[];
  stoppedMeds: BriefLine[];
  labs: LabTrend[];
  imaging: BriefLine[];
  surgeriesAndStays: BriefLine[];
  familyHistory: BriefLine[];
  openItems: OpenItem[];
  /** Sections of the record the patient hasn't shared with this doctor. */
  notShared: string[];
}

const ACTIVE_STATUSES = ['Active', 'Managed', 'Suspected'];
const LAB_FLAG: Record<string, Flag> = { Normal: 'ok', Borderline: 'warn', Abnormal: 'danger', Critical: 'danger' };
const LAB_RANK: Record<string, number> = { Critical: 4, Abnormal: 3, Borderline: 2, Normal: 1 };
/** How far back "recently stopped" medicines are shown. */
export const STOPPED_MEDS_MONTHS = 24;

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const newestFirst = (a: MedicalRecord, b: MedicalRecord) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
const join = (...parts: unknown[]) => parts.map(s).filter(Boolean).join(' · ') || undefined;
const by = (r: MedicalRecord) => (r.createdBy.role === 'doctor' ? r.createdBy.name : '');
/** Groups "HbA1c", "Hba1c " and "HBA1C" together. */
export const testKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function monthsBefore(today: string, months: number): string {
  const d = parseDate(today);
  d.setMonth(d.getMonth() - months);
  return toISODate(d);
}

export function buildBrief(records: MedicalRecord[], permissions: PermissionKey[], today: string): PreVisitBrief {
  const all = records.slice().sort(newestFirst);
  const of = (t: MedicalRecord['type']) => all.filter((r) => r.type === t);

  const allergies = of('allergy')
    .sort((a, b) => (ALLERGY_SEVERITY_RANK[s(b.data.severity)] ?? 0) - (ALLERGY_SEVERITY_RANK[s(a.data.severity)] ?? 0))
    .map((r): BriefLine => {
      const rank = ALLERGY_SEVERITY_RANK[s(r.data.severity)] ?? 0;
      return { recordId: r.id, date: r.date, title: recordTitle(r), detail: s(r.data.reaction) || undefined, flag: rank >= 3 ? 'danger' : rank === 2 ? 'warn' : 'info', flagLabel: s(r.data.severity) || undefined };
    });

  const visit = of('consultation')[0];
  const lastVisit = visit && {
    recordId: visit.id, date: visit.date, title: s(visit.data.reason) || 'Consultation',
    detail: s(visit.data.diagnosis) || undefined,
    handoverNote: s(visit.data.handoverNote) || undefined,
    doctor: by(visit) || s(visit.data.doctor) || undefined,
    facility: visit.organization?.name ?? (s(visit.data.facility) || undefined),
  };

  const dx = of('diagnosis');
  const activeProblems = dx.filter((r) => ACTIVE_STATUSES.includes(s(r.data.status))).map((r): BriefLine => ({
    recordId: r.id, date: r.date, title: recordTitle(r), detail: join(r.data.severity, by(r) || r.data.doctor),
    flag: s(r.data.status) === 'Suspected' ? 'warn' : 'info', flagLabel: s(r.data.status),
  }));
  const pastProblems = dx.filter((r) => !ACTIVE_STATUSES.includes(s(r.data.status))).map((r): BriefLine => ({
    recordId: r.id, date: r.date, title: recordTitle(r), detail: s(r.data.notes) || undefined, flagLabel: s(r.data.status) || undefined,
  }));

  const meds = of('medication');
  const stoppedOn = (r: MedicalRecord) => s(r.data.discontinuedOn) || (s(r.data.endDate) && s(r.data.endDate) < today ? s(r.data.endDate) : '');
  const isActive = (r: MedicalRecord) => s(r.data.medStatus) !== 'discontinued' && (!s(r.data.endDate) || s(r.data.endDate) >= today);
  const currentMeds = meds.filter(isActive).map((r): BriefLine => ({
    recordId: r.id, date: r.date, title: `${recordTitle(r)} ${s(r.data.dosage)}`.trim(),
    detail: join(r.data.frequency, r.data.reason && `for ${s(r.data.reason)}`, by(r) || r.data.prescriber, r.data.endDate && `until ${fmtDate(s(r.data.endDate))}`),
  }));
  const cutoff = monthsBefore(today, STOPPED_MEDS_MONTHS);
  const stoppedMeds = meds.filter((r) => !isActive(r) && stoppedOn(r) >= cutoff)
    .sort((a, b) => stoppedOn(b).localeCompare(stoppedOn(a)))
    .map((r): BriefLine => ({
      recordId: r.id, date: stoppedOn(r), title: `${recordTitle(r)} ${s(r.data.dosage)}`.trim(),
      detail: s(r.data.discontinueReason) || (s(r.data.medStatus) === 'discontinued' ? 'Stopped' : 'Course finished'),
    }));

  const results = of('lab_result');
  const groups = new Map<string, MedicalRecord[]>();
  for (const r of results) {
    const k = testKey(recordTitle(r));
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const labs = [...groups.values()].map((rs): LabTrend => {
    const [l, ...rest] = rs;
    return {
      test: recordTitle(l),
      latest: { recordId: l.id, date: l.date, title: recordTitle(l), detail: s(l.data.result), flag: LAB_FLAG[s(l.data.status)], flagLabel: s(l.data.status) || undefined },
      earlier: rest.map((r) => ({ recordId: r.id, date: r.date, result: s(r.data.result), status: s(r.data.status) || undefined })),
    };
  });
  // Recent results outside the normal range first (worst first), then everything else newest first.
  // An old abnormal value shouldn't outrank this month's results.
  const recentCutoff = monthsBefore(today, 12);
  const urgency = (t: LabTrend) => (t.latest.date >= recentCutoff ? LAB_RANK[t.latest.flagLabel ?? ''] ?? 0 : 0);
  labs.sort((a, b) => Math.max(urgency(b) - 1, 0) - Math.max(urgency(a) - 1, 0) || b.latest.date.localeCompare(a.latest.date));

  const imaging = of('imaging').map((r): BriefLine => ({ recordId: r.id, date: r.date, title: recordTitle(r), detail: s(r.data.impression) || s(r.data.findings) || undefined }));

  const surgeriesAndStays = all.filter((r) => ['surgery', 'procedure', 'hospitalization'].includes(r.type)).map((r): BriefLine => ({
    recordId: r.id, date: r.date, title: r.type === 'hospitalization' ? `Admitted: ${recordTitle(r)}` : recordTitle(r),
    detail: join(r.data.facility, r.data.outcome),
  }));

  const familyHistory = of('family_history').map((r): BriefLine => ({ recordId: r.id, date: r.date, title: recordTitle(r), detail: s(r.data.relative) || undefined }));

  const openItems: OpenItem[] = [];
  const soon = toISODate(addDays(parseDate(today), 30));
  // Only the last visit's follow-up is still open: a later visit supersedes earlier ones.
  const f = visit ? s(visit.data.followUp) : '';
  if (visit && f) {
    const overdue = f < today;
    openItems.push({ kind: 'follow_up', recordId: visit.id, date: f, title: overdue ? 'Follow-up overdue' : 'Follow-up due', detail: join(visit.data.diagnosis || visit.data.reason, by(visit)), flag: overdue ? 'danger' : 'info' });
  }
  for (const r of of('lab_test')) {
    if (!['Ordered', 'Sample collected'].includes(s(r.data.status))) continue;
    openItems.push({ kind: 'lab_pending', recordId: r.id, date: r.date, title: `Result awaited: ${recordTitle(r)}`, detail: join(r.data.status, r.data.orderedBy || by(r)), flag: 'warn' });
  }
  for (const r of of('vaccination')) {
    const due = s(r.data.nextDue);
    if (!due || due > soon) continue;
    // A later dose of the same vaccine means this one is no longer due.
    if (of('vaccination').some((x) => x.id !== r.id && x.date > r.date && testKey(recordTitle(x)) === testKey(recordTitle(r)))) continue;
    openItems.push({ kind: 'vaccine_due', recordId: r.id, date: due, title: `${due < today ? 'Overdue' : 'Due'}: ${recordTitle(r)}`, detail: s(r.data.dose) || undefined, flag: due < today ? 'danger' : 'warn' });
  }
  openItems.sort((a, b) => a.date.localeCompare(b.date));

  const doctors = new Set(all.filter((r) => r.createdBy.role === 'doctor').map((r) => r.createdBy.id));
  const facilities = new Set(all.map((r) => r.organization?.name ?? s(r.data.facility)).filter(Boolean));

  return {
    stats: { entries: all.length, since: all.length ? all[all.length - 1].date : undefined, doctors: doctors.size, facilities: facilities.size },
    allergies, lastVisit, activeProblems, pastProblems, currentMeds, stoppedMeds, labs, imaging, surgeriesAndStays, familyHistory, openItems,
    notShared: PERMISSIONS.filter((p) => !permissions.includes(p.key)).map((p) => p.label),
  };
}
