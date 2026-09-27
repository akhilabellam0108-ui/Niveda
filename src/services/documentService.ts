import type { DocumentCategory, MedicalDocument, PermissionKey } from '../types';
import { delay, mutate, mutateQuiet } from '../mock/db';
import { deleteBlob, getBlob, putBlob } from '../mock/blobStore';
import { makeTextPdf } from '../mock/pdf';
import { nowISO, todayISO } from '../lib/dates';
import { uid } from '../lib/ids';
import { RECORD_TYPES, recordTitle } from '../lib/recordMeta';
import { brand } from '../config/brand';
import { AppError, audit, recentlyLogged, requireCtx, requireGrant, type Ctx } from './core';

export interface NewFile {
  name: string;
  type: string;
  blob: Blob;
  category: DocumentCategory;
}

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'text/plain'];
export const ACCEPT_ATTR = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.txt,application/pdf,image/*,text/plain';

export const DOC_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  report: 'Lab report', prescription: 'Prescription', scan: 'Scan / imaging', image: 'Photo', discharge: 'Discharge summary', other: 'Other',
};

/** Unattached documents are gated by a permission that matches their category. */
const CATEGORY_PERMISSION: Record<DocumentCategory, PermissionKey> = {
  report: 'labs', prescription: 'medications', scan: 'imaging', image: 'history', discharge: 'history', other: 'sensitive',
};

export function guessCategory(file: { name: string; type: string }): DocumentCategory {
  const n = file.name.toLowerCase();
  if (/(rx|prescription)/.test(n)) return 'prescription';
  if (/(discharge)/.test(n)) return 'discharge';
  if (/(x-?ray|mri|ct|scan|ultrasound|usg)/.test(n)) return 'scan';
  if (/(report|lab|cbc|blood|test)/.test(n)) return 'report';
  if (file.type.startsWith('image/')) return 'image';
  return 'other';
}

export function validateFile(f: { name: string; type: string; size: number }) {
  if (f.size > MAX_FILE_BYTES) throw new AppError('VALIDATION', `${f.name} is larger than 15 MB.`);
  if (f.type && !ACCEPTED_TYPES.includes(f.type) && !f.type.startsWith('image/')) throw new AppError('VALIDATION', `${f.name}: use PDF, image or text files.`);
}

/** Saves a file and its metadata. Callers link it to a record. */
export async function storeFile(ctx: Ctx, patientId: string, f: NewFile, date: string, recordId?: string): Promise<string> {
  validateFile({ name: f.name, type: f.type, size: f.blob.size });
  const id = uid('doc');
  await putBlob(id, f.blob);
  const doc: MedicalDocument = {
    id, patientId, name: f.name, mimeType: f.type || 'application/octet-stream', size: f.blob.size, category: f.category,
    date: date || todayISO(), recordId, uploadedBy: ctx.actor, uploadedAt: nowISO(),
  };
  await mutateQuiet((db) => {
    db.documents.push(doc);
    audit(db, { patientId, actor: ctx.actor, action: 'document_uploaded', target: { type: 'document', id, label: f.name } });
  });
  return id;
}

function visibleDocs(ctx: Ctx, patientId: string): MedicalDocument[] {
  const docs = ctx.db.documents.filter((d) => d.patientId === patientId);
  if (ctx.user.role === 'patient') {
    if (ctx.patient!.id !== patientId) throw new AppError('ACCESS_DENIED', 'You can only view your own documents.');
    return docs;
  }
  const g = requireGrant(ctx.db, ctx.doctor!.id, patientId);
  return docs.filter((d) => {
    const rec = d.recordId ? ctx.db.records.find((r) => r.id === d.recordId) : undefined;
    const perm = rec ? RECORD_TYPES[rec.type].permission : CATEGORY_PERMISSION[d.category];
    return g.permissions.includes(perm);
  });
}

export interface DocumentView extends MedicalDocument {
  recordLabel?: string;
}

