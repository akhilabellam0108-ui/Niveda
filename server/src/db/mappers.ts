/** Row → domain-object mappers. The API returns the same shapes the web app already uses (shared/types). */
import type {
  AccessGrant, AccessRequest, AuditLog, Doctor, DoctorInvite, DoseLog, Hospital, MedicalDocument, MedicalRecord,
  MedicationReminder, Notification, Patient, RecordVersion, Session, User,
} from '@shared/types';
import { iso, isoOpt } from './db';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const toUser = (r: Row): User => ({
  id: r.id, role: r.role, email: r.email, phone: r.phone, passwordHash: '', passwordSalt: '',
  createdAt: iso(r.created_at), profileId: r.profile_id, onboarded: r.onboarded,
});

export const toPatient = (r: Row): Patient => ({
  id: r.id, userId: r.user_id, patientCode: r.patient_code, fullName: r.full_name, dateOfBirth: r.date_of_birth,
  sex: r.sex ?? undefined, email: r.email, phone: r.phone, bloodGroup: r.blood_group ?? undefined,
  photoDataUrl: r.photo_data_url ?? undefined, emergencyContact: r.emergency_contact ?? undefined,
  importantNotes: r.important_notes ?? undefined, emergencyCardEnabled: r.emergency_card_enabled,
  declarations: r.declarations ?? undefined, createdAt: iso(r.created_at),
});

export const toDoctor = (r: Row): Doctor => ({
  id: r.id, userId: r.user_id, fullName: r.full_name, specialization: r.specialization, registrationNumber: r.registration_number,
  hospitalId: r.hospital_id, email: r.email, phone: r.phone, accessCode: r.access_code, yearsOfPractice: r.years_of_practice,
  qualifications: r.qualifications,
});

export const toHospital = (r: Row): Hospital => ({ id: r.id, name: r.name, city: r.city, type: r.type });

export const toVersion = (r: Row): RecordVersion => ({
  version: r.version, date: r.date, data: r.data, changedAt: iso(r.changed_at), changedBy: r.changed_by,
  changeType: r.change_type, reason: r.reason ?? undefined,
});

/** `versions` and `attachments` are loaded separately and passed in. */
export const toRecord = (r: Row, versions: RecordVersion[] = [], attachments: string[] = []): MedicalRecord => ({
  id: r.id, patientId: r.patient_id, type: r.type, date: r.date, data: r.data, createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at), createdBy: r.created_by, organization: r.organization ?? undefined, attachments,
  parentId: r.parent_id ?? undefined, source: r.source, version: r.version, versions,
});

export const toDocument = (r: Row): MedicalDocument => ({
  id: r.id, patientId: r.patient_id, name: r.name, mimeType: r.mime_type, size: r.size, category: r.category, date: r.date,
  recordId: r.record_id ?? undefined, uploadedBy: r.uploaded_by, uploadedAt: iso(r.uploaded_at),
});

export const toGrant = (r: Row): AccessGrant => ({
  id: r.id, patientId: r.patient_id, doctorId: r.doctor_id, permissions: r.permissions, grantedAt: iso(r.granted_at),
  expiresAt: iso(r.expires_at), status: r.status, method: r.method, revokedAt: isoOpt(r.revoked_at),
  verification: { method: 'otp', verifiedAt: iso(r.verified_at) }, reminderSent: r.reminder_sent, expiryLogged: r.expiry_logged,
  requestId: r.request_id ?? undefined,
});

export const toRequest = (r: Row): AccessRequest => ({
  id: r.id, patientId: r.patient_id, doctorId: r.doctor_id, permissions: r.permissions, durationHours: r.duration_hours,
  reason: r.reason, createdAt: iso(r.created_at), status: r.status, respondedAt: isoOpt(r.responded_at),
});

export const toInvite = (r: Row): DoctorInvite => ({
  id: r.id, patientId: r.patient_id, contact: r.contact, doctorName: r.doctor_name, createdAt: iso(r.created_at), status: r.status,
});

export const toAudit = (r: Row): AuditLog => ({
  id: r.id, patientId: r.patient_id ?? undefined, actor: r.actor, action: r.action, target: r.target ?? undefined,
  timestamp: iso(r.ts), metadata: r.metadata ?? undefined,
});

export const toNotification = (r: Row): Notification => ({
  id: r.id, userId: r.user_id, kind: r.kind, title: r.title, body: r.body, createdAt: iso(r.created_at), read: r.read,
  link: r.link ?? undefined,
});

export const toSession = (r: Row): Session => ({
  id: r.id, userId: r.user_id, device: r.device, location: r.ip ? `IP ${r.ip}` : 'Unknown location', createdAt: iso(r.created_at),
  lastActiveAt: iso(r.last_active_at), expiresAt: iso(r.expires_at),
});

export const toReminder = (r: Row): MedicationReminder => ({
  recordId: r.record_id, patientId: r.patient_id, times: r.times, enabled: r.enabled, updatedAt: iso(r.updated_at),
});

export const toDoseLog = (r: Row): DoseLog => ({
  id: r.id, patientId: r.patient_id, recordId: r.record_id, date: r.date, time: r.time, status: r.status, loggedAt: iso(r.logged_at),
});
