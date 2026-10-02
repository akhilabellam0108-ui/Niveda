/**
 * The only entry point the UI uses for data. Each service has two
 * implementations with the same shape:
 *  - demo: runs in the browser with fictional data (the default, and the public demo)
 *  - live: talks to Supabase, where the database enforces every access rule
 * The live one is used when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.
 */
import { isLive } from '../config/backend';
import { authService as demoAuth } from './authService';
import { accessService as demoAccess } from './accessService';
import { recordService as demoRecords } from './recordService';
import { documentService as demoDocuments } from './documentService';
import { patientService as demoPatients } from './patientService';
import { medicationService as demoMedications } from './medicationService';
import { doctorService as demoDoctors } from './doctorService';
import { notificationService as demoNotifications } from './notificationService';
import { auditService as demoAudit } from './auditService';
import { settingsService as demoSettings } from './settingsService';
import { exportService as demoExport } from './exportService';
import { searchPatient as demoSearch } from './searchService';
import { applicationService as demoApplications, adminService as demoAdmin } from './applicationService';
import { remoteApplicationService, remoteAdminService } from './remote/applications';
import { subscribe as demoSubscribe, resetDemoData as demoReset } from '../mock/db';
import { remoteAuthService } from './remote/auth';
import { remoteAccessService } from './remote/access';
import { remoteRecordService } from './remote/records';
import { remoteDocumentService } from './remote/documents';
import { remoteDoctorService, remotePatientService } from './remote/people';
import {
  remoteAuditService, remoteExportService, remoteMedicationService, remoteNotificationService, remotePushService, remoteSearchPatient, remoteSettingsService,
} from './remote/misc';
import { subscribe as liveSubscribe } from './remote/client';

export { isLive };
export const authService = isLive ? remoteAuthService : demoAuth;
export const accessService = isLive ? remoteAccessService : demoAccess;
export const recordService = isLive ? remoteRecordService : demoRecords;
export const documentService = isLive ? remoteDocumentService : demoDocuments;
export const patientService = isLive ? remotePatientService : demoPatients;
export const medicationService = isLive ? remoteMedicationService : demoMedications;
export const doctorService = isLive ? remoteDoctorService : demoDoctors;
export const notificationService = isLive ? remoteNotificationService : demoNotifications;
export const auditService = isLive ? remoteAuditService : demoAudit;
export const settingsService = isLive ? remoteSettingsService : demoSettings;
export const exportService = isLive ? remoteExportService : demoExport;
export const searchPatient = isLive ? remoteSearchPatient : demoSearch;
export const subscribe = isLive ? liveSubscribe : demoSubscribe;
export const applicationService = isLive ? remoteApplicationService : demoApplications;
export const adminService = isLive ? remoteAdminService : demoAdmin;
/** Pushed medicine reminders need a server, so the demo has none. */
export const pushService = isLive ? remotePushService : {
  saveSubscription: async (..._a: [string, string, string, string]) => undefined,
  deleteSubscription: async (_endpoint: string) => undefined,
};
/** Demo only: restores the fictional data. Does nothing on a live backend. */
export const resetDemoData = isLive ? async () => undefined : demoReset;

export { DURATIONS, durationLabel, maskName, EMERGENCY_REASONS, EMERGENCY_PERMISSIONS, EMERGENCY_HOURS, emergencyReasonLabel } from './accessService';
export type { EmergencyReason } from './accessService';
export type { GrantView, RequestView, DoctorGrantView } from './accessService';
export { isMedicationActive } from './recordService';
export type { ConsultationBundleInput, PrescriptionInput, NewRecordInput } from './recordService';
export { DOC_CATEGORY_LABEL, ACCEPT_ATTR, guessCategory, validateFile, MAX_FILE_BYTES } from './documentService';
export type { NewFile, DocumentView } from './documentService';
export type { HealthSummary, OnboardingInput } from './patientService';
export { validateOnboarding } from './patientService';
export type { MedicationSchedule, Dose } from './medicationService';
export { DEFAULT_PREFS } from './settingsService';
export { EXPORT_SCOPES } from './exportService';
export type { SearchResult } from './searchService';
export { otpService } from './otpService';
export type { OtpChallenge } from './otpService';
export { AppError, friendlyError } from './core';
export { MEDICAL_COUNCILS, REGISTER_CHECK_URL, DEMO_ONLY_MESSAGE, validateApplication } from './applicationService';
