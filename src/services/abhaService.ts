/**
 * ABHA (Ayushman Bharat Health Account) linking — DEMO. Simulates ABDM: the code
 * is shown on screen and the "ABHA profile" mirrors the patient's own details.
 * The live version (remote/abha.ts) goes through the abdm Edge Function and ABDM.
 */
import type { AbhaLink } from '../types';
import { delay, mutate } from '../mock/db';
import { nowISO } from '../lib/dates';
import { randomDigits, uid } from '../lib/ids';
import { AppError, audit, requireCtx } from './core';

export type AbhaMethod = 'abha-number' | 'mobile';
export interface AbhaOtpStart { txnId: string; message: string; demoCode?: string }
export type AbhaVerifyResult = { linked: AbhaLink } | { chooseAccount: true; txnId: string; tToken: string; accounts: { abhaNumber: string; name: string }[] };

export function formatAbhaNumber(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return [d.slice(0, 2), d.slice(2, 6), d.slice(6, 10), d.slice(10, 14)].filter(Boolean).join('-');
}

export function validateAbhaInput(method: AbhaMethod, value: string): string | null {
  const d = value.replace(/\D/g, '');
  if (method === 'abha-number') return d.length === 14 ? null : 'An ABHA number has 14 digits.';
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d;
  return /^[6-9]\d{9}$/.test(ten) ? null : 'Enter the 10-digit mobile number linked to your ABHA.';
}

const pending = new Map<string, { code: string; method: AbhaMethod; value: string }>();

export const abhaService = {
  /** False when the live server hasn't been set up for ABDM. The demo always simulates it. */
  available: true,

  async get(): Promise<AbhaLink | null> {
    const ctx = await requireCtx('patient');
    return ctx.db.abha?.[ctx.patient!.id] ?? null;
  },

  async requestOtp(method: AbhaMethod, value: string): Promise<AbhaOtpStart> {
    await requireCtx('patient');
    const bad = validateAbhaInput(method, value);
    if (bad) throw new AppError('VALIDATION', bad);
    await delay();
    const txnId = uid('txn');
    const code = randomDigits(6);
    pending.set(txnId, { code, method, value });
    return { txnId, message: 'Demo — ABDM would text this code to the mobile number linked to your ABHA.', demoCode: code };
  },

  async verifyOtp(_method: AbhaMethod, txnId: string, otp: string): Promise<AbhaVerifyResult> {
    const ctx = await requireCtx('patient');
    const p = pending.get(txnId);
    if (!p) throw new AppError('OTP_EXPIRED', 'This code has expired. Request a new one.');
    if (otp.replace(/\D/g, '') !== p.code) throw new AppError('OTP_INVALID', 'That code doesn’t match. Check it and try again.');
    pending.delete(txnId);
    const pat = ctx.patient!;
    const digits = p.method === 'abha-number' ? p.value.replace(/\D/g, '') : `91${pat.patientCode.replace(/\D/g, '').padEnd(12, '7').slice(0, 12)}`;
    const link: AbhaLink = {
      abhaNumber: formatAbhaNumber(digits),
      abhaAddress: `${pat.fullName.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}${digits.slice(-4)}@sbx`,
      name: pat.fullName, linkedAt: nowISO(),
    };
    await mutate((db) => {
      const taken = Object.entries(db.abha ?? {}).find(([pid, l]) => pid !== pat.id && l.abhaNumber === link.abhaNumber);
      if (taken) throw new AppError('CONFLICT', 'This ABHA is already linked to another Niveda record.');
      db.abha = { ...(db.abha ?? {}), [pat.id]: link };
      audit(db, { patientId: pat.id, actor: ctx.actor, action: 'abha_linked', target: { type: 'account', label: `ABHA xx-xxxx-xxxx-${digits.slice(-4)}` } });
    });
    return { linked: link };
  },

  async selectAccount(_txnId: string, _tToken: string, _abhaNumber: string): Promise<AbhaVerifyResult> {
    throw new AppError('VALIDATION', 'Not needed in the demo.');
  },

  async unlink(): Promise<void> {
    const ctx = await requireCtx('patient');
    await mutate((db) => {
      const l = db.abha?.[ctx.patient!.id];
      if (!l) throw new AppError('NOT_FOUND', 'No ABHA is linked.');
      delete db.abha![ctx.patient!.id];
      audit(db, { patientId: ctx.patient!.id, actor: ctx.actor, action: 'abha_unlinked', target: { type: 'account', label: `ABHA xx-xxxx-xxxx-${l.abhaNumber.slice(-4)}` } });
    });
  },
};
