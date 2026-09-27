import type { AccessGrant, AccessRequest, Doctor, DoctorInvite, GrantMethod, Hospital, Patient, PermissionKey } from '../types';
import { delay, mutate, mutateQuiet } from '../mock/db';
import { addHours, now, nowISO } from '../lib/dates';
import { uid } from '../lib/ids';
import { permissionLabel } from '../lib/recordMeta';
import { AppError, activeGrant, audit, doctorUserId, notify, patientUserId, requireCtx, sweepGrants } from './core';
import { otpService } from './otpService';

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

export const DURATIONS: { label: string; hours: number }[] = [
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
];

export const durationLabel = (h: number) =>
  DURATIONS.find((d) => d.hours === h)?.label ?? (h % 24 === 0 ? `${h / 24} days` : `${h} hours`);

const METHOD_LABEL: Record<GrantMethod, string> = {
  directory: 'Doctor directory', code: 'Doctor access code', qr: 'QR code', invite: 'Invitation', request: 'Approved request',
};

const withDoctor = <T extends { doctorId: string }>(db: Awaited<ReturnType<typeof requireCtx>>['db'], x: T) => {
  const doctor = db.doctors.find((d) => d.id === x.doctorId)!;
  return { ...x, doctor, hospital: db.hospitals.find((h) => h.id === doctor.hospitalId) };
};

function createGrant(
  db: Awaited<ReturnType<typeof requireCtx>>['db'], patient: Patient, doctorId: string,
  permissions: PermissionKey[], hours: number, method: GrantMethod, requestId?: string,
): AccessGrant {
  if (permissions.length === 0) throw new AppError('VALIDATION', 'Choose at least one part of your record to share.');
  if (hours <= 0 || hours > 24 * 90) throw new AppError('VALIDATION', 'Access can last between 1 hour and 90 days.');
  const doctor = db.doctors.find((d) => d.id === doctorId);
  if (!doctor) throw new AppError('NOT_FOUND', 'We couldn’t find that doctor.');
  const t = nowISO();
  // Only one active grant per doctor: a new grant replaces the old one.
  for (const g of db.grants) {
    if (g.patientId === patient.id && g.doctorId === doctorId && g.status === 'active') {
      g.status = 'revoked';
      g.revokedAt = t;
    }
  }
  const grant: AccessGrant = {
    id: uid('grt'), patientId: patient.id, doctorId, permissions, grantedAt: t, expiresAt: addHours(t, hours),
    status: 'active', method, verification: { method: 'otp', verifiedAt: t }, requestId,
  };
  db.grants.push(grant);
  audit(db, {
    patientId: patient.id, actor: { id: patient.id, role: 'patient', name: patient.fullName },
    action: 'access_granted', target: { type: 'doctor', id: doctorId, label: doctor.fullName },
    metadata: { permissions: permissions.map(permissionLabel), duration: durationLabel(hours), method: METHOD_LABEL[method] },
  });
  const du = doctorUserId(db, doctorId);
  if (du) notify(db, { userId: du, kind: 'access', title: 'Access granted', body: `${patient.fullName} gave you access to their records for ${durationLabel(hours)}.`, link: `/doctor/patients/${patient.id}` });
  return grant;
}

