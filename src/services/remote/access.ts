/** Access grants, requests and invitations on the live backend. */
import type { AccessGrant, AccessRequest, Doctor, DoctorInvite, GrantMethod, Hospital, PermissionKey } from '../../types';
import { AppError } from '../core';
import type { accessService as MockAccess, DoctorGrantView, GrantView, RequestView } from '../accessService';
import { accessService as mockAccess } from '../accessService';
import { all, q, read, requireAccount, sb, write } from './client';
import { toDoctor, toGrant, toHospital, toInvite, toRequest } from './mappers';
import { stepUp } from './auth';

type Row = Record<string, unknown>;

async function directory(ids: string[]): Promise<Map<string, Doctor & { hospital?: Hospital }>> {
  if (!ids.length) return new Map();
  const [docs, hospitals] = await Promise.all([
    q(sb().from('doctor_directory').select('*').in('id', ids)),
    q(sb().from('hospitals').select('*')),
  ]);
  const hs = new Map(hospitals.map((h: Row) => [h.id as string, toHospital(h)]));
  return new Map(docs.map((d: Row) => [d.id as string, { ...toDoctor(d), hospital: hs.get(d.hospital_id as string) }]));
}

async function grantById(id: string): Promise<AccessGrant> {
  const rows = await q(sb().from('access_grants').select('*').eq('id', id));
  if (!rows.length) throw new AppError('NOT_FOUND', 'This access could not be found.');
  return toGrant(rows[0]);
}

/** Removes anything PostgREST would read as filter syntax. */
const safeTerm = (s: string) => s.replace(/[^\p{L}\p{N} .'-]/gu, ' ').trim();

export const remoteAccessService: typeof MockAccess = {
  async listForPatient() {
    const a = await requireAccount('patient');
    await read('sweep_my_grants');
    const [grants, requests, invites] = await Promise.all([
      all((f, t) => sb().from('access_grants').select('*').eq('patient_id', a.profileId).order('granted_at', { ascending: false }).range(f, t)),
      q(sb().from('access_requests').select('*').eq('patient_id', a.profileId).eq('status', 'pending').order('created_at', { ascending: false })),
      q(sb().from('doctor_invites').select('*').eq('patient_id', a.profileId).eq('status', 'sent')),
    ]);
    const dir = await directory([...new Set([...grants, ...requests].map((x: Row) => x.doctor_id as string))]);
    const view = (g: AccessGrant): GrantView => {
      const d = dir.get(g.doctorId)!;
      return { ...g, doctor: d, hospital: d?.hospital, effectiveStatus: g.status };
    };
    const gs = grants.map(toGrant).map(view);
    return {
      active: gs.filter((g) => g.status === 'active'),
      past: gs.filter((g) => g.status !== 'active'),
      requests: requests.map(toRequest).map((r): RequestView => ({ ...r, doctor: dir.get(r.doctorId)!, hospital: dir.get(r.doctorId)?.hospital })),
      invites: invites.map(toInvite),
    };
  },

  async searchDoctors(query: string) {
    await requireAccount('patient');
    const term = safeTerm(query);
    if (term.length < 2) return [];
    const like = `%${term}%`;
    const hospitals = (await q(sb().from('hospitals').select('*'))).map(toHospital);
    const hs = new Map(hospitals.map((h) => [h.id, h]));
    const matchingHospitals = hospitals.filter((h) => h.name.toLowerCase().includes(term.toLowerCase())).map((h) => h.id);
    const filters = [`full_name.ilike.${like}`, `specialization.ilike.${like}`];
    if (matchingHospitals.length) filters.push(`hospital_id.in.(${matchingHospitals.join(',')})`);
    const rows = await q(sb().from('doctor_directory').select('*').or(filters.join(',')).limit(8));
    return rows.map((d: Row) => ({ ...toDoctor(d), hospital: hs.get(d.hospital_id as string) }));
  },

  async findDoctorByCode(code: string) {
    const d = await read<Row>('find_doctor_by_code', { p_code: code });
    const [h] = await q(sb().from('hospitals').select('*').eq('id', d.hospital_id as string));
    return { ...toDoctor(d), hospital: h ? toHospital(h) : undefined };
  },

  requestVerification(purpose) {
    return stepUp.request(purpose);
  },

  async grantAccess(input: { doctorId: string; permissions: PermissionKey[]; hours: number; method: GrantMethod; challengeId: string; code: string }) {
    await stepUp.verify(input.code);
    const id = await write<string>('grant_access', { p_doctor: input.doctorId, p_permissions: input.permissions, p_hours: input.hours, p_method: input.method });
    return grantById(id);
  },

  async updatePermissions(grantId: string, permissions: PermissionKey[], verification?: { challengeId: string; code: string }) {
    if (verification) await stepUp.verify(verification.code);
    await write('update_grant_permissions', { p_grant: grantId, p_permissions: permissions });
  },

  async revoke(grantId: string) {
    await write('revoke_grant', { p_grant: grantId });
  },

  async approveRequest(requestId: string, permissions: PermissionKey[], hours: number, verification: { challengeId: string; code: string }) {
    await stepUp.verify(verification.code);
    const id = await write<string>('approve_request', { p_request: requestId, p_permissions: permissions, p_hours: hours });
    return grantById(id);
  },

  async declineRequest(requestId: string) {
    await write('decline_request', { p_request: requestId });
  },

  async inviteDoctor(doctorName: string, contact: string): Promise<DoctorInvite> {
    const id = await write<string>('invite_doctor', { p_name: doctorName, p_contact: contact });
    const [row] = await q(sb().from('doctor_invites').select('*').eq('id', id));
    return toInvite(row);
  },

  async cancelInvite(inviteId: string) {
    await write('cancel_invite', { p_invite: inviteId });
  },

  async listForDoctor() {
    await requireAccount('doctor');
    const o = await read<{ active: Row[]; past: Row[]; requests: Row[] }>('doctor_access_overview');
    const view = (g: Row): DoctorGrantView => {
      const p = g.patient as Row;
      return {
        ...toGrant(g),
        patient: { id: p.id as string, fullName: p.full_name as string, patientCode: p.patient_code as string, dateOfBirth: (p.date_of_birth as string) ?? '', bloodGroup: (p.blood_group as string) ?? undefined, sex: (p.sex as '') ?? '' },
      };
    };
    return {
      active: o.active.map(view),
      past: o.past.map(view),
      requests: o.requests.map((r): AccessRequest & { patientName: string; patientCode: string } => ({ ...toRequest(r), patientName: r.patient_name as string, patientCode: r.patient_code as string })),
    };
  },

  async lookupPatient(code: string) {
    return read('lookup_patient', { p_code: code });
  },

  async requestAccess(patientId: string, permissions: PermissionKey[], hours: number, reason: string): Promise<AccessRequest> {
    const id = await write<string>('request_access', { p_patient: patientId, p_permissions: permissions, p_hours: hours, p_reason: reason });
    const [row] = await q(sb().from('access_requests').select('*').eq('id', id));
    return toRequest(row);
  },

  requestEmergencyVerification() {
    return stepUp.request('emergency_access');
  },

  async emergencyAccess(input) {
    await stepUp.verify(input.code);
    return write<{ patientId: string; expiresAt: string }>('emergency_access', { p_code: input.patientCode, p_reason: input.reason, p_justification: input.justification });
  },

  async cancelRequest(requestId: string) {
    await write('cancel_request', { p_request: requestId });
  },

  hoursLeft: mockAccess.hoursLeft,
};
