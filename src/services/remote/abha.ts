/**
 * ABHA linking against ABDM, through the abdm Edge Function. ABDM tokens never
 * reach the browser; the server reads the ABHA profile itself and writes the link.
 */
import type { AbhaLink } from '../../types';
import { backend } from '../../config/backend';
import { AppError, type ErrorCode } from '../core';
import type { abhaService as DemoAbha, AbhaMethod, AbhaOtpStart, AbhaVerifyResult } from '../abhaService';
import { validateAbhaInput } from '../abhaService';
import { emit, read, resetCaches, sb, write } from './client';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().functions.invoke('abdm', { body });
  if (error) {
    let payload: { error?: { code?: string; message?: string } } = {};
    try { payload = await (error as { context?: Response }).context!.json(); } catch { /* no body */ }
    const code = (payload.error?.code ?? 'UNKNOWN') as ErrorCode;
    throw new AppError(code, payload.error?.message ?? 'ABHA linking isn’t available right now. Please try again later.');
  }
  return data as T;
}

export const remoteAbhaService: typeof DemoAbha = {
  available: backend.abdmEnabled,

  async get(): Promise<AbhaLink | null> {
    return (await read<AbhaLink | null>('my_abha')) ?? null;
  },

  async requestOtp(method: AbhaMethod, value: string): Promise<AbhaOtpStart> {
    const bad = validateAbhaInput(method, value);
    if (bad) throw new AppError('VALIDATION', bad);
    return call<AbhaOtpStart>({ action: 'request-otp', method, value });
  },

  async verifyOtp(method: AbhaMethod, txnId: string, otp: string): Promise<AbhaVerifyResult> {
    const r = await call<AbhaVerifyResult>({ action: 'verify-otp', method, txnId, otp });
    if ('linked' in r) { resetCaches(); emit(); }
    return r;
  },

  async selectAccount(txnId: string, tToken: string, abhaNumber: string): Promise<AbhaVerifyResult> {
    const r = await call<AbhaVerifyResult>({ action: 'select-account', txnId, tToken, abhaNumber });
    resetCaches(); emit();
    return r;
  },

  async unlink(): Promise<void> {
    await write('unlink_abha');
  },
};
