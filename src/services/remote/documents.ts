/** Documents in the private "documents" storage bucket, with access checked by the database. */
import type { MedicalDocument } from '../../types';
import { AppError } from '../core';
import { RECORD_TYPES, recordTitle } from '../../lib/recordMeta';
import { validateFile, type documentService as MockDocs, type DocumentView, type NewFile } from '../documentService';
import { all, emit, q, read, requireAccount, sb, write } from './client';
import { toDocument } from './mappers';
import { patientIdFor } from './context';

const BUCKET = 'documents';

function newDocId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `doc_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Uploads the file, then records it (the database checks access for both steps). Returns the document id. */
export async function uploadDocument(patientId: string, f: NewFile, date: string, recordId?: string): Promise<string> {
  validateFile({ name: f.name, type: f.type, size: f.blob.size });
  const id = newDocId();
  const path = `${patientId}/${id}`;
  const contentType = f.type || 'application/octet-stream';
  const { error } = await sb().storage.from(BUCKET).upload(path, f.blob, { contentType, upsert: false });
  if (error) {
    if (/row-level security|unauthorized|403/i.test(error.message)) throw new AppError('ACCESS_DENIED', 'You don’t have permission to add documents to this record.');
    if (/mime|type/i.test(error.message)) throw new AppError('VALIDATION', `${f.name}: use PDF, image or text files.`);
    if (/size|large/i.test(error.message)) throw new AppError('VALIDATION', `${f.name} is larger than 15 MB.`);
    throw new AppError('UNKNOWN', `${f.name} couldn’t be uploaded. Check your connection and try again.`);
  }
  try {
    await read('register_document', {
      p_patient: patientId, p_id: id, p_name: f.name, p_mime: contentType, p_size: f.blob.size,
      p_category: f.category, p_date: date || new Date().toISOString().slice(0, 10), p_record: recordId ?? null,
    });
  } catch (e) {
    await sb().storage.from(BUCKET).remove([path]).catch(() => undefined);
    throw e;
  }
  return id;
}

export const remoteDocumentService: typeof MockDocs = {
  async list(patientId?: string): Promise<DocumentView[]> {
    const pid = await patientIdFor(patientId);
    const docs = (await all((from, to) => sb().from('documents').select('*').eq('patient_id', pid).range(from, to))).map(toDocument);
    const recordIds = [...new Set(docs.map((d) => d.recordId).filter(Boolean) as string[])];
    const recs = recordIds.length ? await q(sb().from('records').select('id, type, data').in('id', recordIds)) : [];
    const label = new Map(recs.map((r: { id: string; type: keyof typeof RECORD_TYPES; data: Record<string, string> }) => [r.id, `${RECORD_TYPES[r.type].label}: ${recordTitle(r)}`]));
    return docs
      .map((d) => ({ ...d, recordLabel: d.recordId ? label.get(d.recordId) : undefined }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.uploadedAt.localeCompare(a.uploadedAt));
  },

  async upload(input: { file: NewFile; date: string; recordId?: string; patientId?: string }): Promise<string> {
    const pid = await patientIdFor(input.patientId, false);
    const id = await uploadDocument(pid, input.file, input.date, input.recordId);
    emit();
    return id;
  },

  async attach(documentId: string, recordId: string | undefined): Promise<void> {
    await write('attach_document', { p_doc: documentId, p_record: recordId ?? null });
  },

  async open(documentId: string): Promise<{ doc: MedicalDocument; blob: Blob }> {
    const a = await requireAccount();
    const rows = await q(sb().from('documents').select('*').eq('id', documentId));
    if (!rows.length) throw new AppError('ACCESS_DENIED', 'This document isn’t available — it may have been removed, or it isn’t shared with you.');
    const doc = toDocument(rows[0]);
    if (a.role === 'doctor') await read('log_document_view', { p_doc: documentId });
    const { data, error } = await sb().storage.from(BUCKET).download(`${doc.patientId}/${doc.id}`);
    if (error || !data) throw new AppError('NOT_FOUND', 'The file for this document couldn’t be downloaded. Please try again.');
    return { doc, blob: data };
  },

  async remove(documentId: string): Promise<void> {
    const path = await write<string>('delete_document', { p_doc: documentId });
    await sb().storage.from(BUCKET).remove([path]).catch(() => undefined);
  },
};