export const accessService = {
  /* ---------------- Patient side ---------------- */

  async listForPatient(): Promise<{ active: GrantView[]; past: GrantView[]; requests: RequestView[]; invites: DoctorInvite[] }> {
    await delay();
    const ctx = await requireCtx('patient');
    await mutateQuiet((db) => sweepGrants(db));
    const pid = ctx.patient!.id;
    const grants = ctx.db.grants.filter((g) => g.patientId === pid).map((g) => ({ ...withDoctor(ctx.db, g), effectiveStatus: g.status }));
    grants.sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
    return {
      active: grants.filter((g) => g.status === 'active'),
      past: grants.filter((g) => g.status !== 'active'),
      requests: ctx.db.requests.filter((r) => r.patientId === pid && r.status === 'pending').map((r) => withDoctor(ctx.db, r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      invites: ctx.db.invites.filter((i) => i.patientId === pid && i.status === 'sent'),
    };
  },

  async searchDoctors(query: string): Promise<(Doctor & { hospital?: Hospital })[]> {
    await delay(120);
    const ctx = await requireCtx('patient');
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return ctx.db.doctors
      .map((d) => ({ ...d, hospital: ctx.db.hospitals.find((h) => h.id === d.hospitalId) }))
      .filter((d) => [d.fullName, d.specialization, d.hospital?.name ?? ''].some((s) => s.toLowerCase().includes(q)))
      .slice(0, 8);
  },

  async findDoctorByCode(code: string): Promise<Doctor & { hospital?: Hospital }> {
    await delay(150);
    const ctx = await requireCtx('patient');
    const c = code.trim().toUpperCase().replace(/\s/g, '');
    const d = ctx.db.doctors.find((x) => x.accessCode.replace('-', '') === c.replace('-', ''));
    if (!d) throw new AppError('NOT_FOUND', 'No doctor matches that code. Check it with your doctor.');
    return { ...d, hospital: ctx.db.hospitals.find((h) => h.id === d.hospitalId) };
  },

  async requestVerification(purpose: 'grant_access' | 'approve_request' | 'change_permissions') {
    const ctx = await requireCtx('patient');
    return otpService.request(purpose, ctx.patient!.phone);
  },

  async grantAccess(input: { doctorId: string; permissions: PermissionKey[]; hours: number; method: GrantMethod; challengeId: string; code: string }): Promise<AccessGrant> {
    await delay();
    const ctx = await requireCtx('patient');
    otpService.verify(input.challengeId, input.code, 'grant_access');
    return mutate((db) => createGrant(db, ctx.patient!, input.doctorId, input.permissions, input.hours, input.method));
  },

  async updatePermissions(grantId: string, permissions: PermissionKey[], verification?: { challengeId: string; code: string }): Promise<void> {
    await delay();
    const ctx = await requireCtx('patient');
    const g = ctx.db.grants.find((x) => x.id === grantId && x.patientId === ctx.patient!.id);
    if (!g || g.status !== 'active') throw new AppError('NOT_FOUND', 'This access is no longer active.');
    if (permissions.length === 0) throw new AppError('VALIDATION', 'Keep at least one permission, or revoke access instead.');
    const widening = permissions.some((p) => !g.permissions.includes(p));
    if (widening) {
      if (!verification) throw new AppError('VALIDATION', 'Sharing more requires verification.');
      otpService.verify(verification.challengeId, verification.code, 'change_permissions');
    }
    await mutate((db) => {
      const grant = db.grants.find((x) => x.id === grantId)!;
      const before = grant.permissions;
      grant.permissions = permissions;
      const doctor = db.doctors.find((d) => d.id === grant.doctorId)!;
      audit(db, {
        patientId: grant.patientId, actor: ctx.actor, action: 'access_changed', target: { type: 'doctor', id: doctor.id, label: doctor.fullName },
        metadata: { added: permissions.filter((p) => !before.includes(p)).map(permissionLabel), removed: before.filter((p) => !permissions.includes(p)).map(permissionLabel) },
      });
      const du = doctorUserId(db, doctor.id);
      if (du) notify(db, { userId: du, kind: 'access', title: 'Permissions changed', body: `${ctx.patient!.fullName} changed what you can see.`, link: `/doctor/patients/${grant.patientId}` });
    });
  },

  async revoke(grantId: string): Promise<void> {
    await delay();
    const ctx = await requireCtx('patient');
    await mutate((db) => {
      const g = db.grants.find((x) => x.id === grantId && x.patientId === ctx.patient!.id);
      if (!g || g.status !== 'active') throw new AppError('NOT_FOUND', 'This access has already ended.');
      g.status = 'revoked';
      g.revokedAt = nowISO();
      const doctor = db.doctors.find((d) => d.id === g.doctorId)!;
      audit(db, { patientId: g.patientId, actor: ctx.actor, action: 'access_revoked', target: { type: 'doctor', id: doctor.id, label: doctor.fullName } });
      notify(db, { userId: ctx.user.id, kind: 'access', title: 'Access revoked', body: `${doctor.fullName} can no longer see your records.`, link: '/app/access?tab=history' });
      const du = doctorUserId(db, doctor.id);
      if (du) notify(db, { userId: du, kind: 'access', title: 'Access revoked', body: `${ctx.patient!.fullName} ended your access to their records.` });
    });
  },

  async approveRequest(requestId: string, permissions: PermissionKey[], hours: number, verification: { challengeId: string; code: string }): Promise<AccessGrant> {
    await delay();
    const ctx = await requireCtx('patient');
    otpService.verify(verification.challengeId, verification.code, 'approve_request');
    return mutate((db) => {
      const r = db.requests.find((x) => x.id === requestId && x.patientId === ctx.patient!.id);
      if (!r || r.status !== 'pending') throw new AppError('NOT_FOUND', 'This request has already been answered.');
      r.status = 'approved';
      r.respondedAt = nowISO();
      const doctor = db.doctors.find((d) => d.id === r.doctorId)!;
      audit(db, { patientId: r.patientId, actor: ctx.actor, action: 'request_approved', target: { type: 'request', id: r.id, label: doctor.fullName } });
      return createGrant(db, ctx.patient!, r.doctorId, permissions, hours, 'request', r.id);
    });
  },

  async declineRequest(requestId: string): Promise<void> {
    await delay();
    const ctx = await requireCtx('patient');
    await mutate((db) => {
      const r = db.requests.find((x) => x.id === requestId && x.patientId === ctx.patient!.id);
      if (!r || r.status !== 'pending') throw new AppError('NOT_FOUND', 'This request has already been answered.');
      r.status = 'declined';
      r.respondedAt = nowISO();
      const doctor = db.doctors.find((d) => d.id === r.doctorId)!;
      audit(db, { patientId: r.patientId, actor: ctx.actor, action: 'request_declined', target: { type: 'request', id: r.id, label: doctor.fullName } });
      const du = doctorUserId(db, r.doctorId);
      if (du) notify(db, { userId: du, kind: 'request', title: 'Request declined', body: `${ctx.patient!.fullName} declined your access request.` });
    });
  },

  /** Prototype: records the invite. A backend would send an email/SMS with a sign-up link. */
  async inviteDoctor(doctorName: string, contact: string): Promise<DoctorInvite> {
    await delay();
    const ctx = await requireCtx('patient');
    if (!doctorName.trim() || !contact.trim()) throw new AppError('VALIDATION', 'Enter the doctor’s name and email or phone.');
    return mutate((db) => {
      const inv: DoctorInvite = { id: uid('inv'), patientId: ctx.patient!.id, doctorName: doctorName.trim(), contact: contact.trim(), createdAt: nowISO(), status: 'sent' };
      db.invites.push(inv);
      audit(db, { patientId: ctx.patient!.id, actor: ctx.actor, action: 'invite_sent', target: { type: 'invite', id: inv.id, label: inv.doctorName } });
      return inv;
    });
  },

  async cancelInvite(inviteId: string): Promise<void> {
    const ctx = await requireCtx('patient');
    await mutate((db) => {
      const inv = db.invites.find((i) => i.id === inviteId && i.patientId === ctx.patient!.id);
      if (inv) inv.status = 'cancelled';
    });
  },

  /* ---------------- Doctor side ---------------- */

  async listForDoctor(): Promise<{ active: DoctorGrantView[]; past: DoctorGrantView[]; requests: (AccessRequest & { patientName: string; patientCode: string })[] }> {
    await delay();
    const ctx = await requireCtx('doctor');
    await mutateQuiet((db) => sweepGrants(db));
    const did = ctx.doctor!.id;
    const toView = (g: AccessGrant): DoctorGrantView => {
      const p = ctx.db.patients.find((x) => x.id === g.patientId)!;
      return { ...g, patient: { id: p.id, fullName: p.fullName, patientCode: p.patientCode, dateOfBirth: p.dateOfBirth, bloodGroup: p.bloodGroup, sex: p.sex } };
    };
    const mine = ctx.db.grants.filter((g) => g.doctorId === did).sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
    // Only the most recent past grant per patient.
    const seen = new Set<string>();
    const past: DoctorGrantView[] = [];
    for (const g of mine.filter((x) => x.status !== 'active')) {
      if (seen.has(g.patientId) || mine.some((x) => x.status === 'active' && x.patientId === g.patientId)) continue;
      seen.add(g.patientId);
      past.push(toView(g));
    }
    return {
      active: mine.filter((g) => g.status === 'active').map(toView),
      past,
      requests: ctx.db.requests.filter((r) => r.doctorId === did && r.status === 'pending').map((r) => {
        const p = ctx.db.patients.find((x) => x.id === r.patientId)!;
        return { ...r, patientName: maskName(p.fullName), patientCode: p.patientCode };
      }),
    };
  },

  /**
   * Doctors look patients up by an identifier the patient shared. Without an
   * active grant they see only a masked name — enough to confirm, not to browse.
   */
  async lookupPatient(code: string): Promise<{ patientId: string; maskedName: string; patientCode: string; status: 'active' | 'pending' | 'none' }> {
    await delay();
    const ctx = await requireCtx('doctor');
    const c = code.trim().toUpperCase().replace(/\s/g, '');
    const p = ctx.db.patients.find((x) => x.patientCode.replace(/-/g, '') === c.replace(/-/g, ''));
    if (!p) throw new AppError('NOT_FOUND', 'No patient matches that ID. Check the ID or ask the patient to show their QR code.');
    await mutateQuiet((db) => sweepGrants(db));
    const g = activeGrant(ctx.db, ctx.doctor!.id, p.id);
    const pending = ctx.db.requests.some((r) => r.doctorId === ctx.doctor!.id && r.patientId === p.id && r.status === 'pending');
    return { patientId: p.id, patientCode: p.patientCode, maskedName: g ? p.fullName : maskName(p.fullName), status: g ? 'active' : pending ? 'pending' : 'none' };
  },

  async requestAccess(patientId: string, permissions: PermissionKey[], hours: number, reason: string): Promise<AccessRequest> {
    await delay();
    const ctx = await requireCtx('doctor');
    if (!reason.trim()) throw new AppError('VALIDATION', 'Tell the patient why you need access.');
    if (permissions.length === 0) throw new AppError('VALIDATION', 'Choose at least one part of the record.');
    return mutate((db) => {
      const p = db.patients.find((x) => x.id === patientId);
      if (!p) throw new AppError('NOT_FOUND', 'Patient not found.');
      if (db.requests.some((r) => r.doctorId === ctx.doctor!.id && r.patientId === patientId && r.status === 'pending')) {
        throw new AppError('CONFLICT', 'You already have a pending request with this patient.');
      }
      const r: AccessRequest = { id: uid('req'), patientId, doctorId: ctx.doctor!.id, permissions, durationHours: hours, reason: reason.trim(), createdAt: nowISO(), status: 'pending' };
      db.requests.push(r);
      audit(db, { patientId, actor: ctx.actor, action: 'access_requested', target: { type: 'request', id: r.id, label: `${permissions.map(permissionLabel).join(', ')} · ${durationLabel(hours)}` } });
      const pu = patientUserId(db, patientId);
      if (pu) notify(db, { userId: pu, kind: 'request', title: 'Access request', body: `${ctx.doctor!.fullName} (${ctx.actor.organization}) requested access to your ${permissions.map((k) => permissionLabel(k).toLowerCase()).join(', ')} for ${durationLabel(hours)}.`, link: '/app/access?tab=requests' });
      return r;
    });
  },

  async cancelRequest(requestId: string): Promise<void> {
    const ctx = await requireCtx('doctor');
    await mutate((db) => {
      const r = db.requests.find((x) => x.id === requestId && x.doctorId === ctx.doctor!.id);
      if (r && r.status === 'pending') r.status = 'cancelled';
    });
  },

  hoursLeft(g: AccessGrant) {
    return Math.max(0, (new Date(g.expiresAt).getTime() - now().getTime()) / 3600000);
  },
};

export function maskName(name: string): string {
  return name.split(/\s+/).map((w) => (w.length <= 1 ? w : `${w[0]}${'•'.repeat(Math.min(5, w.length - 1))}`)).join(' ');
}
