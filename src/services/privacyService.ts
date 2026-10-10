/**
 * DPDP Act rights — DEMO (browser only): consents, nominee, account deletion and
 * grievances. The live version is remote/privacy.ts; the database enforces it there.
 */
import type { ConsentPurpose, ConsentRecord, DeletionRequest, EmergencyContact, Grievance } from '../types';
import { delay, mutate } from '../mock/db';
import { addHours, nowISO } from '../lib/dates';
import { randomDigits, uid } from '../lib/ids';
import { brand } from '../config/brand';
import { AppError, audit, requireCtx } from './core';
import { otpService, type OtpChallenge } from './otpService';
import { DEFAULT_PREFS } from './settingsService';

export type Nominee = EmergencyContact & { email?: string };
export const DELETION_DAYS = 7;
export const GRIEVANCE_DAYS = 90;

/**
 * People who joined before consents were recorded agreed to the record itself and
 * were already using reminders, so a missing decision means those two are on.
 */
export const CONSENT_DEFAULTS: Record<ConsentPurpose, boolean> = { core_record: true, reminders: true, abdm_sharing: false, product_updates: false };

export const CONSENT_PURPOSES: { purpose: ConsentPurpose; title: string; body: string; required?: boolean }[] = [
  { purpose: 'core_record', title: 'Keep my health record', body: 'Store my record and share it only with doctors I approve. Needed to use the app.', required: true },
  { purpose: 'reminders', title: 'Medicine reminders', body: 'Send reminders to my phone, computer or watch.' },
  { purpose: 'abdm_sharing', title: 'Share through ABDM', body: 'Use my ABHA to exchange records with other ABDM apps when I approve each request.' },
  { purpose: 'product_updates', title: 'Product updates', body: 'Occasional news about new features. Never advertising.' },
];

export const GRIEVANCE_CATEGORIES: { value: Grievance['category']; label: string }[] = [
  { value: 'access', label: 'Someone saw or used my data wrongly' },
  { value: 'correction', label: 'Something in my record is wrong' },
  { value: 'erasure', label: 'Deleting my data' },
  { value: 'consent', label: 'Consent or communications' },
  { value: 'security', label: 'Security concern' },
  { value: 'other', label: 'Something else' },
];

let pendingDeletion: { challengeId: string } | null = null;

