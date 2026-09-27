import type { EmergencyContact, MedicalRecord, Patient, RecordData } from '../types';
import { delay, mutate, mutateQuiet } from '../mock/db';
import { nowISO, todayISO } from '../lib/dates';
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
  /** Required. "Unknown" is an accepted answer. */
  bloodGroup: string;
  emergencyContact: EmergencyContact;
  allergies: { allergen: string; severity: string; reaction: string }[];
  noAllergies: boolean;
  conditions: { condition: string; since?: string }[];
  noConditions: boolean;
  medications: { name: string; dosage: string; frequency: string; times: string[] }[];
  noMedications: boolean;
  /** Past surgeries and hospital stays. */
  history: { kind: 'surgery' | 'hospitalization'; name: string; date: string; hospital: string }[];
  noHistory: boolean;
  importantNotes?: string;
}

const PHONE_OK = (s: string) => s.replace(/\D/g, '').length >= 10;

/** Every onboarding section must be answered: either with entries or an explicit "none". Returns the first problem. */
export function validateOnboarding(i: OnboardingInput): string | undefined {
  if (!i.bloodGroup) return 'Choose your blood group (or “Not sure”).';
  const c = i.emergencyContact;
  if (!c?.name?.trim() || !c.relationship?.trim() || !c.phone?.trim()) return 'Add an emergency contact with name, relationship and phone.';
  if (!PHONE_OK(c.phone)) return 'Enter a valid phone number for your emergency contact.';
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
    ?? (i.history.some((h) => !h.name.trim() || !h.date || !h.hospital.trim()) ? 'Each surgery or hospital stay needs what it was, the date and the hospital.' : undefined);
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
    if ('emergencyContact' in patch) {
      const c = patch.emergencyContact;
      if (!c?.name?.trim() || !c.relationship?.trim() || !c.phone?.trim()) throw new AppError('VALIDATION', 'An emergency contact with name, relationship and phone is required.');
      if (!PHONE_OK(c.phone)) throw new AppError('VALIDATION', 'Enter a valid phone number for your emergency contact.');
    }
    return mutate((db) => {
      const p = db.patients.find((x) => x.id === ctx.patient!.id)!;
      Object.assign(p, patch);
      const u = db.users.find((x) => x.id === ctx.user.id)!;
      if (patch.email) u.email = patch.email;
      if (patch.phone) u.phone = patch.phone;
      return p;
    });
  },

  /**
   * Turns onboarding answers into proper records in the timeline. Every section is
   * compulsory: patients add entries or explicitly confirm they have none.
   */
  async completeOnboarding(input: OnboardingInput): Promise<void> {
    await delay();
    const ctx = await requireCtx('patient');
    const problem = validateOnboarding(input);
    if (problem) throw new AppError('VALIDATION', problem);
    const today = todayISO();
    const add = (type: MedicalRecord['type'], data: RecordData, date = today, reminderTimes?: string[]) => recordService.create({ type, date, data, reminderTimes });
    for (const a of input.allergies) await add('allergy', { ...a, notes: 'Added during account setup' });
    for (const c of input.conditions) await add('diagnosis', { condition: c.condition, status: 'Active', notes: 'Added during account setup' }, c.since || today);
    for (const m of input.medications) await add('medication', { name: m.name, dosage: m.dosage, frequency: m.frequency }, today, m.times);
    for (const h of input.history) {
      if (h.kind === 'surgery') await add('surgery', { procedure: h.name, facility: h.hospital }, h.date);
      else await add('hospitalization', { reason: h.name, facility: h.hospital }, h.date);
    }
    await mutate((db) => {
      const p = db.patients.find((x) => x.id === ctx.patient!.id)!;
      if (input.photoDataUrl) p.photoDataUrl = input.photoDataUrl;
      p.bloodGroup = input.bloodGroup === 'Unknown' ? undefined : input.bloodGroup;
      p.emergencyContact = { name: input.emergencyContact.name.trim(), relationship: input.emergencyContact.relationship.trim(), phone: input.emergencyContact.phone.trim() };
      p.emergencyCardEnabled = true;
      if (input.importantNotes?.trim()) p.importantNotes = input.importantNotes.trim();
      p.declarations = {
        noAllergies: input.noAllergies || undefined, noConditions: input.noConditions || undefined,
        noMedications: input.noMedications || undefined, noSurgeries: input.noHistory || undefined, confirmedAt: nowISO(),
      };
      db.users.find((u) => u.id === ctx.user.id)!.onboarded = true;
    });
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