export const documentService = {
  async list(patientId?: string): Promise<DocumentView[]> {
    await delay();
    const ctx = await requireCtx();
    const pid = patientId ?? ctx.patient?.id;
    if (!pid) throw new AppError('VALIDATION', 'Choose a patient.');
    return visibleDocs(ctx, pid)
      .map((d) => {
        const rec = d.recordId ? ctx.db.records.find((r) => r.id === d.recordId) : undefined;
        return { ...d, recordLabel: rec ? `${RECORD_TYPES[rec.type].label}: ${recordTitle(rec)}` : undefined };
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.uploadedAt.localeCompare(a.uploadedAt));
  },

  async upload(input: { file: NewFile; date: string; recordId?: string; patientId?: string }): Promise<string> {
    await delay();
    const ctx = await requireCtx();
    const pid = input.patientId ?? ctx.patient?.id;
    if (!pid) throw new AppError('VALIDATION', 'Choose a patient.');
    if (ctx.doctor) requireGrant(ctx.db, ctx.doctor.id, pid, CATEGORY_PERMISSION[input.file.category]);
    else if (ctx.patient!.id !== pid) throw new AppError('ACCESS_DENIED', 'You can only upload to your own record.');
    const id = await storeFile(ctx, pid, input.file, input.date);
    if (input.recordId) await this.attach(id, input.recordId);
    else await mutate(() => undefined);
    return id;
  },

  async attach(documentId: string, recordId: string | undefined): Promise<void> {
    const ctx = await requireCtx();
    await mutate((db) => {
      const d = db.documents.find((x) => x.id === documentId);
      if (!d) throw new AppError('NOT_FOUND', 'Document not found.');
      if (ctx.patient && d.patientId !== ctx.patient.id) throw new AppError('ACCESS_DENIED', 'Not your document.');
      if (ctx.doctor) requireGrant(db, ctx.doctor.id, d.patientId);
      if (d.recordId) {
        const old = db.records.find((r) => r.id === d.recordId);
        if (old) old.attachments = old.attachments.filter((a) => a !== d.id);
      }
      d.recordId = recordId;
      if (recordId) {
        const rec = db.records.find((r) => r.id === recordId && r.patientId === d.patientId);
        if (!rec) throw new AppError('NOT_FOUND', 'Record not found.');
        if (!rec.attachments.includes(d.id)) rec.attachments.push(d.id);
      }
    });
  },

  /** Returns the file. Doctor reads are logged. In production this would be a short-lived signed URL. */
  async open(documentId: string): Promise<{ doc: MedicalDocument; blob: Blob }> {
    await delay(200);
    const ctx = await requireCtx();
    const d = ctx.db.documents.find((x) => x.id === documentId);
    if (!d) throw new AppError('NOT_FOUND', 'This document could not be found.');
    if (!visibleDocs(ctx, d.patientId).some((x) => x.id === d.id)) throw new AppError('ACCESS_DENIED', 'You don’t have access to this document.');
    let blob = await getBlob(d.id);
    if (!blob && d.generated) {
      blob = makeTextPdf(d.generated.title, d.generated.lines, `${brand.name} demo document - fictional data`);
      await putBlob(d.id, blob);
    }
    if (!blob) throw new AppError('NOT_FOUND', 'The file for this document is missing on this device.');
    if (ctx.doctor && !recentlyLogged(ctx.db, ctx.actor.id, 'viewed_document', d.id, d.patientId)) await mutateQuiet((db) => audit(db, { patientId: d.patientId, actor: ctx.actor, action: 'viewed_document', target: { type: 'document', id: d.id, label: d.name } }));
    return { doc: d, blob };
  },

  async remove(documentId: string): Promise<void> {
    await delay();
    const ctx = await requireCtx('patient');
    const d = ctx.db.documents.find((x) => x.id === documentId && x.patientId === ctx.patient!.id);
    if (!d) throw new AppError('NOT_FOUND', 'This document could not be found.');
    if (d.uploadedBy.role === 'doctor') throw new AppError('ACCESS_DENIED', 'Documents added by a doctor stay with the record they belong to.');
    await deleteBlob(d.id);
    await mutate((db) => {
      db.documents = db.documents.filter((x) => x.id !== documentId);
      for (const r of db.records) r.attachments = r.attachments.filter((a) => a !== documentId);
      audit(db, { patientId: d.patientId, actor: ctx.actor, action: 'document_deleted', target: { type: 'document', id: d.id, label: d.name } });
    });
  },
};
