/**
 * The service layer the pages use. Same function names as before; every call now goes to
 * the Niveda API, which enforces all access rules.
 */
import type {
  AccessGrant, AccessRequest, AuditLog, Doctor, DoctorInvite, DoseLog, GrantMethod, MedicalDocument, MedicalRecord,
  Notification, Patient, PermissionKey, Preferences, RecordData, RecordType, User,
} from '@shared/types';
import type {
  ConsultationResult, DoctorAuditView, DoctorGrantView, DoctorWithHospital, DocumentView, EmergencyProfile, GrantView,
  HealthSummary, MedicationScheduleView, OnboardingPayload, OtpChallenge, PatientOverview, PrescriptionInput, RecentEntry,
  RecordDetail, RequestView, SearchResult, ServerConfig, SessionView, SignUpInput,
} from '@shared/api';
import { AppError, fileProblem } from '@shared/api';
import { RECORD_TYPES } from '@shared/recordMeta';
import type { Dose } from '@shared/reminders';
import { api, get, qs, send, upload, closeLive, reconnectLive, type NewFile } from './api';

export { subscribe, onAuthFailure, setLiveEnabled, type NewFile } from './api';
export {
  AppError, friendlyError, DURATIONS, durationLabel, maskName, isMedicationActive, DOC_CATEGORY_LABEL, ACCEPT_ATTR,
  guessCategory, MAX_FILE_BYTES, EXPORT_SCOPES, validateOnboarding, hoursLeft,
} from '@shared/api';
export type { GrantView, RequestView, DoctorGrantView, DocumentView, HealthSummary, OtpChallenge, PrescriptionInput, SearchResult, ServerConfig } from '@shared/api';
export type { Dose } from '@shared/reminders';
export type MedicationSchedule = MedicationScheduleView;

export const DEFAULT_PREFS: Preferences = { theme: 'system', language: 'en', medAlarms: true, medAlarmSound: true, notifyRecords: true, notifyAccess: true, notifyReminders: true };

/** Throws a friendly error for a file the server would refuse. */
export function validateFile(f: { name: string; type: string; size: number }) {
  const p = fileProblem(f);
  if (p) throw new AppError('VALIDATION', p);
}

/* ---------------- Server config ---------------- */

let configCache: Promise<ServerConfig> | undefined;
export const configService = {
  get: () => (configCache ??= get<ServerConfig>('/config').catch((e) => { configCache = undefined; throw e; })),
};

/* ---------------- Auth ---------------- */

export interface MePayload {
  user: User | null;
  patient?: Patient;
  doctor?: DoctorWithHospital;
  prefs?: Partial<Preferences>;
}

export const authService = {
  startSignUp: (input: SignUpInput) => send<OtpChallenge>('POST', '/auth/signup/start', input, true),
  async completeSignUp(challengeId: string, code: string): Promise<User> {
    const me = await send<MePayload>('POST', '/auth/signup/complete', { challengeId, code });
    reconnectLive();
    return me.user!;
  },
  startLogin: (identifier: string, password: string) => send<OtpChallenge>('POST', '/auth/login/start', { identifier, password }, true),
  async completeLogin(challengeId: string, code: string): Promise<User> {
    const me = await send<MePayload>('POST', '/auth/login/complete', { challengeId, code });
    reconnectLive();
    return me.user!;
  },
  resendCode: (challengeId: string) => send<OtpChallenge>('POST', '/auth/resend', { challengeId }, true),
  async startPasswordReset(identifier: string): Promise<OtpChallenge | null> {
    return (await send<{ challenge: OtpChallenge | null }>('POST', '/auth/password-reset/start', { identifier }, true)).challenge;
  },
  completePasswordReset: (challengeId: string, code: string, newPassword: string) => send<void>('POST', '/auth/password-reset/complete', { challengeId, code, newPassword }, true),
  changePassword: (current: string, next: string) => send<void>('POST', '/auth/password', { current, next }),
  me: () => get<MePayload>('/auth/me'),
  async currentUser(): Promise<User | null> { return (await get<MePayload>('/auth/me')).user; },
  async logout(): Promise<void> {
    closeLive();
    try { await send('POST', '/auth/logout', {}, true); } catch { /* already signed out */ }
  },
  listSessions: () => get<SessionView[]>('/auth/sessions'),
  revokeSession: (id: string) => api<void>('DELETE', `/auth/sessions/${encodeURIComponent(id)}`),
  async revokeOtherSessions(): Promise<number> { return (await send<{ count: number }>('POST', '/auth/sessions/revoke-others')).count; },
};

/* ---------------- Access ---------------- */

