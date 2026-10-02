/**
 * Helpers and request/response shapes shared by the web app and the API server.
 * Nothing here touches storage or the network.
 */
import type {
  AccessGrant, AccessRequest, AuditLog, Doctor, DocumentCategory, Hospital, MedicalDocument, MedicalRecord,
  Patient, PermissionKey, RecordData, RecordType, User, Session,
} from './types';
import { todayISO } from './dates';
import { ALLERGY_SEVERITY_RANK } from './recordMeta';

/* ---------------- Errors ---------------- */

export type ErrorCode =
  | 'ACCESS_DENIED' | 'SESSION_EXPIRED' | 'NOT_SIGNED_IN' | 'NOT_FOUND' | 'VALIDATION'
  | 'OTP_INVALID' | 'OTP_EXPIRED' | 'AUTH_FAILED' | 'CONFLICT' | 'RATE_LIMITED' | 'NETWORK' | 'UNKNOWN';

/** Errors carry a message that is safe to show to people. */
export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

export const friendlyError = (e: unknown, fallback = 'Something went wrong. Please try again.') =>
  e instanceof AppError ? e.message : fallback;

/* ---------------- Auth ---------------- */

export type OtpPurpose = 'signup' | 'login' | 'grant_access' | 'approve_request' | 'change_permissions' | 'reset_password';

export interface OtpChallenge {
  id: string;
  purpose: OtpPurpose;
  destination: string; // masked
  expiresAt: string;
  /** Only present when the server runs with OTP_DEV_ECHO=true (never in production). */
  devCode?: string;
}

export interface SignUpInput {
  fullName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  password: string;
}

export type PublicUser = Omit<User, 'passwordHash' | 'passwordSalt'>;
export type SessionView = Session & { current: boolean };

export interface ServerConfig {
  demo: boolean;
  otpDevEcho: boolean;
  otpChannel: 'email' | 'sms';
  pushPublicKey?: string;
  demoAccounts?: { email: string; label: string; role: 'patient' | 'doctor' }[];
  demoPassword?: string;
}

