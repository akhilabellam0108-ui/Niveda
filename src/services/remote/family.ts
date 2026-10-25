/** Children's records on the live backend: the database enforces every rule (20261025000001_children.sql). */
import type { GuardianRelationship, Guardianship, Patient } from '../../types';
import type { familyService as MockFamily, FamilyOverview, ManagedProfile, NewChildInput, PersonRef } from '../familyService';
import { read, write } from './client';
import { toPatient } from './mappers';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const toPerson = (g: Row): PersonRef => ({
  id: g.id, name: g.name, relationship: g.relationship, kind: g.kind, status: g.status, guardianshipId: g.guardianshipId, isYou: !!g.isYou,
});

export const remoteFamilyService: typeof MockFamily = {
  async overview(): Promise<FamilyOverview> {
    const o = await read<Row>('family_overview');
    return {
      self: toPatient(o.self),
      activeId: o.activeId,
      managed: (o.managed as Row[]).map((m): ManagedProfile => ({
        patient: toPatient(m.patient), relationship: m.relationship, kind: m.kind,
        guardians: (m.guardians as Row[]).map(toPerson), canHandOver: !!m.canHandOver,
        handover: m.handoverExpiresAt ? { expiresAt: new Date(m.handoverExpiresAt).toISOString() } : undefined,
      })),
      invitations: o.invitations,
      carers: (o.carers as Row[]).map(toPerson),
      formerGuardians: (o.formerGuardians as Row[]).map(toPerson),
    };
  },

  async switchTo(profileId: string | null): Promise<void> {
    await write('switch_profile', { p_patient: profileId });
  },

  async createChild(input: NewChildInput): Promise<Patient> {
    const id = await write<string>('create_child_profile', { p: input });
    const o = await read<Row>('family_overview');
    return toPatient((o.managed as Row[]).find((m) => m.patient.id === id)!.patient);
  },

  async inviteGuardian(childId: string, contact: string, relationship: GuardianRelationship): Promise<void> {
    await write('invite_guardian', { p_child: childId, p_contact: contact, p_relationship: relationship });
  },

  async respondToInvitation(id: string, accept: boolean, declared = false): Promise<void> {
    await write('respond_guardian_invite', { p_id: id, p_accept: accept, p_declared: declared });
  },

  async leave(childId: string): Promise<void> {
    await write('leave_guardianship', { p_child: childId });
  },

  async startHandover(childId: string): Promise<{ code: string; expiresAt: string }> {
    const r = await write<{ code: string; expiresAt: string }>('start_handover', { p_child: childId });
    return { code: r.code, expiresAt: new Date(r.expiresAt).toISOString() };
  },

  async keepHelping(guardianId: string): Promise<void> {
    await write('keep_carer', { p_guardian: guardianId });
  },

  async removeCarer(guardianshipId: string): Promise<void> {
    await write('remove_carer', { p_guardianship: guardianshipId });
  },

  async guardiansFor(patientId: string): Promise<{ name: string; relationship: GuardianRelationship; kind: Guardianship['kind'] }[]> {
    return read('patient_guardians', { p_patient: patientId });
  },
};
