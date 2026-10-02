/** Medicines, notifications, audit log, settings, export and search on the live backend. */
import type { AuditLog, DoseLog, Hospital, Notification, Preferences } from '../../types';
import { AppError } from '../core';
import { now, todayISO } from '../../lib/dates';
import { adherence, dosesFor, normaliseTimes, type Dose } from '../../lib/reminders';
import { buildCalendar, type MedicationSchedule, type medicationService as MockMeds } from '../medicationService';
import type { notificationService as MockNotifications } from '../notificationService';
import type { auditService as MockAudit } from '../auditService';
import { DEFAULT_PREFS, type settingsService as MockSettings } from '../settingsService';
import { buildExport, type exportService as MockExport } from '../exportService';
import { searchIn, type SearchResult } from '../searchService';
import { all, emit, nowIso, q, read, requireAccount, sb, subscribe, write } from './client';
import { toAudit, toDoctor, toDocument, toDoseLog, toHospital, toNotification, toPatient, toReminder } from './mappers';
import { listRecords } from './records';

/* ---------------- medicines ---------------- */

async function medicineData(sinceDays = 8) {
  const a = await requireAccount('patient');
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const [records, reminders, logs] = await Promise.all([
    listRecords(a.profileId),
    q(sb().from('medication_reminders').select('*').eq('patient_id', a.profileId)).then((r) => r.map(toReminder)),
    q(sb().from('dose_logs').select('*').eq('patient_id', a.profileId).gte('date', since)).then((r) => r.map(toDoseLog)),
  ]);
  return { patientId: a.profileId, records, reminders, logs };
}

const isActive = (r: { type: string; data: Record<string, unknown> }, today: string) =>
  r.type === 'medication' && r.data.medStatus !== 'discontinued' && (!r.data.endDate || String(r.data.endDate) >= today);

export const remoteMedicationService: typeof MockMeds = {
  async today(): Promise<Dose[]> {
    const { records, reminders, logs } = await medicineData(1);
    return dosesFor(todayISO(), records, reminders, logs, now());
  },

  async logDose(recordId: string, date: string, time: string, status: DoseLog['status']) {
    const a = await requireAccount('patient');
    await q(sb().from('dose_logs').upsert({ patient_id: a.profileId, record_id: recordId, date, time, status, logged_at: nowIso() }, { onConflict: 'record_id,date,time' }));
    emit();
  },

  async undoDose(recordId: string, date: string, time: string) {
    await requireAccount('patient');
    await q(sb().from('dose_logs').delete().eq('record_id', recordId).eq('date', date).eq('time', time));
    emit();
  },

  async schedules(): Promise<MedicationSchedule[]> {
    const { patientId, records, reminders, logs } = await medicineData();
    const today = todayISO();
    return records.filter((r) => isActive(r, today)).map((record) => ({
      record,
      reminder: reminders.find((x) => x.recordId === record.id) ?? { recordId: record.id, patientId, times: [], enabled: false, updatedAt: record.createdAt },
      adherence: adherence(record.id, records, reminders, logs, now()),
    }));
  },

  async setReminder(recordId: string, times: string[], enabled: boolean) {
    const a = await requireAccount('patient');
    const t = normaliseTimes(times);
    if (enabled && !t.length) throw new AppError('VALIDATION', 'Add at least one reminder time, or turn reminders off.');
    await q(sb().from('medication_reminders').upsert({ record_id: recordId, patient_id: a.profileId, times: t, enabled, updated_at: nowIso() }, { onConflict: 'record_id' }));
    emit();
  },

  async calendarFile() {
    const { records, reminders } = await medicineData(0);
    return buildCalendar(records, reminders);
  },
};

/* ---------------- notifications ---------------- */

export const remoteNotificationService: typeof MockNotifications = {
  async list(): Promise<Notification[]> {
    const a = await requireAccount();
    return (await q(sb().from('notifications').select('*').eq('user_id', a.id).order('created_at', { ascending: false }).limit(300))).map(toNotification);
  },
  async unreadCount(): Promise<number> {
    const a = await requireAccount();
    const { count } = await sb().from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', a.id).eq('read', false);
    return count ?? 0;
  },
  async markRead(id: string) {
    await write('mark_notifications_read', { p_id: id });
  },
  async markAllRead() {
    await write('mark_notifications_read', { p_id: null });
  },
};