export const accessService = {
  listForPatient: () => get<{ active: GrantView[]; past: GrantView[]; requests: RequestView[]; invites: DoctorInvite[] }>('/access'),
  searchDoctors: (q: string) => get<DoctorWithHospital[]>(`/access/doctors${qs({ q })}`),
  findDoctorByCode: (code: string) => get<DoctorWithHospital>(`/access/doctors/by-code/${encodeURIComponent(code.trim())}`),
  requestVerification: (purpose: 'grant_access' | 'approve_request' | 'change_permissions') => send<OtpChallenge>('POST', '/auth/verify', { purpose }, true),
  grantAccess: (input: { doctorId: string; permissions: PermissionKey[]; hours: number; method: GrantMethod; challengeId: string; code: string }) => send<AccessGrant>('POST', '/access/grants', input),
  updatePermissions: (grantId: string, permissions: PermissionKey[], verification?: { challengeId: string; code: string }) =>
    send<void>('PATCH', `/access/grants/${grantId}`, { permissions, ...verification }),
  revoke: (grantId: string) => send<void>('POST', `/access/grants/${grantId}/revoke`),
  approveRequest: (requestId: string, permissions: PermissionKey[], hours: number, v: { challengeId: string; code: string }) =>
    send<AccessGrant>('POST', `/access/requests/${requestId}/approve`, { permissions, hours, ...v }),
  declineRequest: (requestId: string) => send<void>('POST', `/access/requests/${requestId}/decline`),
  inviteDoctor: (doctorName: string, contact: string) => send<DoctorInvite>('POST', '/access/invites', { doctorName, contact }),
  cancelInvite: (id: string) => api<void>('DELETE', `/access/invites/${id}`),
  listForDoctor: () => get<{ active: DoctorGrantView[]; past: DoctorGrantView[]; requests: (AccessRequest & { patientName: string; patientCode: string })[] }>('/access/doctor'),
  lookupPatient: (code: string) => get<{ patientId: string; maskedName: string; patientCode: string; status: 'active' | 'pending' | 'none' }>(`/access/lookup/${encodeURIComponent(code.trim())}`),
  requestAccess: (patientId: string, permissions: PermissionKey[], hours: number, reason: string) => send<AccessRequest>('POST', '/access/requests', { patientId, permissions, hours, reason }),
  cancelRequest: (id: string) => send<void>('POST', `/access/requests/${id}/cancel`),
  hoursLeft: (g: Pick<AccessGrant, 'expiresAt'>) => Math.max(0, (new Date(g.expiresAt).getTime() - Date.now()) / 3600000),
};

/* ---------------- Records ---------------- */

export interface NewRecordInput {
  patientId?: string;
  type: RecordType;
  date: string;
  data: RecordData;
  parentId?: string;
  files?: NewFile[];
  reminderTimes?: string[];
}

export interface ConsultationBundleInput {
  patientId: string;
  date: string;
  reason: string;
  symptoms?: string;
  notes?: string;
  followUp?: string;
  diagnosis?: { condition: string; status: string; severity?: string; notes?: string };
  prescriptions: PrescriptionInput[];
  labOrders: { test: string; laboratory?: string; reason?: string }[];
  files: NewFile[];
}

export const recordService = {
  list: (patientId?: string) => get<MedicalRecord[]>(`/records${qs({ patientId })}`),
  get: (id: string) => get<RecordDetail>(`/records/${id}`),
  logHistoryView: (patientId: string) => send<void>('POST', '/records/history-view', { patientId }, true),
  create: ({ files = [], ...input }: NewRecordInput) => upload<MedicalRecord>('/records', { ...input }, files),
  addConsultation: ({ files, ...input }: ConsultationBundleInput) => upload<ConsultationResult>('/records/consultation', { ...input }, files),
  amend: (id: string, change: { date: string; data: RecordData; reason: string }) => send<MedicalRecord>('POST', `/records/${id}/amend`, change),
  discontinueMedication: (id: string, reason: string, date?: string) => send<void>('POST', `/records/${id}/discontinue`, { reason, date }),
  addLabResult: (orderId: string, data: RecordData, date: string, files: NewFile[] = []) => upload<MedicalRecord>(`/records/${orderId}/lab-result`, { data, date }, files),
  typesDoctorCanWrite: (permissions: PermissionKey[]): RecordType[] =>
    (Object.keys(RECORD_TYPES) as RecordType[]).filter((t) => RECORD_TYPES[t].doctorCanAdd && permissions.includes(RECORD_TYPES[t].permission)),
};

/* ---------------- Documents ---------------- */

export const documentService = {
  list: (patientId?: string) => get<DocumentView[]>(`/documents${qs({ patientId })}`),
  async upload(input: { file: NewFile; date: string; recordId?: string; patientId?: string }): Promise<string> {
    const r = await upload<{ ids: string[] }>('/documents', { date: input.date, recordId: input.recordId, patientId: input.patientId }, [{ ...input.file, date: input.date }]);
    return r.ids[0];
  },
  attach: (documentId: string, recordId: string | undefined) => send<void>('PATCH', `/documents/${documentId}`, { recordId: recordId ?? null }),
  /** Fetches the file through the permission-checked API (doctor views are logged). */
  async open(documentId: string): Promise<{ doc: MedicalDocument; blob: Blob }> {
    const doc = await get<MedicalDocument>(`/documents/${documentId}`);
    const res = await api<Response>('GET', `/documents/${documentId}/file`, { raw: true });
    return { doc, blob: await res.blob() };
  },
  remove: (id: string) => api<void>('DELETE', `/documents/${id}`),
};

