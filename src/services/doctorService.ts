import type { Doctor, Hospital, MedicalRecord, Patient } from '../types';
import { delay, mutate } from '../mock/db';
import { requireCtx, requireGrant } from './core';
import { summarise } from './patientService';
import { RECORD_TYPES } from '../lib/recordMeta';


export const doctorService = {
  async me(): Promise<Doctor & { hospital?: Hospital }> {
    await delay(150);
    const ctx = await requireCtx('doctor');
    return { ...ctx.doctor!, hospital: ctx.db.hospitals.find((h) => h.id === ctx.doctor!.hospitalId) };
  },

  async updateProfile(patch: Partial<Pick<Doctor, 'phone' | 'qualifications' | 'specialization'>>): Promise<void> {
    await delay();
    const ctx = await requireCtx('doctor');
    await mutate((db) => {
      Object.assign(db.doctors.find((d) => d.id === ctx.doctor!.id)!, patch);
      if (patch.phone) db.users.find((u) => u.id === ctx.user.id)!.phone = patch.phone;
    });
  },

  /** Summary of an authorised patient, filtered by the permissions the patient granted. */
  async patientOverview(patientId: string) {
    await delay();
    const ctx = await requireCtx('doctor');
    const grant = requireGrant(ctx.db, ctx.doctor!.id, patientId);
    const patient = ctx.db.patients.find((p) => p.id === patientId)!;
    const records = ctx.db.records.filter((r) => r.patientId === patientId && grant.permissions.includes(RECORD_TYPES[r.type].permission));
    const safePatient: Patient = { ...patient, email: '', photoDataUrl: patient.photoDataUrl };
    return { grant, ...summarise(safePatient, records), grantedBy: patient.fullName };
  },

  /** Entries this doctor has added across patients they can still see. */
  async myRecentEntries(): Promise<(MedicalRecord & { patientName: string })[]> {
    await delay();
    const ctx = await requireCtx('doctor');
    const did = ctx.doctor!.id;
    return ctx.db.records
      .filter((r) => r.createdBy.id === did && r.parentId === undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8)
      .map((r) => ({ ...r, patientName: ctx.db.patients.find((p) => p.id === r.patientId)!.fullName }));
  },
};

