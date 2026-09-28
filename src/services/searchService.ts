import type { Doctor, Hospital, MedicalDocument, MedicalRecord } from '../types';
import { delay } from '../mock/db';
import { fmtDate } from '../lib/dates';
import { RECORD_TYPES, recordSummary, recordTitle } from '../lib/recordMeta';
import { requireCtx } from './core';

export interface SearchResult {
  id: string;
  kind: 'record' | 'document' | 'doctor' | 'hospital' | 'page';
  title: string;
  subtitle: string;
  link: string;
}

const PAGES: SearchResult[] = [
  { id: 'pg_meds', kind: 'page', title: 'Medications', subtitle: 'Current and past medicines', link: '/app/medications' },
  { id: 'pg_allergies', kind: 'page', title: 'Allergies', subtitle: 'Allergies and reactions', link: '/app/allergies' },
  { id: 'pg_emergency', kind: 'page', title: 'Emergency profile', subtitle: 'Blood group, allergies, contact', link: '/app/emergency' },
  { id: 'pg_access', kind: 'page', title: 'Doctors & access', subtitle: 'Grant or revoke access', link: '/app/access' },
  { id: 'pg_activity', kind: 'page', title: 'Access log', subtitle: 'Who viewed or changed your record', link: '/app/activity' },
  { id: 'pg_export', kind: 'page', title: 'Export my records', subtitle: 'Download a copy', link: '/app/settings/export' },
];

/** Global search across the patient's own record. */
export async function searchPatient(query: string): Promise<SearchResult[]> {
  await delay(120);
  const ctx = await requireCtx('patient');
  const pid = ctx.patient!.id;
  const doctorIds = new Set([...ctx.db.grants.filter((g) => g.patientId === pid).map((g) => g.doctorId), ...ctx.db.records.filter((r) => r.patientId === pid && r.createdBy.role === 'doctor').map((r) => r.createdBy.id)]);
  return searchIn(query, {
    records: ctx.db.records.filter((x) => x.patientId === pid),
    documents: ctx.db.documents.filter((x) => x.patientId === pid),
    doctors: ctx.db.doctors.filter((x) => doctorIds.has(x.id)),
    hospitals: ctx.db.hospitals,
  });
}

/** Searches the patient's records, documents, their doctors and hospitals. Shared by both backends. */
export function searchIn(query: string, src: { records: MedicalRecord[]; documents: MedicalDocument[]; doctors: Doctor[]; hospitals: Hospital[] }): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const has = (...xs: (string | undefined)[]) => xs.some((x) => x && x.toLowerCase().includes(q));
  const results: SearchResult[] = [];

  for (const r of src.records) {
    const values = Object.values(r.data).map(String);
    if (has(recordTitle(r), RECORD_TYPES[r.type].label, r.createdBy.name, r.organization?.name, r.date, fmtDate(r.date), ...values)) {
      results.push({ id: r.id, kind: 'record', title: recordTitle(r), subtitle: `${RECORD_TYPES[r.type].label} · ${fmtDate(r.date)}${recordSummary(r) ? ` · ${recordSummary(r)}` : ''}`, link: `?record=${r.id}` });
    }
  }
  for (const d of src.documents) {
    if (has(d.name, d.date, fmtDate(d.date))) results.push({ id: d.id, kind: 'document', title: d.name, subtitle: `Document · ${fmtDate(d.date)}`, link: `/app/reports?doc=${d.id}` });
  }
  for (const d of src.doctors) {
    const h = src.hospitals.find((x) => x.id === d.hospitalId);
    if (has(d.fullName, d.specialization, h?.name)) results.push({ id: d.id, kind: 'doctor', title: d.fullName, subtitle: `${d.specialization} · ${h?.name}`, link: `/app/records?doctor=${encodeURIComponent(d.fullName)}` });
  }
  const hospitalNames = new Set(src.records.flatMap((r) => [r.organization?.name, r.data.facility as string | undefined]).filter(Boolean) as string[]);
  for (const h of hospitalNames) if (has(h)) results.push({ id: `h_${h}`, kind: 'hospital', title: h, subtitle: 'Hospital / clinic', link: `/app/records?hospital=${encodeURIComponent(h)}` });
  for (const pg of PAGES) if (has(pg.title, pg.subtitle)) results.push(pg);
  return results.slice(0, 30);
}
