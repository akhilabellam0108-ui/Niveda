/** Database rows (snake_case) → the app's types (camelCase). */
import type {
  AccessGrant, AccessRequest, AuditLog, Doctor, DoctorInvite, DoseLog, Hospital, MedicalDocument, MedicalRecord,
  MedicationReminder, Notification, Patient, RecordVersion,
} from '../../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/** Timestamps in one format, so string comparisons and sorting behave. */
export const ts = (v: unknown): string => (v ? new Date(String(v)).toISOString() : '');
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export const RECORD_SELECT = '*, record_versions(*)';

export function toRecord(r: Row): MedicalRecord {
  const versions: RecordVersion[] = ((r.record_versions ?? []) as Row[])
    .map((v) => ({
      version: v.version, date: v.date, data: v.data ?? {}, changedAt: ts(v.changed_at), changedBy: v.changed_by,
      changeType: v.change_type, reason: opt(v.reason),
    }))
    .sort((a, b) => a.version - b.version);
  return {
    id: r.id, patientId: r.patient_id, type: r.type, date: r.date, data: r.data ?? {},
    createdAt: ts(r.created_at), updatedAt: ts(r.updated_at), createdBy: r.created_by,
    organization: opt(r.organization), attachments: r.attachments ?? [], parentId: opt(r.parent_id),
    source: r.source, version: r.version, versions,
  };
}

export function toPatient(p: Row): Patient {
  return {
    id: p.id, userId: p.user_id, patientCode: p.patient_code, fullName: p.full_name, dateOfBirth: p.date_of_birth,
    sex: p.sex ?? '', email: p.email ?? '', phone: p.phone ?? '', bloodGroup: opt(p.blood_group), photoDataUrl: opt(p.photo_data_url),
    emergencyContact: opt(p.emergency_contact), importantNotes: opt(p.important_notes),
    emergencyCardEnabled: !!p.emergency_card_enabled, declarations: opt(p.declarations), createdAt: ts(p.created_at),
  };
}

/** From the doctors table (own profile) or the public directory (no contact details). */
export function toDoctor(d: Row): Doctor {
  return {
    id: d.id, userId: d.user_id ?? '', fullName: d.full_name, specialization: d.specialization,
    registrationNumber: d.registration_number ?? '', hospitalId: d.hospital_id, email: d.email ?? '', phone: d.phone ?? '',
    accessCode: d.access_code ?? '', yearsOfPractice: d.years_of_practice ?? 0, qualifications: d.qualifications ?? '',
  };
}

export const toHospital = (h: Row): Hospital => ({ id: h.id, name: h.name, city: h.city, type: h.type });

export function toGrant(g: Row): AccessGrant {
  return {
    id: g.id, patientId: g.patient_id, doctorId: g.doctor_id, permissions: g.permissions, grantedAt: ts(g.granted_at),
    // An active grant past its expiry is shown as expired even before the background job catches up.
    expiresAt: ts(g.expires_at), status: g.status === 'active' && new Date(g.expires_at).getTime() <= Date.now() ? 'expired' : g.status,
    method: g.method, revokedAt: g.revoked_at ? ts(g.revoked_at) : undefined,
    verification: { method: 'otp', verifiedAt: ts(g.verification?.verifiedAt ?? g.granted_at) },
    reminderSent: g.reminder_sent, expiryLogged: g.expiry_logged, requestId: opt(g.request_id),
  };
}

export function toRequest(r: Row): AccessRequest {
  return {
    id: r.id, patientId: r.patient_id, doctorId: r.doctor_id, permissions: r.permissions, durationHours: r.duration_hours,
    reason: r.reason, createdAt: ts(r.created_at), status: r.status, respondedAt: r.responded_at ? ts(r.responded_at) : undefined,
  };
}

export const toInvite = (i: Row): DoctorInvite => ({
  id: i.id, patientId: i.patient_id, contact: i.contact, doctorName: i.doctor_name, createdAt: ts(i.created_at), status: i.status,
});

export const toAudit = (a: Row): AuditLog => ({
  id: a.id, patientId: opt(a.patient_id), actor: a.actor, action: a.action, target: opt(a.target), timestamp: ts(a.at), metadata: opt(a.metadata),
});

export const toNotification = (n: Row): Notification => ({
  id: n.id, userId: n.user_id, kind: n.kind, title: n.title, body: n.body, createdAt: ts(n.created_at), read: n.read, link: opt(n.link),
});

export const toDocument = (d: Row): MedicalDocument => ({
  id: d.id, patientId: d.patient_id, name: d.name, mimeType: d.mime_type, size: Number(d.size), category: d.category,
  date: d.date, recordId: opt(d.record_id), uploadedBy: d.uploaded_by, uploadedAt: ts(d.uploaded_at), generated: opt(d.generated),
});

export const toReminder = (r: Row): MedicationReminder => ({
  recordId: r.record_id, patientId: r.patient_id, times: r.times ?? [], enabled: r.enabled, updatedAt: ts(r.updated_at),
});

export const toDoseLog = (l: Row): DoseLog => ({
  id: l.id, patientId: l.patient_id, recordId: l.record_id, date: l.date, time: l.time, status: l.status, loggedAt: ts(l.logged_at),
});
