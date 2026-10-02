import { Router } from 'express';
import { z } from 'zod';
import type { DocumentView } from '@shared/api';
import { AppError, CATEGORY_PERMISSION } from '@shared/api';
import type { AccessGrant, MedicalDocument } from '@shared/types';
import { RECORD_TYPES, recordTitle } from '@shared/recordMeta';
import { toDocument } from '../db/mappers';
import { audit, ctxOf, h, recentlyLogged, requireGrant, resolvePatient, touchPatient, type Ctx } from '../core';
import { getFile, removeFile } from '../services/storage';
import { loadRecords, storeUploads, withUploads } from '../services/records';
import { payloadOf, upload, uploadsOf } from './uploads';

/** Documents the caller may see. A doctor sees a document only if its record's category (or its own category) is shared. */
export async function visibleDocuments(ctx: Ctx, patientId: string, grant?: AccessGrant): Promise<DocumentView[]> {
  const rows = await ctx.db.query('SELECT * FROM documents WHERE patient_id = $1 ORDER BY date DESC, uploaded_at DESC', [patientId]);
  const records = await loadRecords(ctx.db, patientId);
  const docs = rows.map(toDocument);
  const allowed = (d: MedicalDocument) => {
    if (!grant) return true;
    const rec = d.recordId ? records.find((r) => r.id === d.recordId) : undefined;
    return grant.permissions.includes(rec ? RECORD_TYPES[rec.type].permission : CATEGORY_PERMISSION[d.category]);
  };
  return docs.filter(allowed).map((d) => {
    const rec = d.recordId ? records.find((r) => r.id === d.recordId) : undefined;
    return { ...d, recordLabel: rec ? `${RECORD_TYPES[rec.type].label}: ${recordTitle(rec)}` : undefined };
  });
}

async function docFor(ctx: Ctx, id: string) {
  const row = await ctx.db.one('SELECT * FROM documents WHERE id = $1', [id]);
  if (!row) throw new AppError('NOT_FOUND', 'This document could not be found.');
  const doc = toDocument(row);
  const { grant } = await resolvePatient(ctx, doc.patientId);
  if (!(await visibleDocuments(ctx, doc.patientId, grant)).some((d) => d.id === id)) throw new AppError('ACCESS_DENIED', 'You don’t have access to this document.');
  return { doc, storageKey: String(row.storage_key) };
}

export function documentRoutes() {
  const r = Router();

  r.get('/', h(async (req, res) => {
    const ctx = ctxOf(req);
    const { patientId, grant } = await resolvePatient(ctx, req.query.patientId as string | undefined);
    res.json(await visibleDocuments(ctx, patientId, grant));
  }));

  r.post('/', upload.array('files'), h(async (req, res) => {
    const ctx = ctxOf(req);
    const p = z.object({
      patientId: z.string().optional(), recordId: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      files: z.array(z.object({ name: z.string().max(200), category: z.string(), date: z.string().optional() })).min(1),
    }).parse(payloadOf(req));
    const { patientId } = await resolvePatient(ctx, p.patientId);
    const uploads = uploadsOf(req, p.files as never);
    if (!uploads.length) throw new AppError('VALIDATION', 'Choose at least one file.');
    if (ctx.doctor) for (const u of uploads) await requireGrant(ctx.db, ctx.doctor.id, patientId, CATEGORY_PERMISSION[u.meta.category]);
    if (p.recordId && !(await ctx.db.one('SELECT 1 FROM records WHERE id = $1 AND patient_id = $2', [p.recordId, patientId]))) throw new AppError('NOT_FOUND', 'The linked entry wasn’t found.');
    const ids = await withUploads(ctx.db, (q, written) => storeUploads(q, ctx, patientId, uploads, p.date, p.recordId, written));
    await touchPatient(ctx.db, patientId);
    res.json({ ids });
  }));

  r.patch('/:id', h(async (req, res) => {
    const ctx = ctxOf(req);
    const { recordId } = z.object({ recordId: z.string().nullable() }).parse(req.body);
    const { doc } = await docFor(ctx, req.params.id);
    if (recordId && !(await ctx.db.one('SELECT 1 FROM records WHERE id = $1 AND patient_id = $2', [recordId, doc.patientId]))) throw new AppError('NOT_FOUND', 'Record not found.');
    await ctx.db.query('UPDATE documents SET record_id = $2 WHERE id = $1', [doc.id, recordId]);
    await touchPatient(ctx.db, doc.patientId);
    res.json({ ok: true });
  }));

  r.get('/:id', h(async (req, res) => {
    const ctx = ctxOf(req);
    const { doc } = await docFor(ctx, req.params.id);
    res.json(doc);
  }));

  /** Streams the decrypted file after a permission check. Doctor views are logged. Never cached. */
  r.get('/:id/file', h(async (req, res) => {
    const ctx = ctxOf(req);
    const { doc, storageKey } = await docFor(ctx, req.params.id);
    let data: Buffer;
    try { data = await getFile(storageKey); } catch { throw new AppError('NOT_FOUND', 'The file for this document is missing.'); }
    if (ctx.doctor && !(await recentlyLogged(ctx.db, ctx.actor.id, 'viewed_document', doc.id, doc.patientId))) {
      await audit(ctx.db, { patientId: doc.patientId, actor: ctx.actor, action: 'viewed_document', target: { type: 'document', id: doc.id, label: doc.name }, ip: ctx.ip });
    }
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(doc.name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.end(data);
  }));

  r.delete('/:id', h(async (req, res) => {
    const ctx = ctxOf(req, 'patient');
    const row = await ctx.db.one('SELECT * FROM documents WHERE id = $1 AND patient_id = $2', [req.params.id, ctx.patient!.id]);
    if (!row) throw new AppError('NOT_FOUND', 'This document could not be found.');
    const doc = toDocument(row);
    if (doc.uploadedBy.role === 'doctor') throw new AppError('ACCESS_DENIED', 'Documents added by a doctor stay with the record they belong to.');
    await ctx.db.tx(async (q) => {
      await q.query('DELETE FROM documents WHERE id = $1', [doc.id]);
      await audit(q, { patientId: doc.patientId, actor: ctx.actor, action: 'document_deleted', target: { type: 'document', id: doc.id, label: doc.name }, ip: ctx.ip });
    });
    await removeFile(String(row.storage_key));
    await touchPatient(ctx.db, doc.patientId);
    res.json({ ok: true });
  }));

  return r;
}