export const privacyService = {
  async consents(): Promise<ConsentRecord[]> {
    const ctx = await requireCtx();
    // Newest first; entries made in the same millisecond keep the order they were recorded in.
    const mine = (ctx.db.consents ?? []).map((c, i) => ({ c, i })).filter(({ c }) => c.userId === ctx.user.id)
      .sort((a, b) => b.c.at.localeCompare(a.c.at) || b.i - a.i).map(({ c }) => c);
    const latest = new Map<ConsentPurpose, ConsentRecord>();
    for (const c of mine) if (!latest.has(c.purpose)) latest.set(c.purpose, c);
    return [...latest.values()];
  },

  async setConsent(purpose: ConsentPurpose, granted: boolean): Promise<void> {
    const ctx = await requireCtx();
    if (purpose === 'core_record' && !granted) throw new AppError('VALIDATION', `${brand.name} can’t keep your record without this. To stop entirely, delete your account instead.`);
    await mutate((db) => {
      const c: ConsentRecord = { id: uid('cns'), userId: ctx.user.id, purpose, granted, noticeVersion: brand.privacyNoticeVersion, at: nowISO() };
      db.consents = [...(db.consents ?? []), c];
      if (purpose === 'reminders') db.preferences[ctx.user.id] = { ...DEFAULT_PREFS, ...db.preferences[ctx.user.id], medAlarms: granted };
      audit(db, { patientId: ctx.patient?.id, actor: ctx.actor, action: granted ? 'consent_given' : 'consent_withdrawn', target: { type: 'consent', id: c.id, label: purpose } });
    });
  },

  async nominee(): Promise<Nominee | null> {
    const ctx = await requireCtx('patient');
    return (ctx.patient as unknown as { nominee?: Nominee }).nominee ?? null;
  },

  async setNominee(n: Nominee | null): Promise<void> {
    const ctx = await requireCtx('patient');
    if (n && (!n.name.trim() || !n.relationship.trim() || n.phone.replace(/\D/g, '').length < 10)) throw new AppError('VALIDATION', 'Give your nominee’s name, relationship and phone number.');
    await mutate((db) => {
      const p = db.patients.find((x) => x.id === ctx.patient!.id) as unknown as { nominee?: Nominee | null };
      p.nominee = n ? { name: n.name.trim(), relationship: n.relationship.trim(), phone: n.phone.trim(), email: n.email?.trim() } : null;
    });
  },

  async deletionRequest(): Promise<DeletionRequest | null> {
    const ctx = await requireCtx();
    return (ctx.db.deletionRequests ?? []).find((d) => d.userId === ctx.user.id && d.status === 'pending') ?? null;
  },

  /** Deleting needs a fresh one-time code, like granting access. */
  async requestDeletionCode(): Promise<OtpChallenge> {
    const ctx = await requireCtx();
    const c = otpService.request('delete_account', ctx.user.phone);
    pendingDeletion = { challengeId: c.id };
    return c;
  },

  async requestDeletion(code: string, reason?: string): Promise<DeletionRequest> {
    const ctx = await requireCtx();
    if (!pendingDeletion) throw new AppError('OTP_EXPIRED', 'Please request a new code.');
    otpService.verify(pendingDeletion.challengeId, code, 'delete_account');
    pendingDeletion = null;
    if ((ctx.db.deletionRequests ?? []).some((d) => d.userId === ctx.user.id && d.status === 'pending')) throw new AppError('CONFLICT', 'Your account is already scheduled for deletion.');
    await delay();
    return mutate((db) => {
      const t = nowISO();
      const d: DeletionRequest = { id: uid('del'), userId: ctx.user.id, requestedAt: t, eraseAfter: addHours(t, DELETION_DAYS * 24), status: 'pending', reason: reason?.trim() || undefined };
      db.deletionRequests = [...(db.deletionRequests ?? []), d];
      for (const g of db.grants) if (g.patientId === ctx.patient?.id && g.status === 'active') { g.status = 'revoked'; g.revokedAt = t; }
      audit(db, { patientId: ctx.patient?.id, actor: ctx.actor, action: 'deletion_requested', target: { type: 'account', label: 'Account deletion' } });
      return d;
    });
  },

  async cancelDeletion(): Promise<void> {
    const ctx = await requireCtx();
    await mutate((db) => {
      const d = (db.deletionRequests ?? []).find((x) => x.userId === ctx.user.id && x.status === 'pending');
      if (!d) throw new AppError('NOT_FOUND', 'There’s no deletion to cancel.');
      d.status = 'cancelled';
      audit(db, { patientId: ctx.patient?.id, actor: ctx.actor, action: 'deletion_cancelled', target: { type: 'account', label: 'Deletion cancelled' } });
    });
  },

  async grievances(): Promise<Grievance[]> {
    const ctx = await requireCtx();
    return (ctx.db.grievances ?? []).filter((g) => g.userId === ctx.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async fileGrievance(category: Grievance['category'], description: string): Promise<Grievance> {
    const ctx = await requireCtx();
    if (description.trim().length < 10) throw new AppError('VALIDATION', 'Tell us a little more (at least 10 characters).');
    await delay();
    return mutate((db) => {
      const t = nowISO();
      const d = new Date();
      const g: Grievance = {
        id: uid('grv'), userId: ctx.user.id, reference: `NV-GRV-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${randomDigits(5)}`,
        category, description: description.trim(), status: 'open', createdAt: t, respondBy: addHours(t, GRIEVANCE_DAYS * 24),
      };
      db.grievances = [...(db.grievances ?? []), g];
      audit(db, { patientId: ctx.patient?.id, actor: ctx.actor, action: 'grievance_filed', target: { type: 'grievance', id: g.id, label: g.reference } });
      return g;
    });
  },

  /** Niveda team (live backend only). */
  async adminGrievances(_status?: Grievance['status']): Promise<Grievance[]> {
    const ctx = await requireCtx();
    return (ctx.db.grievances ?? []).slice().sort((a, b) => a.respondBy.localeCompare(b.respondBy));
  },

  async adminRespond(id: string, status: 'in_progress' | 'resolved', response: string): Promise<void> {
    await requireCtx();
    await mutate((db) => {
      const g = (db.grievances ?? []).find((x) => x.id === id);
      if (!g) throw new AppError('NOT_FOUND', 'Grievance not found.');
      g.status = status; g.response = response.trim() || undefined; g.resolvedAt = status === 'resolved' ? nowISO() : undefined;
    });
  },
};