/* ---------------- audit log ---------------- */

export const remoteAuditService: typeof MockAudit = {
  async forPatient(): Promise<AuditLog[]> {
    const a = await requireAccount('patient');
    const rows = await all((f, t) => sb().from('audit_log').select('*').eq('patient_id', a.profileId).order('at', { ascending: false }).order('seq', { ascending: false }).range(f, t));
    return rows.map(toAudit);
  },
  async forDoctor() {
    await requireAccount('doctor');
    const rows = await read<Record<string, unknown>[]>('doctor_activity');
    return rows.map((r) => ({ ...toAudit(r), patientName: (r.patient_name as string) ?? undefined }));
  },
  async signIns(): Promise<AuditLog[]> {
    const a = await requireAccount();
    const rows = await q(sb().from('audit_log').select('*').eq('actor->>id', a.profileId)
      .in('action', ['signed_in', 'signed_out', 'password_changed', 'sessions_revoked']).order('at', { ascending: false }).limit(200));
    return rows.map(toAudit);
  },
};

/* ---------------- settings ---------------- */

export const remoteSettingsService: typeof MockSettings = {
  async get(): Promise<Preferences> {
    const a = await requireAccount();
    const rows = await q(sb().from('preferences').select('prefs').eq('user_id', a.id));
    return { ...DEFAULT_PREFS, ...(rows[0]?.prefs ?? {}) };
  },
  async update(patch: Partial<Preferences>): Promise<Preferences> {
    const a = await requireAccount();
    const next = { ...(await this.get()), ...patch };
    await q(sb().from('preferences').upsert({ user_id: a.id, prefs: next }, { onConflict: 'user_id' }));
    emit();
    return next;
  },
  async hospitals(): Promise<Hospital[]> {
    return (await q(sb().from('hospitals').select('*').order('name'))).map(toHospital);
  },
};

/* ---------------- export ---------------- */

export const remoteExportService: typeof MockExport = {
  async build(scopes: string[], format: 'json' | 'html') {
    const a = await requireAccount('patient');
    const [[p], records, docs] = await Promise.all([
      q(sb().from('patients').select('*').eq('id', a.profileId)),
      listRecords(a.profileId),
      all((f, t) => sb().from('documents').select('*').eq('patient_id', a.profileId).range(f, t)),
    ]);
    const out = buildExport(toPatient(p), records, docs.map(toDocument), scopes, format);
    await write('log_export', { p_label: out.label, p_records: out.records, p_documents: out.documents });
    return { filename: out.filename, blob: out.blob, count: out.records + out.documents };
  },
};

/* ---------------- search ---------------- */

let searchCache: { at: number; src: Parameters<typeof searchIn>[1] } | null = null;
let watching = false;

export async function remoteSearchPatient(query: string): Promise<SearchResult[]> {
  if (query.trim().length < 2) return [];
  if (!watching) { watching = true; subscribe(() => { searchCache = null; }); }
  const a = await requireAccount('patient');
  if (!searchCache || Date.now() - searchCache.at > 30000) {
    const [records, docs, grants, hospitals] = await Promise.all([
      listRecords(a.profileId),
      all((f, t) => sb().from('documents').select('*').eq('patient_id', a.profileId).range(f, t)),
      q(sb().from('access_grants').select('doctor_id').eq('patient_id', a.profileId)),
      q(sb().from('hospitals').select('*')),
    ]);
    const ids = [...new Set([...grants.map((g: { doctor_id: string }) => g.doctor_id), ...records.filter((r) => r.createdBy.role === 'doctor').map((r) => r.createdBy.id)])];
    const doctors = ids.length ? (await q(sb().from('doctor_directory').select('*').in('id', ids))).map(toDoctor) : [];
    searchCache = { at: Date.now(), src: { records, documents: docs.map(toDocument), doctors, hospitals: hospitals.map(toHospital) } };
  }
  return searchIn(query, searchCache.src);
}

/** Devices registered for pushed medicine reminders (see lib/webPush.ts). */
export const remotePushService = {
  async saveSubscription(endpoint: string, p256dh: string, auth: string, timeZone: string): Promise<void> {
    await read('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_time_zone: timeZone });
  },
  async deleteSubscription(endpoint: string): Promise<void> {
    await read('delete_push_subscription', { p_endpoint: endpoint });
  },
};
