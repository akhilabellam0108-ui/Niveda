/** Medical records on the live backend. Reads are filtered by row-level security; writes go through database functions. */
import type { MedicalRecord, PermissionKey, RecordData, RecordType } from '../../types';
import { AppError } from '../core';
import {
  buildVisitItems, checkRecord, recordService as mockRecords,
  type ConsultationBundleInput, type ConsultationBundleResult, type NewRecordInput,
} from '../recordService';
import type { NewFile } from '../documentService';
import { todayISO } from '../../lib/dates';
import { all, q, read, requireAccount, sb, write } from './client';
import { RECORD_SELECT, toRecord } from './mappers';
import { patientIdFor } from './context';
import { uploadDocument } from './documents';

export async function listRecords(patientId: string): Promise<MedicalRecord[]> {
  const rows = await all((from, to) => sb().from('records').select(RECORD_SELECT).eq('patient_id', patientId)
    .order('date', { ascending: false }).order('created_at', { ascending: false }).range(from, to));
  return rows.map(toRecord);
}

async function byIds(ids: string[]): Promise<MedicalRecord[]> {
  if (!ids.length) return [];
  const rows = await q(sb().from('records').select(RECORD_SELECT).in('id', ids));
  const map = new Map(rows.map((r) => [r.id as string, toRecord(r)]));
  return ids.map((id) => map.get(id)).filter(Boolean) as MedicalRecord[];
}

async function one(id: string): Promise<MedicalRecord> {
  const [r] = await byIds([id]);
  if (!r) throw new AppError('NOT_FOUND', 'This record could not be found, or it isn’t shared with you.');
  return r;
}

async function uploadAll(patientId: string, files: NewFile[] | undefined, date: string): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files ?? []) ids.push(await uploadDocument(patientId, f, date));
  return ids;
}

export const remoteRecordService: typeof mockRecords = {
  async list(patientId?: string): Promise<MedicalRecord[]> {
    return listRecords(await patientIdFor(patientId));
  },

  async get(recordId: string) {
    const a = await requireAccount();
    const record = await one(recordId);
    if (a.role === 'doctor') await read('log_record_view', { p_id: recordId });
    const [children, parent] = await Promise.all([
      q(sb().from('records').select(RECORD_SELECT).eq('parent_id', recordId).order('created_at')).then((rows) => rows.map(toRecord)),
      record.parentId ? byIds([record.parentId]).then((r) => r[0]) : Promise.resolve(undefined),
    ]);
    return { record, children, parent };
  },

  async logHistoryView(patientId: string): Promise<void> {
    await read('log_history_view', { p_patient: patientId });
  },

  async create(input: NewRecordInput): Promise<MedicalRecord> {
    const pid = await patientIdFor(input.patientId, false);
    const data = checkRecord(input.type, input.date, input.data);
    const docIds = [...(input.attachDocumentIds ?? []), ...(await uploadAll(pid, input.files, input.date))];
    const id = await write<string>('create_record', {
      p_patient: pid, p_type: input.type, p_date: input.date, p_data: data, p_parent: input.parentId ?? null,
      p_documents: docIds, p_reminder_times: input.reminderTimes ?? null,
    });
    return one(id);
  },

  async addConsultation(input: ConsultationBundleInput): Promise<ConsultationBundleResult> {
    const a = await requireAccount('doctor');
    const { data: me } = await sb().from('doctors').select('full_name, hospitals(name)').eq('user_id', a.id).single();
    const items = buildVisitItems(input, me?.full_name ?? '', (me?.hospitals as unknown as { name?: string } | null)?.name);
    const checked = items.map((i) => ({ ...i, data: checkRecord(i.type, i.date, i.data) }));
    const docIds = await uploadAll(input.patientId, input.files, input.date);
    const ids = await write<string[]>('add_visit', { p_patient: input.patientId, p_items: checked, p_documents: docIds });
    const created = await byIds(ids);
    return { consultation: created[0], created };
  },

  async amend(recordId: string, change: { date: string; data: RecordData; reason: string }): Promise<MedicalRecord> {
    if (!change.reason.trim()) throw new AppError('VALIDATION', 'Give a reason for the correction.');
    const current = await one(recordId);
    checkRecord(current.type, change.date, change.data);
    await write('amend_record', { p_id: recordId, p_date: change.date, p_data: change.data, p_reason: change.reason });
    return one(recordId);
  },

  async discontinueMedication(recordId: string, reason: string, date = todayISO()): Promise<void> {
    await write('discontinue_medication', { p_id: recordId, p_reason: reason, p_date: date });
  },

  async addLabResult(orderId: string, data: RecordData, date: string, files: NewFile[] = []): Promise<MedicalRecord> {
    const order = await one(orderId);
    checkRecord('lab_result', date, { laboratory: order.data.laboratory, ...data, test: data.test || order.data.test });
    const docIds = await uploadAll(order.patientId, files, date);
    const id = await write<string>('add_lab_result', { p_order: orderId, p_data: data, p_date: date, p_documents: docIds });
    return one(id);
  },

  typesDoctorCanWrite(permissions: PermissionKey[]): RecordType[] {
    return mockRecords.typesDoctorCanWrite(permissions);
  },
};
