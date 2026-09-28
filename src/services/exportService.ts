import type { MedicalDocument, MedicalRecord, Patient, RecordType } from '../types';
import { delay, mutate } from '../mock/db';
import { fmtDate, fmtDateTime, nowISO, todayISO } from '../lib/dates';
import { RECORD_TYPES, fieldLabel, recordTitle } from '../lib/recordMeta';
import { brand } from '../config/brand';
import { audit, requireCtx } from './core';
import { DOC_CATEGORY_LABEL } from './documentService';

export const EXPORT_SCOPES: { key: string; label: string; types: RecordType[] | 'all' }[] = [
  { key: 'all', label: 'Complete record', types: 'all' },
  { key: 'consultations', label: 'Consultations', types: ['consultation', 'follow_up', 'clinical_note', 'diagnosis'] },
  { key: 'medications', label: 'Medications', types: ['medication'] },
  { key: 'reports', label: 'Reports & documents', types: [] },
  { key: 'labs', label: 'Lab results', types: ['lab_test', 'lab_result'] },
  { key: 'imaging', label: 'Imaging', types: ['imaging'] },
  { key: 'surgeries', label: 'Surgeries & procedures', types: ['surgery', 'procedure', 'hospitalization'] },
  { key: 'vaccinations', label: 'Vaccinations', types: ['vaccination'] },
];

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const exportService = {
  /**
   * Prototype: builds the file in the browser. In production the server would
   * prepare the export, then deliver it through an expiring, authenticated link.
   */
  async build(scopes: string[], format: 'json' | 'html'): Promise<{ filename: string; blob: Blob; count: number }> {
    await delay(700);
    const ctx = await requireCtx('patient');
    const p = ctx.patient!;
    const out = buildExport(p, ctx.db.records.filter((r) => r.patientId === p.id), ctx.db.documents.filter((d) => d.patientId === p.id), scopes, format);
    await mutate((db) => audit(db, { patientId: p.id, actor: ctx.actor, action: 'export_created', target: { type: 'export', label: out.label }, metadata: { records: out.records, documents: out.documents } }));
    return { filename: out.filename, blob: out.blob, count: out.records + out.documents };
  },
};

/**
 * Builds the export file from the patient's records and documents. Shared by the
 * demo and live backends. In production the server would also bundle the files
 * themselves and offer FHIR R4.
 */
export function buildExport(p: Patient, allRecords: MedicalRecord[], allDocs: MedicalDocument[], scopes: string[], format: 'json' | 'html') {
  const all = scopes.includes('all');
  const types = new Set<RecordType>(all ? (Object.keys(RECORD_TYPES) as RecordType[]) : EXPORT_SCOPES.filter((s) => scopes.includes(s.key)).flatMap((s) => (s.types === 'all' ? [] : s.types)));
  const includeDocs = all || scopes.includes('reports');
  const records = allRecords.filter((r) => types.has(r.type)).sort((a, b) => a.date.localeCompare(b.date));
  const docs = includeDocs ? allDocs : [];
  const stamp = todayISO();
  let blob: Blob;
  let filename: string;
  if (format === 'json') {
    const payload = {
      exportedAt: nowISO(), product: brand.name, formatVersion: 1,
      note: 'A production export would also be offered as FHIR R4 bundle.',
      patient: { patientId: p.patientCode, name: p.fullName, dateOfBirth: p.dateOfBirth, bloodGroup: p.bloodGroup ?? null, emergencyContact: p.emergencyContact ?? null },
      records: records.map((r) => ({ id: r.id, type: r.type, date: r.date, data: r.data, addedBy: r.createdBy, organization: r.organization?.name ?? null, createdAt: r.createdAt, version: r.version, history: r.versions, attachments: r.attachments })),
      documents: docs.map((d) => ({ id: d.id, name: d.name, category: d.category, date: d.date, recordId: d.recordId ?? null, uploadedBy: d.uploadedBy.name, note: 'File contents are delivered separately.' })),
    };
    blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    filename = `${brand.name.toLowerCase()}-record-${stamp}.json`;
  } else {
    blob = new Blob([renderHtml(p.fullName, p.patientCode, p.dateOfBirth, p.bloodGroup, records, docs.map((d) => `${fmtDate(d.date)} — ${d.name} (${DOC_CATEGORY_LABEL[d.category]})`))], { type: 'text/html' });
    filename = `${brand.name.toLowerCase()}-record-${stamp}.html`;
  }
  const label = `${format.toUpperCase()} · ${all ? 'Complete record' : scopes.map((s) => EXPORT_SCOPES.find((x) => x.key === s)?.label).join(', ')}`;
  return { filename, blob, label, records: records.length, documents: docs.length };
}

function renderHtml(name: string, code: string, dob: string, blood: string | undefined, records: MedicalRecord[], docs: string[]): string {
  const rows = records.map((r) => {
    const fields = Object.entries(r.data)
      .filter(([k]) => !['medStatus', 'resultRecordId', 'orderRecordId'].includes(k))
      .map(([k, v]) => `<div><b>${escapeHtml(k === 'discontinuedOn' ? 'Stopped on' : k === 'discontinueReason' ? 'Reason stopped' : fieldLabel(r.type, k))}:</b> ${escapeHtml(String(v))}</div>`).join('');
    return `<section><h3>${fmtDate(r.date)} · ${escapeHtml(RECORD_TYPES[r.type].label)} — ${escapeHtml(recordTitle(r))}</h3>${fields}<p class="by">Added by ${escapeHtml(r.createdBy.name)}${r.organization ? `, ${escapeHtml(r.organization.name)}` : ''} on ${fmtDateTime(r.createdAt)}${r.version > 1 ? ` · version ${r.version}` : ''}</p></section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)} — health record</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#1b2420;max-width:760px;margin:40px auto;padding:0 20px}h1{font-size:22px;margin:0}h3{font-size:15px;margin:0 0 6px}section{border-top:1px solid #dfe5e1;padding:14px 0}.by{color:#5c6b64;font-size:12px;margin:6px 0 0}.meta{color:#5c6b64}@media print{body{margin:0}}</style></head>
<body><h1>${escapeHtml(name)}</h1><p class="meta">Patient ID ${escapeHtml(code)} · Born ${fmtDate(dob)}${blood ? ` · Blood group ${escapeHtml(blood)}` : ''}<br>Exported from ${brand.name} on ${fmtDateTime(nowISO())}. Use your browser’s Print → Save as PDF to keep a PDF copy.</p>
${rows || '<p>No records in this selection.</p>'}
${docs.length ? `<section><h3>Documents</h3>${docs.map((d) => `<div>${escapeHtml(d)}</div>`).join('')}</section>` : ''}
</body></html>`;
}