export function maskDestination(dest: string): string {
  if (dest.includes('@')) {
    const [u, d] = dest.split('@');
    return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`;
  }
  const digits = dest.replace(/\D/g, '');
  return `•••• ••${digits.slice(-4)}`;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PASSWORD_RULE = 'Use at least 8 characters with letters and numbers.';
export const passwordOk = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
export const phoneOk = (s: string) => s.replace(/\D/g, '').length >= 10;

/* ---------------- Access ---------------- */

export interface GrantView extends AccessGrant {
  doctor: Doctor;
  hospital?: Hospital;
  effectiveStatus: AccessGrant['status'];
}

export interface RequestView extends AccessRequest {
  doctor: Doctor;
  hospital?: Hospital;
}

export interface DoctorGrantView extends AccessGrant {
  patient: Pick<Patient, 'id' | 'fullName' | 'patientCode' | 'dateOfBirth' | 'bloodGroup' | 'sex'>;
}

export type DoctorWithHospital = Doctor & { hospital?: Hospital };

export const DURATIONS: { label: string; hours: number }[] = [
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
];

export const durationLabel = (h: number) =>
  DURATIONS.find((d) => d.hours === h)?.label ?? (h % 24 === 0 ? `${h / 24} days` : `${h} hours`);

export function maskName(name: string): string {
  return name.split(/\s+/).map((w) => (w.length <= 1 ? w : `${w[0]}${'•'.repeat(Math.min(5, w.length - 1))}`)).join(' ');
}

export const hoursLeft = (g: Pick<AccessGrant, 'expiresAt'>) => Math.max(0, (new Date(g.expiresAt).getTime() - Date.now()) / 3600000);

/* ---------------- Records ---------------- */

export interface PrescriptionInput {
  name: string;
  dosage: string;
  frequency: string;
  durationDays?: number;
  startDate: string;
  endDate?: string;
  instructions?: string;
  reason?: string;
}

export interface NewRecordPayload {
  patientId?: string;
  type: RecordType;
  date: string;
  data: RecordData;
  parentId?: string;
  reminderTimes?: string[];
  /** Metadata for uploaded files, in the same order as the files. */
  files?: FileMeta[];
}

export interface ConsultationPayload {
  patientId: string;
  date: string;
  reason: string;
  symptoms?: string;
  notes?: string;
  followUp?: string;
  diagnosis?: { condition: string; status: string; severity?: string; notes?: string };
  prescriptions: PrescriptionInput[];
  labOrders: { test: string; laboratory?: string; reason?: string }[];
  files?: FileMeta[];
}

export interface ConsultationResult {
  consultation: MedicalRecord;
  created: MedicalRecord[];
}

export interface RecordDetail {
  record: MedicalRecord;
  children: MedicalRecord[];
  parent?: MedicalRecord;
}

export const isMedicationActive = (r: MedicalRecord, today = todayISO()) =>
  r.type === 'medication' && r.data.medStatus !== 'discontinued' && (!r.data.endDate || String(r.data.endDate) >= today);

/* ---------------- Documents ---------------- */

export interface FileMeta {
  name: string;
  category: DocumentCategory;
  date?: string;
}

export interface DocumentView extends MedicalDocument {
  recordLabel?: string;
}

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'text/plain'];
export const ACCEPT_ATTR = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.txt,application/pdf,image/*,text/plain';

export const DOC_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  report: 'Lab report', prescription: 'Prescription', scan: 'Scan / imaging', image: 'Photo', discharge: 'Discharge summary', other: 'Other',
};

/** Unattached documents are gated by a permission that matches their category. */
export const CATEGORY_PERMISSION: Record<DocumentCategory, PermissionKey> = {
  report: 'labs', prescription: 'medications', scan: 'imaging', image: 'history', discharge: 'history', other: 'sensitive',
};

export const DOC_CATEGORIES = Object.keys(DOC_CATEGORY_LABEL) as DocumentCategory[];

export function guessCategory(file: { name: string; type: string }): DocumentCategory {
  const n = file.name.toLowerCase();
  if (/(rx|prescription)/.test(n)) return 'prescription';
  if (/(discharge)/.test(n)) return 'discharge';
  if (/(x-?ray|mri|ct|scan|ultrasound|usg)/.test(n)) return 'scan';
  if (/(report|lab|cbc|blood|test)/.test(n)) return 'report';
  if (file.type.startsWith('image/')) return 'image';
  return 'other';
}

/** Returns a problem with the file, or undefined if it's acceptable. */
export function fileProblem(f: { name: string; type: string; size: number }): string | undefined {
  if (f.size > MAX_FILE_BYTES) return `${f.name} is larger than 15 MB.`;
  if (f.type && !ACCEPTED_TYPES.includes(f.type) && !f.type.startsWith('image/')) return `${f.name}: use PDF, image or text files.`;
  return undefined;
}

/* ---------------- Patient ---------------- */

export interface HealthSummary {
  patient: Patient;
  allergies: MedicalRecord[];
  activeMedications: MedicalRecord[];
  conditions: MedicalRecord[];
  counts: { records: number; doctors: number; documents: number; years: number };
  lastVisit?: MedicalRecord;
  nextFollowUp?: { date: string; label: string; recordId: string };
}

export type EmergencyProfile = Omit<HealthSummary, 'counts'> & { warnings: string[] };

export interface PatientOverview extends Omit<HealthSummary, 'counts'> {
  grant: AccessGrant;
  grantedBy: string;
}

/** Onboarding answers without the files themselves (files travel alongside, in order). */
export interface OnboardingPayload {
  photoDataUrl?: string;
  bloodGroup: string; // "Unknown" is accepted
  emergencyContact: { name: string; relationship: string; phone: string };
  allergies: { allergen: string; severity: string; reaction: string }[];
  noAllergies: boolean;
  conditions: { condition: string; since?: string }[];
  noConditions: boolean;
  medications: { name: string; dosage: string; frequency: string; times: string[] }[];
  noMedications: boolean;
  history: { kind: 'surgery' | 'hospitalization'; name: string; date: string; hospital: string }[];
  noHistory: boolean;
  /** One entry per uploaded file. `linkTo` points at an entry from the earlier steps, e.g. "history:0". */
  documents: { date: string; linkTo?: string; category: DocumentCategory; name: string }[];
  /** "I don't have any documents to upload right now." */
  noDocuments: boolean;
  importantNotes?: string;
}

/** Every onboarding section must be answered: with entries or an explicit "none". Returns the first problem. */
export function validateOnboarding(i: OnboardingPayload): string | undefined {
  if (i.photoDataUrl && (i.photoDataUrl.length > 400_000 || !/^data:image\/(jpeg|png|webp);base64,/.test(i.photoDataUrl))) return 'Use a smaller JPEG, PNG or WebP photo.';
  if (!i.bloodGroup) return 'Choose your blood group (or “Not sure”).';
  const c = i.emergencyContact;
  if (!c?.name?.trim() || !c.relationship?.trim() || !c.phone?.trim()) return 'Add an emergency contact with name, relationship and phone.';
  if (!phoneOk(c.phone)) return 'Enter a valid phone number for your emergency contact.';
  const section = (items: unknown[], none: boolean, what: string) => {
    if (!items.length && !none) return `Add your ${what}, or confirm you have none.`;
    if (items.length && none) return `You added ${what} but also ticked “none”. Remove one.`;
    return undefined;
  };
  return section(i.allergies, i.noAllergies, 'allergies')
    ?? (i.allergies.some((a) => !a.allergen.trim() || !a.severity || !a.reaction.trim()) ? 'Each allergy needs the allergen, severity and reaction.' : undefined)
    ?? section(i.conditions, i.noConditions, 'ongoing conditions')
    ?? (i.conditions.some((x) => !x.condition.trim()) ? 'Each condition needs a name.' : undefined)
    ?? section(i.medications, i.noMedications, 'current medicines')
    ?? (i.medications.some((m) => !m.name.trim() || !m.dosage.trim() || !m.frequency) ? 'Each medicine needs the name, dose and how often you take it.' : undefined)
    ?? (i.medications.some((m) => m.frequency !== 'As needed' && !m.times.length) ? 'Set at least one reminder time for each regular medicine.' : undefined)
    ?? section(i.history, i.noHistory, 'past surgeries or hospital stays')
    ?? (i.history.some((h) => !h.name.trim() || !h.date || !h.hospital.trim()) ? 'Each surgery or hospital stay needs what it was, the date and the hospital.' : undefined)
    ?? section(i.documents ?? [], i.noDocuments, 'medical documents')
    ?? (i.documents.some((d) => !d.date) ? 'Add the date on each uploaded document.' : undefined);
}

/* ---------------- Medications ---------------- */

export interface MedicationScheduleView {
  record: MedicalRecord;
  reminder: { recordId: string; times: string[]; enabled: boolean };
  adherence: { due: number; taken: number; pct?: number };
}

/* ---------------- Search / export / audit ---------------- */

export interface SearchResult {
  id: string;
  kind: 'record' | 'document' | 'doctor' | 'hospital' | 'page';
  title: string;
  subtitle: string;
  link: string;
}

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

export type DoctorAuditView = AuditLog & { patientName?: string };
export type RecentEntry = MedicalRecord & { patientName: string };

/** Builds the dashboard/emergency summary from a patient's (visible) records. */
export function summarise(patient: Patient, records: MedicalRecord[], today = todayISO()): Omit<HealthSummary, 'counts'> {
  const allergies = records.filter((r) => r.type === 'allergy').sort((a, b) => (ALLERGY_SEVERITY_RANK[String(b.data.severity)] ?? 0) - (ALLERGY_SEVERITY_RANK[String(a.data.severity)] ?? 0));
  const activeMedications = records.filter((r) => isMedicationActive(r, today));
  const conditions = records.filter((r) => r.type === 'diagnosis' && ['Active', 'Managed', 'Suspected'].includes(String(r.data.status)));
  const visits = records.filter((r) => r.type === 'consultation').sort((a, b) => b.date.localeCompare(a.date));
  const followUps = records
    .flatMap((r) => (r.type === 'consultation' && r.data.followUp && String(r.data.followUp) >= today ? [{ date: String(r.data.followUp), label: String(r.data.diagnosis || r.data.reason), recordId: r.id }] : []))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { patient, allergies, activeMedications, conditions, lastVisit: visits[0], nextFollowUp: followUps[0] };
}
