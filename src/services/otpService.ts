/**
 * Prototype one-time-password provider. Codes are shown on screen instead of
 * being sent by SMS/email. Replace with a real verification provider
 * (server-generated codes, rate limits, delivery) before production.
 */
import { randomDigits, uid } from '../lib/ids';
import { now } from '../lib/dates';
import { AppError } from './core';

export type OtpPurpose = 'signup' | 'login' | 'grant_access' | 'approve_request' | 'change_permissions' | 'reset_password' | 'export' | 'emergency_access';

export interface OtpChallenge {
  id: string;
  purpose: OtpPurpose;
  destination: string; // masked
  expiresAt: number;
  /** Prototype only: the code, displayed in the UI because no SMS is sent. */
  prototypeCode: string;
}

interface Stored extends OtpChallenge {
  attempts: number;
  used: boolean;
}

const challenges = new Map<string, Stored>();

export function maskDestination(dest: string): string {
  if (dest.includes('@')) {
    const [u, d] = dest.split('@');
    return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`;
  }
  const digits = dest.replace(/\D/g, '');
  return `•••• ••${digits.slice(-4)}`;
}

export const otpService = {
  request(purpose: OtpPurpose, destination: string): OtpChallenge {
    const c: Stored = {
      id: uid('otp'), purpose, destination: maskDestination(destination),
      expiresAt: now().getTime() + 5 * 60000, prototypeCode: randomDigits(6), attempts: 0, used: false,
    };
    challenges.set(c.id, c);
    const { attempts: _a, used: _u, ...pub } = c;
    return pub;
  },

  /** Throws if the code is wrong, expired or reused. Consumes the challenge on success. */
  verify(challengeId: string, code: string, purpose: OtpPurpose): void {
    const c = challenges.get(challengeId);
    if (!c || c.purpose !== purpose || c.used) throw new AppError('OTP_EXPIRED', 'This code is no longer valid. Request a new one.');
    if (now().getTime() > c.expiresAt) throw new AppError('OTP_EXPIRED', 'This code has expired. Request a new one.');
    c.attempts++;
    if (c.attempts > 5) throw new AppError('OTP_EXPIRED', 'Too many attempts. Request a new code.');
    if (code.trim() !== c.prototypeCode) throw new AppError('OTP_INVALID', 'That code doesn’t match. Check it and try again.');
    c.used = true;
  },
};
