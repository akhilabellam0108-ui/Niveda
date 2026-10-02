/**
 * One-time codes: 6 digits, hashed with a server secret, valid 5 minutes,
 * 5 attempts, single use, and rate-limited per destination.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OtpChallenge, OtpPurpose } from '@shared/api';
import { AppError, maskDestination } from '@shared/api';
import { config } from '../config';
import type { Db } from '../db/db';
import { iso, json } from '../db/db';
import { digits, uid } from '../lib/ids';
import { sendEmail, sendSms } from './messaging';

const TTL_MIN = 5;
const MAX_ATTEMPTS = 5;
const MAX_PER_15_MIN = 5;

const hashCode = (id: string, code: string) => createHmac('sha256', config.otpPepper).update(`${id}:${code}`).digest('hex');

const PURPOSE_TEXT: Record<OtpPurpose, string> = {
  signup: 'confirm your new Niveda account',
  login: 'sign in to Niveda',
  grant_access: 'give a doctor access to your record',
  approve_request: 'approve a doctor’s access request',
  change_permissions: 'share more of your record',
  reset_password: 'reset your Niveda password',
};

export interface Destination { email: string; phone: string }

export async function createChallenge(db: Db, purpose: OtpPurpose, dest: Destination, opts: { userId?: string; payload?: unknown } = {}): Promise<OtpChallenge> {
  const target = config.otpChannel === 'sms' ? dest.phone : dest.email.toLowerCase();
  const recent = await db.one<{ n: string }>(`SELECT count(*) AS n FROM otp_challenges WHERE destination = $1 AND created_at > now() - interval '15 minutes'`, [target]);
  if (Number(recent?.n ?? 0) >= MAX_PER_15_MIN) throw new AppError('RATE_LIMITED', 'Too many codes requested. Please wait 15 minutes and try again.');
  const id = uid('otp');
  const code = digits(6);
  const expires = new Date(Date.now() + TTL_MIN * 60000);
  await db.query(
    'INSERT INTO otp_challenges (id, purpose, user_id, destination, code_hash, payload, expires_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',
    [id, purpose, opts.userId ?? null, target, hashCode(id, code), json(opts.payload), expires],
  );
  const message = `${code} is your Niveda code to ${PURPOSE_TEXT[purpose]}. It expires in ${TTL_MIN} minutes. Never share it — Niveda staff will never ask for it.`;
  try {
    if (config.otpChannel === 'sms') await sendSms(target, message, { OTP: code });
    else await sendEmail(target, `Your Niveda code: ${code}`, message, `<p style="font:16px system-ui">Your Niveda code to ${PURPOSE_TEXT[purpose]} is</p><p style="font:600 28px ui-monospace,monospace;letter-spacing:6px">${code}</p><p style="font:14px system-ui;color:#555">It expires in ${TTL_MIN} minutes. Never share it — Niveda staff will never ask for it.</p>`);
  } catch (e) {
    console.error('Could not deliver code', e);
    throw new AppError('UNKNOWN', 'We couldn’t send your code just now. Please try again in a minute.');
  }
  return { id, purpose, destination: maskDestination(target), expiresAt: expires.toISOString(), devCode: config.otpDevEcho ? code : undefined };
}

/** Verifies and consumes a challenge. Returns its stored payload. */
export async function verifyChallenge<T = unknown>(db: Db, id: string, code: string, purpose: OtpPurpose, userId?: string): Promise<{ payload: T; userId?: string }> {
  const r = await db.one<Record<string, any>>('SELECT * FROM otp_challenges WHERE id = $1', [id]); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!r || r.purpose !== purpose || r.used || (userId && r.user_id !== userId)) throw new AppError('OTP_EXPIRED', 'This code is no longer valid. Request a new one.');
  if (new Date(iso(r.expires_at)).getTime() < Date.now()) throw new AppError('OTP_EXPIRED', 'This code has expired. Request a new one.');
  if (r.attempts >= MAX_ATTEMPTS) throw new AppError('OTP_EXPIRED', 'Too many attempts. Request a new code.');
  await db.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [id]);
  const expected = Buffer.from(r.code_hash, 'hex');
  const given = Buffer.from(hashCode(id, String(code).trim()), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new AppError('OTP_INVALID', 'That code doesn’t match. Check it and try again.');
  await db.query('UPDATE otp_challenges SET used = true WHERE id = $1', [id]);
  return { payload: r.payload as T, userId: r.user_id ?? undefined };
}

/** Issues a fresh code for the same pending action (same purpose, user and payload). */
export async function resendChallenge(db: Db, id: string): Promise<OtpChallenge> {
  const r = await db.one<Record<string, any>>('SELECT * FROM otp_challenges WHERE id = $1', [id]); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!r || r.used) throw new AppError('OTP_EXPIRED', 'Please start again.');
  await db.query('UPDATE otp_challenges SET used = true WHERE id = $1', [id]);
  const dest = config.otpChannel === 'sms' ? { email: '', phone: r.destination } : { email: r.destination, phone: '' };
  return createChallenge(db, r.purpose, dest, { userId: r.user_id ?? undefined, payload: r.payload ?? undefined });
}
