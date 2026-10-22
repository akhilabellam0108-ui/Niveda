/** Two-step sign-in (authenticator app) for doctors and the Niveda team — Supabase MFA. */
import { AppError } from '../core';
import { emit, read, sb } from './client';

export interface MfaState { required: boolean; enrolled: boolean; verified: boolean; factorId?: string }

export async function mfaState(): Promise<MfaState> {
  let required = false;
  try { required = await read<boolean>('mfa_required'); } catch { required = false; }
  if (!required) return { required, enrolled: false, verified: true };
  const [{ data: aal }, { data: factors }] = await Promise.all([sb().auth.mfa.getAuthenticatorAssuranceLevel(), sb().auth.mfa.listFactors()]);
  const factor = factors?.totp?.find((f) => f.status === 'verified');
  return { required, enrolled: !!factor, verified: aal?.currentLevel === 'aal2', factorId: factor?.id };
}

/** Starts adding an authenticator app: returns the QR code to scan and the key to type instead. */
export async function startEnrolment(): Promise<{ factorId: string; qr: string; secret: string }> {
  // Clear a half-finished set-up from before, so the new QR code is the only one.
  const { data: list } = await sb().auth.mfa.listFactors();
  for (const f of list?.all ?? []) if (f.factor_type === 'totp' && f.status !== 'verified') await sb().auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb().auth.mfa.enroll({ factorType: 'totp', friendlyName: `Niveda ${new Date().toISOString().slice(0, 10)}`, issuer: 'Niveda' });
  if (error || !data) throw new AppError('UNKNOWN', 'Two-step sign-in couldn’t be set up right now. Please try again.');
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Checks a 6-digit code from the authenticator app; the session is upgraded on success. */
export async function verifyMfaCode(factorId: string, code: string): Promise<void> {
  if (!/^\d{6}$/.test(code)) throw new AppError('OTP_INVALID', 'Enter the 6-digit code from your authenticator app.');
  const { error } = await sb().auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    if (/invalid|expired|code/i.test(error.message)) throw new AppError('OTP_INVALID', 'That code didn’t work. Codes change every 30 seconds — enter the one showing now.');
    if (error.status === 429) throw new AppError('VALIDATION', 'Too many attempts. Please wait a minute and try again.');
    throw new AppError('UNKNOWN', 'The code couldn’t be checked right now. Please try again.');
  }
  emit();
}
