import type { EmergencyContact, MedicalRecord, Patient, RecordData } from '../types';
import { delay, mutate, mutateQuiet } from '../mock/db';
import { todayISO } from '../lib/dates';
import { isSevereAllergy, ALLERGY_SEVERITY_RANK } from '../lib/recordMeta';
import { AppError, audit, recentlyLogged, requireCtx, requireGrant } from './core';
import { isMedicationActive, recordService } from './recordService';

export interface HealthSummary {
  patient: Patient;
  allergies: MedicalRecord[];
  activeMedications: MedicalRecord[];
  conditions: MedicalRecord[];
  counts: { records: number; doctors: number; documents: number; years: number };
  lastVisit?: MedicalRecord;
  nextFollowUp?: { date: string; label: string; recordId: string };
}

export interface OnboardingInput {
  photoDataUrl?: string;
  bloodGroup?: string;
  emergencyContact?: EmergencyContact;
  allergies: { allergen: string; severity: string; reaction: string }[];
  conditions: { condition: string }[];
  medications: { name: string; dosage: string; frequency: string }[];
  surgeries: { procedure: string; date: string }[];
  importantNotes?: string;
}

export function summarise(patient: Patient, records: MedicalRecord[]): Omit<HealthSummary, 'counts'> {
  const today = todayISO();
  const allergies = records.filter((r) => r.type === 'allergy').sort((a, b) => (ALLERGY_SEVERITY_RANK[String(b.data.severity)] ?? 0) - (ALLERGY_SEVERITY_RANK[String(a.data.severity)] ?? 0));
  const activeMedications = records.filter((r) => isMedicationActive(r, today));
  const conditions = records.filter((r) => r.type === 'diagnosis' && ['Active', 'Managed', 'Suspected'].includes(String(r.data.status)));
  const visits = records.filter((r) => r.type === 'consultation').sort((a, b) => b.date.localeCompare(a.date));
  const followUps = records
    .flatMap((r) => (r.type === 'consultation' && r.data.followUp && String(r.data.followUp) >= today ? [{ date: String(r.data.followUp), label: String(r.data.diagnosis || r.data.reason), recordId: r.id }] : []))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { patient, allergies, activeMedications, conditions, lastVisit: visits[0], nextFollowUp: followUps[0] };
}

export const patientService = {
  async me(): Promise<Patient> {
    await delay(150);
    const ctx = await requireCtx('patient');
    return ctx.patient!;
  },

  async summary(): Promise<HealthSummary> {
    const records = await recordService.list();
    const ctx = await requireCtx('patient');
    const pid = ctx.patient!.id;
    const years = records.length ? new Set(records.map((r) => r.date.slice(0, 4))).size : 0;
    return {
      ...summarise(ctx.patient!, records),
      counts: {
        records: records.length,
        doctors: new Set(records.filter((r) => r.createdBy.role === 'doctor').map((r) => r.createdBy.id)).size,
        documents: ctx.db.documents.filter((d) => d.patientId === pid).length,
        years,
      },
    };
  },

  async updateProfile(patch: Partial<Pick<Patient, 'fullName' | 'phone' | 'email' | 'dateOfBirth' | 'bloodGroup' | 'photoDataUrl' | 'emergencyContact' | 'importantNotes' | 'sex' | 'emergencyCardEnabled'>>): Promise<Patient> {
    await delay();
    const ctx = await requireCtx('patient');
    if (patch.fullName !== undefined && !patch.fullName.trim()) throw new AppError('VALIDATION', 'Name can’t be empty.');
    return mutate((db) => {
      const p = db.patients.find((x) => x.id === ctx.patient!.id)!;
      Object.assign(p, patch);
      const u = db.users.find((x) => x.id === ctx.user.id)!;
      if (patch.email) u.email = patch.email;
      if (patch.phone) u.phone = patch.phone;
      return p;
    });
  },

  /** Turns onboarding answers into proper records in the timeline. Everything is optional. */
  async completeOnboarding(input: OnboardingInput): Promise<void> {
    await delay();
    const ctx = await requireCtx('patient');
    const today = todayISO();
    await mutate((db) => {
      const p = db.patients.find((x) => x.id === ctx.patient!.id)!;
      if (input.photoDataUrl) p.photoDataUrl = input.photoDataUrl;
      if (input.bloodGroup) p.bloodGroup = input.bloodGroup;
      if (input.emergencyContact?.name) { p.emergencyContact = input.emergencyContact; p.emergencyCardEnabled = true; }
      if (input.importantNotes) p.importantNotes = input.importantNotes;
      db.users.find((u) => u.id === ctx.user.id)!.onboarded = true;
    });
    const add = (type: MedicalRecord['type'], data: RecordData, date = today) => recordService.create({ type, date, data });
    for (const a of input.allergies.filter((x) => x.allergen.trim())) await add('allergy', { ...a, reaction: a.reaction || 'Not recorded', severity: a.severity || 'Moderate' });
    for (const c of input.conditions.filter((x) => x.condition.trim())) await add('diagnosis', { condition: c.condition, status: 'Active', notes: 'Added during account setup' });
    for (const m of input.medications.filter((x) => x.name.trim())) await add('medication', { name: m.name, dosage: m.dosage || 'As prescribed', frequency: m.frequency || 'Once daily' });
    for (const s of input.surgeries.filter((x) => x.procedure.trim())) await add('surgery', { procedure: s.procedure }, s.date || today);
  },

  /** The emergency view. Patients see their own; doctors need an active grant (allergies at minimum). */
  async emergencyProfile(patientId?: string): Promise<Omit<HealthSummary, 'counts'> & { warnings: string[] }> {
    await delay(150);
    const ctx = await requireCtx();
    const pid = patientId ?? ctx.patient?.id;
    if (!pid) throw new AppError('VALIDATION', 'Choose a patient.');
    if (ctx.doctor) requireGrant(ctx.db, ctx.doctor.id, pid);
    const patient = ctx.db.patients.find((p) => p.id === pid)!;
    const records = ctx.db.records.filter((r) => r.patientId === pid);
    const s = summarise(patient, records);
    const warnings: string[] = [];
    for (const a of s.allergies.filter(isSevereAllergy)) warnings.push(`${String(a.data.severity).toUpperCase()} ALLERGY: ${a.data.allergen} — ${a.data.reaction}`);
    if (patient.importantNotes) warnings.push(patient.importantNotes);
    if (ctx.doctor && !recentlyLogged(ctx.db, ctx.actor.id, 'emergency_viewed', undefined, pid)) await mutateQuiet((db) => audit(db, { patientId: pid, actor: ctx.actor, action: 'emergency_viewed', target: { type: 'emergency', label: 'Emergency profile' } }));
    return { ...s, warnings };
  },
};
