/** Shared lookups for the live services: whose record a call is about, and the doctor's active grant. */
import type { AccessGrant } from '../../types';
import { AppError } from '../core';
import { q, requireAccount, sb } from './client';
import { toGrant } from './mappers';

/**
 * The patient a call is about. Patients default to themselves; doctors must name
 * a patient and (for reads) hold an active grant — the database enforces this
 * anyway, this just gives a clear message instead of an empty screen.
 */
export async function patientIdFor(patientId?: string, checkGrant = true): Promise<string> {
  const a = await requireAccount();
  if (a.role === 'patient') {
    if (patientId && patientId !== a.profileId) throw new AppError('ACCESS_DENIED', 'You can only view your own record.');
    return a.profileId;
  }
  if (!patientId) throw new AppError('VALIDATION', 'Choose a patient.');
  if (checkGrant) await activeGrant(patientId);
  return patientId;
}

export async function activeGrant(patientId: string): Promise<AccessGrant> {
  const rows = await q(sb().from('access_grants').select('*').eq('patient_id', patientId).eq('status', 'active').gt('expires_at', new Date().toISOString()).limit(1));
  if (!rows.length) throw new AppError('ACCESS_DENIED', 'You no longer have access to this patient’s records. Ask the patient to grant access again.');
  return toGrant(rows[0]);
}
