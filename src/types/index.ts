/* Central domain types. These map 1:1 to tables/collections in a future backend. */

export type ID = string;
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // full ISO timestamp

export type Role = 'patient' | 'doctor';
/** A doctor who has applied and is waiting for the Niveda team to verify their registration. */
export type AccountRole = Role | 'applicant';

export interface User {
  id: ID;
  role: AccountRole;
  email: string;
  phone: string;
  /** Prototype only: salted SHA-256. A real backend must own credentials (never the browser). */
  passwordHash: string;
  passwordSalt: string;
  createdAt: ISODateTime;
  profileId: ID; // patient.id or doctor.id (or the application id for an applicant)
  onboarded: boolean;
  /** A member of the Niveda team who reviews doctors' applications (live backend only). */
  isAdmin?: boolean;
}

/** What a doctor fills in to apply. */
export interface DoctorApplicationInput {
  fullName: string;
  phone: string;
  registrationNumber: string;
  medicalCouncil: string;
  registrationYear: string;
  specialization: string;
  qualifications: string;
  yearsOfPractice: string;
  hospitalName: string;
  hospitalCity: string;
  hospitalType: Hospital['type'];
}

export interface DoctorApplication extends Omit<DoctorApplicationInput, 'registrationYear' | 'yearsOfPractice'> {
  id: ID;
  email: string;
  registrationYear: number | null;
  yearsOfPractice: number;
  status: 'pending' | 'approved' | 'declined';
  reviewNote: string | null;
  reviewedAt: ISODateTime | null;
  submittedAt: ISODateTime;
  /** Set once approved: the code patients use to share their record. */
  accessCode: string | null;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

export interface Patient {
  id: ID;
  userId: ID;
  patientCode: string; // human-facing identifier shared with doctors
  fullName: string;
  dateOfBirth: ISODate;
  sex?: 'female' | 'male' | 'other' | '';
  email: string;
  phone: string;
  bloodGroup?: string;
  photoDataUrl?: string;
  emergencyContact?: EmergencyContact;
  importantNotes?: string;
  emergencyCardEnabled: boolean;
  /** Things the patient explicitly confirmed they don't have (so "nothing recorded" isn't ambiguous). */
  declarations?: HealthDeclarations;
  createdAt: ISODateTime;
}

export interface HealthDeclarations {
  noAllergies?: boolean;
  noConditions?: boolean;
  noMedications?: boolean;
  noSurgeries?: boolean;
  confirmedAt: ISODateTime;
}

export interface Hospital {
  id: ID;
  name: string;
  city: string;
  type: 'hospital' | 'clinic' | 'laboratory' | 'imaging';
}

export interface Doctor {
  id: ID;
  userId: ID;
  fullName: string;
  specialization: string;
  registrationNumber: string;
  hospitalId: ID;
  email: string;
  phone: string;
  accessCode: string; // shared by the doctor with a patient to be granted access
  yearsOfPractice: number;
  qualifications: string;
}

/* ---------- Medical records ---------- */

export type RecordType =
  | 'consultation'
  | 'diagnosis'
  | 'medication'
  | 'allergy'
  | 'surgery'
  | 'procedure'
  | 'lab_test'
  | 'lab_result'
  | 'imaging'
  | 'vaccination'
  | 'hospitalization'
  | 'mental_health'
  | 'family_history'
  | 'follow_up'
  | 'clinical_note'
  | 'other';

/** What a doctor can be allowed to see/write. Each record type maps to exactly one. */
export type PermissionKey =
  | 'history'
  | 'medications'
  | 'allergies'
  | 'labs'
  | 'imaging'
  | 'surgeries'
  | 'vaccinations'
  | 'mental_health'
  | 'sensitive';

export interface Actor {
  id: ID;
  role: Role | 'system';
  name: string;
  organization?: string;
}

export type RecordFieldValue = string | number | undefined;
export type RecordData = Record<string, RecordFieldValue>;

export type ChangeType = 'created' | 'amended' | 'discontinued' | 'result_added' | 'completed';

export interface RecordVersion {
  version: number;
  date: ISODate;
  data: RecordData;
  changedAt: ISODateTime;
  changedBy: Actor;
  changeType: ChangeType;
  reason?: string;
}

export interface MedicalRecord {
  id: ID;
  patientId: ID;
  type: RecordType;
  /** Date the medical event happened (not when it was entered). */
  date: ISODate;
  data: RecordData; // current version's data
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Immutable attribution. Never editable through the UI or amendment flow. */
  createdBy: Actor;
  organization?: { id: ID; name: string };
  attachments: ID[]; // document ids
  parentId?: ID; // e.g. a diagnosis created inside a consultation
  source: 'patient' | 'doctor' | 'import';
  version: number;
  versions: RecordVersion[];
}

/* ---------- Documents ---------- */

export type DocumentCategory = 'report' | 'prescription' | 'scan' | 'image' | 'discharge' | 'other';

export interface MedicalDocument {
  id: ID;
  patientId: ID;
  name: string;
  mimeType: string;
  size: number;
  category: DocumentCategory;
  date: ISODate;
  recordId?: ID;
  uploadedBy: Actor;
  uploadedAt: ISODateTime;
  /** Demo documents are generated on first open instead of being stored up-front. */
  generated?: { title: string; lines: string[] };
}

/* ---------- Access ---------- */

export type GrantMethod = 'directory' | 'code' | 'qr' | 'invite' | 'request';
export type GrantStatus = 'active' | 'expired' | 'revoked';

export interface AccessGrant {
  id: ID;
  patientId: ID;
  doctorId: ID;
  permissions: PermissionKey[];
  grantedAt: ISODateTime;
  expiresAt: ISODateTime;
  status: GrantStatus;
  method: GrantMethod;
  revokedAt?: ISODateTime;
  verification: { method: 'otp'; verifiedAt: ISODateTime };
  reminderSent?: boolean;
  expiryLogged?: boolean;
  requestId?: ID;
}

export type RequestStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export interface AccessRequest {
  id: ID;
  patientId: ID;
  doctorId: ID;
  permissions: PermissionKey[];
  durationHours: number;
  reason: string;
  createdAt: ISODateTime;
  status: RequestStatus;
  respondedAt?: ISODateTime;
}

export interface DoctorInvite {
  id: ID;
  patientId: ID;
  contact: string;
  doctorName: string;
  createdAt: ISODateTime;
  status: 'sent' | 'cancelled';
}

/* ---------- Audit & notifications ---------- */

export type AuditAction =
  | 'account_created'
  | 'signed_in'
  | 'signed_out'
  | 'password_changed'
  | 'access_granted'
  | 'access_changed'
  | 'access_revoked'
  | 'access_expired'
  | 'access_requested'
  | 'request_approved'
  | 'request_declined'
  | 'viewed_record'
  | 'viewed_history'
  | 'viewed_document'
  | 'record_added'
  | 'record_amended'
  | 'medication_discontinued'
  | 'document_uploaded'
  | 'document_deleted'
  | 'export_created'
  | 'emergency_viewed'
  | 'invite_sent'
  | 'sessions_revoked';

export interface AuditLog {
  id: ID;
  patientId?: ID;
  actor: Actor;
  action: AuditAction;
  target?: { type: string; id?: ID; label: string };
  timestamp: ISODateTime;
  metadata?: Record<string, string | number | boolean | string[]>;
}

export interface Notification {
  id: ID;
  userId: ID; // recipient user id
  kind: 'record' | 'access' | 'request' | 'security' | 'reminder';
  title: string;
  body: string;
  createdAt: ISODateTime;
  read: boolean;
  link?: string;
}

export interface Session {
  id: ID;
  userId: ID;
  device: string;
  location: string;
  createdAt: ISODateTime;
  lastActiveAt: ISODateTime;
  expiresAt: ISODateTime;
  current?: boolean;
}

/** The patient's reminder schedule for one medication. Kept apart from the clinical record so
 * patients can change times without amending a doctor's prescription. */
export interface MedicationReminder {
  recordId: ID;
  patientId: ID;
  times: string[]; // "HH:MM", 24-hour, local time
  enabled: boolean;
  updatedAt: ISODateTime;
}

export interface DoseLog {
  id: ID;
  patientId: ID;
  recordId: ID;
  date: ISODate;
  time: string; // scheduled "HH:MM"
  status: 'taken' | 'skipped';
  loggedAt: ISODateTime;
}

export interface Preferences {
  theme: 'system' | 'light' | 'dark';
  language: 'en';
  medAlarms: boolean;
  medAlarmSound: boolean;
  notifyRecords: boolean;
  notifyAccess: boolean;
  notifyReminders: boolean;
}

/** Everything the mock backend stores. Maps to database tables later. */
export interface Database {
  schemaVersion: number;
  users: User[];
  patients: Patient[];
  doctors: Doctor[];
  hospitals: Hospital[];
  records: MedicalRecord[];
  documents: MedicalDocument[];
  grants: AccessGrant[];
  requests: AccessRequest[];
  invites: DoctorInvite[];
  audit: AuditLog[];
  notifications: Notification[];
  sessions: Session[];
  preferences: Record<ID, Preferences>;
  reminders: MedicationReminder[];
  doseLogs: DoseLog[];
}
