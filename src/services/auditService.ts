import type { AuditLog } from '../types';
import { delay } from '../mock/db';
import { requireCtx } from './core';


export const auditService = {
  /** Everything that happened to the signed-in patient's record. */
  async forPatient(): Promise<AuditLog[]> {
    await delay();
    const ctx = await requireCtx('patient');
    return ctx.db.audit.filter((a) => a.patientId === ctx.patient!.id).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
  /** A doctor sees their own actions (their professional activity log). */
  async forDoctor(): Promise<(AuditLog & { patientName?: string })[]> {
    await delay();
    const ctx = await requireCtx('doctor');
    return ctx.db.audit
      .filter((a) => a.actor.id === ctx.doctor!.id)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .map((a) => ({ ...a, patientName: ctx.db.patients.find((p) => p.id === a.patientId)?.fullName }));
  },
  async signIns(): Promise<AuditLog[]> {
    await delay();
    const ctx = await requireCtx();
    return ctx.db.audit
      .filter((a) => a.actor.id === ctx.actor.id && ['signed_in', 'signed_out', 'password_changed', 'sessions_revoked'].includes(a.action))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
};

