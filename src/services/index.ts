/**
 * The only entry point the UI uses for data. Each service mirrors an API a
 * real backend would expose; today they run against the in-browser mock.
 */
export { authService } from './authService';
export { accessService, DURATIONS, durationLabel, maskName } from './accessService';
export type { GrantView, RequestView, DoctorGrantView } from './accessService';
export { recordService, isMedicationActive } from './recordService';
export type { ConsultationBundleInput, PrescriptionInput, NewRecordInput } from './recordService';
export { documentService, DOC_CATEGORY_LABEL, ACCEPT_ATTR, guessCategory, validateFile, MAX_FILE_BYTES } from './documentService';
export type { NewFile, DocumentView } from './documentService';
export { patientService } from './patientService';
export type { HealthSummary, OnboardingInput } from './patientService';
export { validateOnboarding } from './patientService';
export { medicationService } from './medicationService';
export type { MedicationSchedule, Dose } from './medicationService';
export { doctorService } from './doctorService';
export { notificationService } from './notificationService';
export { auditService } from './auditService';
export { settingsService, DEFAULT_PREFS } from './settingsService';
export { exportService, EXPORT_SCOPES } from './exportService';
export { searchPatient } from './searchService';
export type { SearchResult } from './searchService';
export { otpService } from './otpService';
export type { OtpChallenge } from './otpService';
export { AppError, friendlyError } from './core';
export { subscribe, resetDemoData } from '../mock/db';
