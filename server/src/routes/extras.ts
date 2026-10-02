import { Router } from 'express';
import { z } from 'zod';
import type { SearchResult, ServerConfig } from '@shared/api';
import { DOC_CATEGORY_LABEL, EXPORT_SCOPES } from '@shared/api';
import type { MedicalRecord, RecordType } from '@shared/types';
import { RECORD_TYPES, fieldLabel, recordSummary, recordTitle } from '@shared/recordMeta';
import { fmtDate, todayISO } from '@shared/dates';
import { brand } from '@shared/brand';
import { config } from '../config';
import { json } from '../db/db';
import { toDocument } from '../db/mappers';
import { audit, ctxOf, h } from '../core';
import { loadRecords } from '../services/records';
import { initPush } from '../services/push';
import { DEMO_ACCOUNTS } from '../db/demo';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmtStamp = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function renderHtml(p: { fullName: string; patientCode: string; dateOfBirth: string; bloodGroup?: string }, records: MedicalRecord[], docs: string[]) {
  const rows = records.map((r) => {
    const fields = Object.entries(r.data)
      .filter(([k]) => !['medStatus', 'resultRecordId', 'orderRecordId'].includes(k))
      .map(([k, v]) => `<div><b>${esc(k === 'discontinuedOn' ? 'Stopped on' : k === 'discontinueReason' ? 'Reason stopped' : fieldLabel(r.type, k))}:</b> ${esc(String(v))}</div>`).join('');
    return `<section><h3>${fmtDate(r.date)} · ${esc(RECORD_TYPES[r.type].label)} — ${esc(recordTitle(r))}</h3>${fields}<p class="by">Added by ${esc(r.createdBy.name)}${r.organization ? `, ${esc(r.organization.name)}` : ''} on ${fmtStamp(r.createdAt)}${r.version > 1 ? ` · version ${r.version}` : ''}</p></section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.fullName)} — health record</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#1b2420;max-width:760px;margin:40px auto;padding:0 20px}h1{font-size:22px;margin:0}h3{font-size:15px;margin:0 0 6px}section{border-top:1px solid #dfe5e1;padding:14px 0}.by{color:#5c6b64;font-size:12px;margin:6px 0 0}.meta{color:#5c6b64}@media print{body{margin:0}}</style></head>
<body><h1>${esc(p.fullName)}</h1><p class="meta">Patient ID ${esc(p.patientCode)} · Born ${fmtDate(p.dateOfBirth)}${p.bloodGroup ? ` · Blood group ${esc(p.bloodGroup)}` : ''}<br>Exported from ${brand.name} on ${fmtStamp(new Date().toISOString())}. Use your browser’s Print → Save as PDF to keep a PDF copy.</p>
${rows || '<p>No records in this selection.</p>'}
${docs.length ? `<section><h3>Documents</h3>${docs.map((d) => `<div>${esc(d)}</div>`).join('')}</section>` : ''}
</body></html>`;
}

const PAGES: SearchResult[] = [
  { id: 'pg_meds', kind: 'page', title: 'Medications', subtitle: 'Current and past medicines', link: '/app/medications' },
  { id: 'pg_allergies', kind: 'page', title: 'Allergies', subtitle: 'Allergies and reactions', link: '/app/allergies' },
  { id: 'pg_emergency', kind: 'page', title: 'Emergency profile', subtitle: 'Blood group, allergies, contact', link: '/app/emergency' },
  { id: 'pg_access', kind: 'page', title: 'Doctors & access', subtitle: 'Grant or revoke access', link: '/app/access' },
  { id: 'pg_activity', kind: 'page', title: 'Access log', subtitle: 'Who viewed or changed your record', link: '/app/activity' },
  { id: 'pg_export', kind: 'page', title: 'Export my records', subtitle: 'Download a copy', link: '/app/settings/export' },
];

export function extraRoutes() {
  const r = Router();

  /** Global search across the signed-in patient's own record. */
  r.get('/search', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const q = String(req.query.q ?? '').trim().toLowerCase();
    if (q.length < 2) { res.json([]); return; }
    const pid = ctx.patient!.id;
    const has = (...xs: (string | undefined)[]) => xs.some((x) => x && x.toLowerCase().includes(q));
    const out: SearchResult[] = [];
    const records = await loadRecords(ctx.db, pid);
    for (const x of records) {
      if (has(recordTitle(x), RECORD_TYPES[x.type].label, x.createdBy.name, x.organization?.name, x.date, fmtDate(x.date), ...Object.values(x.data).map(String))) {
        out.push({ id: x.id, kind: 'record', title: recordTitle(x), subtitle: `${RECORD_TYPES[x.type].label} · ${fmtDate(x.date)}${recordSummary(x) ? ` · ${recordSummary(x)}` : ''}`, link: `?record=${x.id}` });
      }
    }
    for (const d of (await ctx.db.query('SELECT * FROM documents WHERE patient_id = $1', [pid])).map(toDocument)) {
      if (has(d.name, d.date, fmtDate(d.date))) out.push({ id: d.id, kind: 'document', title: d.name, subtitle: `Document · ${fmtDate(d.date)}`, link: `/app/reports?doc=${d.id}` });
    }
    const docs = await ctx.db.query(
      `SELECT DISTINCT d.id, d.full_name, d.specialization, h.name AS hospital FROM doctors d JOIN hospitals h ON h.id = d.hospital_id
       WHERE d.id IN (SELECT doctor_id FROM access_grants WHERE patient_id = $1 UNION SELECT created_by->>'id' FROM records WHERE patient_id = $1)`, [pid]);
    for (const d of docs) if (has(d.full_name as string, d.specialization as string, d.hospital as string)) out.push({ id: d.id as string, kind: 'doctor', title: d.full_name as string, subtitle: `${d.specialization} · ${d.hospital}`, link: `/app/records?doctor=${encodeURIComponent(d.full_name as string)}` });
    const hospitals = new Set(records.flatMap((x) => [x.organization?.name, x.data.facility as string | undefined]).filter(Boolean) as string[]);
    for (const hn of hospitals) if (has(hn)) out.push({ id: `h_${hn}`, kind: 'hospital', title: hn, subtitle: 'Hospital / clinic', link: `/app/records?hospital=${encodeURIComponent(hn)}` });
    for (const pg of PAGES) if (has(pg.title, pg.subtitle)) out.push(pg);
    res.json(out.slice(0, 30));
  }));

  /** Download a copy of the record. Logged in the access log. */
  r.post('/export', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const p = z.object({ scopes: z.array(z.string()).min(1), format: z.enum(['json', 'html']) }).parse(req.body);
    const patient = ctx.patient!;
    const all = p.scopes.includes('all');
    const types = new Set<RecordType>(all ? (Object.keys(RECORD_TYPES) as RecordType[]) : EXPORT_SCOPES.filter((s) => p.scopes.includes(s.key)).flatMap((s) => (s.types === 'all' ? [] : s.types)));
    const records = (await loadRecords(ctx.db, patient.id)).filter((x) => types.has(x.type)).sort((a, b) => a.date.localeCompare(b.date));
    const docs = all || p.scopes.includes('reports') ? (await ctx.db.query('SELECT * FROM documents WHERE patient_id = $1 ORDER BY date', [patient.id])).map(toDocument) : [];
    await audit(ctx.db, { patientId: patient.id, actor: ctx.actor, action: 'export_created', ip: ctx.ip, target: { type: 'export', label: `${p.format.toUpperCase()} · ${all ? 'Complete record' : p.scopes.map((s) => EXPORT_SCOPES.find((x) => x.key === s)?.label).join(', ')}` }, metadata: { records: records.length, documents: docs.length } });
    const stamp = todayISO();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Item-Count', String(records.length + docs.length));
    if (p.format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="${brand.name.toLowerCase()}-record-${stamp}.json"`);
      res.json({
        exportedAt: new Date().toISOString(), product: brand.name, formatVersion: 1,
        patient: { patientId: patient.patientCode, name: patient.fullName, dateOfBirth: patient.dateOfBirth, bloodGroup: patient.bloodGroup ?? null, emergencyContact: patient.emergencyContact ?? null },
        records: records.map((x) => ({ id: x.id, type: x.type, date: x.date, data: x.data, addedBy: x.createdBy, organization: x.organization?.name ?? null, createdAt: x.createdAt, version: x.version, history: x.versions, attachments: x.attachments })),
        documents: docs.map((d) => ({ id: d.id, name: d.name, category: d.category, date: d.date, recordId: d.recordId ?? null, uploadedBy: d.uploadedBy.name, download: `/api/documents/${d.id}/file?download=1` })),
      });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${brand.name.toLowerCase()}-record-${stamp}.html"`);
    res.send(renderHtml(patient, records, docs.map((d) => `${fmtDate(d.date)} — ${d.name} (${DOC_CATEGORY_LABEL[d.category]})`)));
  }));

  r.post('/push/subscribe', h(async (req, res) => {
    const ctx = ctxOf(req);
    const p = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).parse(req.body);
    await ctx.db.query('INSERT INTO push_subscriptions (endpoint, user_id, keys) VALUES ($1,$2,$3::jsonb) ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, keys = EXCLUDED.keys', [p.endpoint, ctx.user.id, json(p.keys)]);
    res.json({ ok: true });
  }));

  r.post('/push/unsubscribe', h(async (req, res) => {
    const ctx = ctxOf(req);
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await ctx.db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, ctx.user.id]);
    res.json({ ok: true });
  }));

  return r;
}

/** Public: what the web app needs to know about this server. */
export function publicConfig(): ServerConfig {
  return {
    demo: config.seedDemo,
    otpDevEcho: config.otpDevEcho,
    otpChannel: config.otpChannel,
    pushPublicKey: initPush() || undefined,
    demoAccounts: config.seedDemo ? DEMO_ACCOUNTS : undefined,
    demoPassword: config.seedDemo ? config.demoPassword : undefined,
  };
}
