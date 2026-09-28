/** Patient and doctor profiles on the live backend. */
import type { Doctor, Hospital, MedicalRecord, Patient } from '../../types';
import { AppError } from '../core';
import { isSevereAllergy } from '../../lib/recordMeta';
import {
  summarise, validateOnboarding, type HealthSummary, type OnboardingInput, type patientService as MockPatient,
} from '../patientService';
import type { doctorService as MockDoctor } from '../doctorService';
import { validateFile } from '../documentService';
import { account, q, read, requireAccount, sb, write } from './client';
import { RECORD_SELECT, toDoctor, toHospital, toPatient, toRecord } from './mappers';
import { activeGrant } from './context';
import { listRecords } from './records';
import { uploadDocument } from './documents';

async function myPatient(): Promise<Patient> {
  const a = await requireAccount('patient');
  const rows = await q(sb().from('patients').select('*').eq('id', a.profileId));
  if (!rows.length) throw new AppError('NOT_SIGNED_IN', 'Please sign in to continue.');
  return toPatient(rows[0]);
}

export const remotePatientService: typeof MockPatient = {
  me: myPatient,

  async summary(): Promise<HealthSummary> {
    const patient = await myPatient();
    const [records, docCount] = await Promise.all([
      listRecords(patient.id),
      sb().from('documents').select('id', { count: 'exact', head: true }).eq('patient_id', patient.id).then((r) => r.count ?? 0),
    ]);
    return {
      ...summarise(patient, records),
      counts: {
        records: records.length,
        doctors: new Set(records.filter((r) => r.createdBy.role === 'doctor').map((r) => r.createdBy.id)).size,
        documents: docCount,
        years: records.length ? new Set(records.map((r) => r.date.slice(0, 4))).size : 0,
      },
    };
  },

  async updateProfile(patch) {
    const current = await myPatient();
    const { email, userId: _u, ...rest } = patch as typeof patch & { userId?: string };
    if (email !== undefined && email.trim().toLowerCase() !== current.email.toLowerCase()) {
      // Changing the sign-in email needs confirmation from both addresses; the
      // profile follows automatically once it's confirmed.
      const { error } = await sb().auth.updateUser({ email: email.trim() });
      if (error) throw new AppError('VALIDATION', 'That email couldn’t be used. Check it and try again.');
    }
    await write('update_patient_profile', { p_patch: rest });
    return myPatient();
  },

  async completeOnboarding(input: OnboardingInput): Promise<void> {
    const problem = validateOnboarding(input);
    if (problem) throw new AppError('VALIDATION', problem);
    for (const d of input.documents) validateFile({ name: d.file.name, type: d.file.type, size: d.file.blob.size });
    const patient = await myPatient();
    // Files first (the database insists on at least one), then everything else in one step.
    const documents: { documentId: string; linkTo?: string }[] = [];
    for (const d of input.documents) documents.push({ documentId: await uploadDocument(patient.id, d.file, d.date), linkTo: d.linkTo });
    const { documents: _files, ...answers } = input;
    await write('complete_onboarding', { p: { ...answers, documents } });
  },

  async emergencyProfile(patientId?: string) {
    const res = await read<{ patient: Record<string, unknown>; records: Record<string, unknown>[] }>('emergency_profile', { p_patient: patientId ?? null });
    const patient = toPatient(res.patient);
    const records: MedicalRecord[] = res.records.map(toRecord);
    const s = summarise(patient, records);
    const warnings: string[] = [];
    for (const a of s.allergies.filter(isSevereAllergy)) warnings.push(`${String(a.data.severity).toUpperCase()} ALLERGY: ${a.data.allergen} — ${a.data.reaction}`);
    if (patient.importantNotes) warnings.push(patient.importantNotes);
    return { ...s, warnings };
  },
};

export const remoteDoctorService: typeof MockDoctor = {
  async me(): Promise<Doctor & { hospital?: Hospital }> {
    const a = await requireAccount('doctor');
    const rows = await q(sb().from('doctors').select('*, hospitals(*)').eq('user_id', a.id));
    if (!rows.length) throw new AppError('NOT_SIGNED_IN', 'Please sign in to continue.');
    return { ...toDoctor(rows[0]), hospital: rows[0].hospitals ? toHospital(rows[0].hospitals) : undefined };
  },

  async updateProfile(patch) {
    await write('doctor_update_profile', { p_patch: patch });
  },

  async patientOverview(patientId: string) {
    await requireAccount('doctor');
    const grant = await activeGrant(patientId);
    const [rows, records] = await Promise.all([q(sb().from('patients').select('*').eq('id', patientId)), listRecords(patientId)]);
    if (!rows.length) throw new AppError('ACCESS_DENIED', 'You no longer have access to this patient’s records. Ask the patient to grant access again.');
    const patient = toPatient(rows[0]);
    return { grant, ...summarise({ ...patient, email: '' }, records), grantedBy: patient.fullName };
  },

  /** Entries this doctor added, for patients whose records they can still see. */
  async myRecentEntries() {
    const a = await account();
    if (!a || a.role !== 'doctor') throw new AppError('ACCESS_DENIED', 'This area isn’t available for your account.');
    const rows = await q(sb().from('records').select(RECORD_SELECT).eq('created_by->>id', a.profileId).is('parent_id', null).order('created_at', { ascending: false }).limit(8));
    const recs = rows.map(toRecord);
    const ids = [...new Set(recs.map((r) => r.patientId))];
    const pats = ids.length ? await q(sb().from('patients').select('id, full_name').in('id', ids)) : [];
    const names = new Map(pats.map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
    return recs.map((r) => ({ ...r, patientName: names.get(r.patientId) ?? 'Patient' }));
  },
};