/* ---------------- Patient ---------------- */

/** Onboarding answers as the page collects them: documents carry their files. */
export type OnboardingInput = Omit<OnboardingPayload, 'documents'> & { documents: { file: NewFile; date: string; linkTo?: string }[] };

export const toOnboardingPayload = (i: OnboardingInput): OnboardingPayload => ({
  ...i, documents: i.documents.map((d) => ({ date: d.date, linkTo: d.linkTo || undefined, category: d.file.category, name: d.file.name })),
});

export const patientService = {
  async me(): Promise<Patient> {
    const m = await authService.me();
    if (!m.patient) throw new AppError('NOT_SIGNED_IN', 'Please sign in to continue.');
    return m.patient;
  },
  summary: () => get<HealthSummary>('/patient/summary'),
  updateProfile: (patch: Partial<Pick<Patient, 'fullName' | 'phone' | 'email' | 'dateOfBirth' | 'bloodGroup' | 'photoDataUrl' | 'emergencyContact' | 'importantNotes' | 'sex' | 'emergencyCardEnabled'>>) =>
    send<Patient>('PATCH', '/patient/profile', patch),
  completeOnboarding: (input: OnboardingInput) =>
    upload<void>('/patient/onboarding', { ...toOnboardingPayload(input) }, input.documents.map((d) => ({ ...d.file, date: d.date }))),
  emergencyProfile: (patientId?: string) => get<EmergencyProfile>(`/patient/emergency${qs({ patientId })}`),
};

/* ---------------- Doctor ---------------- */

export const doctorService = {
  async me(): Promise<DoctorWithHospital> {
    const m = await authService.me();
    if (!m.doctor) throw new AppError('NOT_SIGNED_IN', 'Please sign in to continue.');
    return m.doctor;
  },
  updateProfile: (patch: Partial<Pick<Doctor, 'phone' | 'qualifications'>>) => send<void>('PATCH', '/doctor/profile', patch),
  patientOverview: (patientId: string) => get<PatientOverview>(`/doctor/patients/${patientId}/overview`),
  myRecentEntries: () => get<RecentEntry[]>('/doctor/entries'),
};

/* ---------------- Notifications, audit, settings ---------------- */

export const notificationService = {
  list: () => get<Notification[]>('/notifications'),
  async unreadCount(): Promise<number> { return (await get<{ count: number }>('/notifications/unread-count')).count; },
  markRead: (id: string) => send<void>('POST', `/notifications/${id}/read`),
  markAllRead: () => send<void>('POST', '/notifications/read-all'),
};

export const auditService = {
  forPatient: () => get<AuditLog[]>('/audit/patient'),
  forDoctor: () => get<DoctorAuditView[]>('/audit/doctor'),
  signIns: () => get<AuditLog[]>('/audit/sign-ins'),
};

export const settingsService = {
  get: () => get<Preferences>('/settings'),
  update: (patch: Partial<Preferences>) => send<Preferences>('PATCH', '/settings', patch),
};

/* ---------------- Medications ---------------- */

export const medicationService = {
  today: () => get<Dose[]>('/medications/today'),
  logDose: (recordId: string, date: string, time: string, status: DoseLog['status']) => send<void>('POST', '/medications/doses', { recordId, date, time, status }),
  undoDose: (recordId: string, date: string, time: string) => send<void>('DELETE', '/medications/doses', { recordId, date, time }),
  schedules: () => get<MedicationScheduleView[]>('/medications/schedules'),
  setReminder: (recordId: string, times: string[], enabled: boolean) => send<void>('PUT', `/medications/${recordId}/reminder`, { times, enabled }),
  async calendarFile(): Promise<{ filename: string; blob: Blob; count: number }> {
    const res = await api<Response>('GET', '/medications/calendar.ics', { raw: true });
    return { filename: 'niveda-medicine-reminders.ics', blob: await res.blob(), count: Number(res.headers.get('X-Reminder-Count') ?? 0) };
  },
};

/* ---------------- Export & search ---------------- */

export const exportService = {
  async build(scopes: string[], format: 'json' | 'html'): Promise<{ filename: string; blob: Blob; count: number }> {
    const res = await api<Response>('POST', '/export', { body: { scopes, format }, raw: true });
    const cd = res.headers.get('Content-Disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(cd)?.[1] ?? `niveda-record.${format}`;
    return { filename, blob: await res.blob(), count: Number(res.headers.get('X-Item-Count') ?? 0) };
  },
};

export const searchPatient = (q: string) => get<SearchResult[]>(`/search${qs({ q })}`);
