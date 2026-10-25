/**
 * Children's records — DEMO (browser only). The live version is remote/family.ts, where the
 * database enforces the same rules.
 *
 * - A parent creates a profile for their child; no login is needed for the child.
 * - Several parents or guardians can manage it; each one's actions are named in the
 *   child's access log.
 * - At 18 a guardian gives the young adult a handover code. They sign up with it, the
 *   whole record becomes theirs, and every guardian's access ends — unless the new adult
 *   asks one of them to keep helping (as a carer).
 */
import type { BirthDetails, Database, GuardianRelationship, Guardianship, Patient } from '../types';
import { delay, getDb, mutate } from '../mock/db';
import { perTab } from '../mock/storage';
import { addHours, nowISO, todayISO } from '../lib/dates';
import { patientCode, randomDigits, uid } from '../lib/ids';
import { brand } from '../config/brand';
import { ageInYears, GRACE_DAYS, isAdult, plusDays, scheduleFor, onSchedule } from '../lib/immunization';
import { AppError, PROFILE_KEY, audit, canManage, guardiansOf, managedBy, notify, notifyPatient, patientUserId, requireCtx, requireOwnProfile, requireGrant, type Ctx } from './core';

import { t } from '../i18n';

export const RELATIONSHIPS: { value: GuardianRelationship; label: string; contact: string }[] = [
  { value: 'mother', label: t('Mother'), contact: 'Mother' },
  { value: 'father', label: t('Father'), contact: 'Father' },
  { value: 'parent', label: t('Parent'), contact: 'Parent' },
  { value: 'legal_guardian', label: t('Legal guardian'), contact: 'Guardian' },
  { value: 'grandparent', label: t('Grandparent'), contact: 'Grandparent' },
  { value: 'relative', label: t('Other relative'), contact: 'Relative' },
];
export const relationshipLabel = (r: GuardianRelationship) => RELATIONSHIPS.find((x) => x.value === r)?.label ?? r;
/** In English, for saved text. */
const relationshipEn = (r: GuardianRelationship) => ({ mother: 'mother', father: 'father', parent: 'parent', legal_guardian: 'legal guardian', grandparent: 'grandparent', relative: 'relative' })[r];

export const DELIVERY_TYPES = ['Normal', 'Caesarean', 'Assisted (forceps or vacuum)'];
export const HANDOVER_DAYS = 30;

export interface PersonRef { id: string; name: string; relationship: GuardianRelationship; kind: Guardianship['kind']; status: Guardianship['status']; guardianshipId: string; isYou: boolean }

export interface ManagedProfile {
  patient: Patient;
  relationship: GuardianRelationship;
  kind: Guardianship['kind'];
  guardians: PersonRef[];
  /** Turned 18: ready to be handed over. */
  canHandOver: boolean;
  /** An open handover code. The code itself is shown only once, when it's made. */
  handover?: { code?: string; expiresAt: string };
}

export interface FamilyOverview {
  self: Patient;
  /** The profile this tab is working on (self or a managed one). */
  activeId: string;
  managed: ManagedProfile[];
  /** Invitations to help manage someone's record. */
  invitations: { id: string; childName: string; childDob: string; from: string; relationship: GuardianRelationship }[];
  /** People who help manage the signed-in person's own record. */
  carers: PersonRef[];
  /** Former guardians the person can ask to keep helping, after a handover. */
  formerGuardians: PersonRef[];
}

export interface NewChildInput {
  fullName: string;
  dateOfBirth: string;
  sex?: Patient['sex'];
  bloodGroup?: string;
  relationship: GuardianRelationship;
  birthDetails?: BirthDetails;
  /** "I am this child's parent or legal guardian." */
  declared: boolean;
}

const personRef = (db: Database, g: Guardianship, meId: string): PersonRef => ({
  id: g.guardianId, name: db.patients.find((p) => p.id === g.guardianId)?.fullName ?? '—', relationship: g.relationship,
  kind: g.kind, status: g.status, guardianshipId: g.id, isYou: g.guardianId === meId,
});

/** The signed-in person's own profile, whichever profile the tab is on. */
const ownOf = (ctx: Ctx) => ctx.self ?? ctx.patient!;

function newHandoverCode(): string {
  return `HO-${randomDigits(4)}-${randomDigits(4)}-${randomDigits(4)}`;
}

const clean = (s?: string) => (s ?? '').trim();

export function cleanBirth(b?: BirthDetails): BirthDetails | undefined {
  if (!b) return undefined;
  const num = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return v === undefined || v === '' || Number.isNaN(n) ? undefined : Math.min(max, Math.max(min, n));
  };
  const out: BirthDetails = {
    place: clean(b.place) || undefined, delivery: clean(b.delivery) || undefined, notes: clean(b.notes) || undefined,
    weightKg: num(b.weightKg, 0.3, 7), lengthCm: num(b.lengthCm, 20, 70), headCm: num(b.headCm, 20, 50), gestationWeeks: num(b.gestationWeeks, 20, 45),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

export function validateChild(i: NewChildInput, today = todayISO()): string | undefined {
  if (!clean(i.fullName)) return t('Give your child’s name.');
  if (!i.dateOfBirth) return t('Give your child’s date of birth.');
  if (i.dateOfBirth > today) return t('The date of birth can’t be in the future.');
  if (isAdult(i.dateOfBirth, new Date(`${today}T12:00:00`))) return t('This person is 18 or older, so they can create their own account.');
  if (!i.relationship) return t('Choose how you’re related to the child.');
  if (!i.declared) return t('Please confirm you are the child’s parent or legal guardian.');
  return undefined;
}

/**
 * Reminds parents a week before each vaccine is due, and again if it becomes overdue.
 * Runs when notifications are read in the prototype; the live backend runs it daily.
 */
export function sweepVaccines(db: Database, childId: string): boolean {
  const child = db.patients.find((p) => p.id === childId);
  if (!child || child.userId) return false;
  const today = todayISO();
  if (!onSchedule(child.dateOfBirth, today)) return false;
  const sent = (db.vaccineNotices ??= []);
  let changed = false;
  const records = db.records.filter((r) => r.patientId === childId);
  for (const d of scheduleFor(child.dateOfBirth, records, today)) {
    if (d.some || d.status === 'given' || d.status === 'missed') continue;
    // Doses due long before the profile was created were most likely given already.
    if (d.dueDate < child.createdAt.slice(0, 10)) continue;
    const soon = d.status === 'upcoming' && d.dueDate <= plusDays(today, 7);
    const kind = d.status === 'overdue' ? 'overdue' : soon || d.status === 'due' ? 'soon' : null;
    if (!kind) continue;
    const key = `${childId}:${d.key}:${kind}`;
    if (sent.includes(key)) continue;
    sent.push(key);
    changed = true;
    notifyPatient(db, childId, kind === 'soon'
      ? { kind: 'reminder', title: 'Vaccine due soon', body: `${child.fullName}’s ${d.vaccine} (${d.dose}) is due on ${d.dueDate}.`, link: '/app/vaccines' }
      : { kind: 'reminder', title: 'Vaccine overdue', body: `${child.fullName}’s ${d.vaccine} (${d.dose}) was due on ${d.dueDate}. Ask your doctor or health centre about it.`, link: '/app/vaccines' });
  }
  return changed;
}

export const familyService = {
  async overview(): Promise<FamilyOverview> {
    await delay(120);
    const ctx = await requireCtx('patient');
    const db = ctx.db;
    const me = ownOf(ctx);
    const today = todayISO();
    const managed: ManagedProfile[] = managedBy(db, me.id).flatMap((g) => {
      const patient = db.patients.find((p) => p.id === g.childId);
      if (!patient) return [];
      const ho = (db.handovers ?? []).find((h) => h.childId === patient.id && !h.usedAt && h.expiresAt > nowISO());
      return [{
        patient, relationship: g.relationship, kind: g.kind,
        guardians: (db.guardianships ?? []).filter((x) => x.childId === patient.id && x.status !== 'ended').map((x) => personRef(db, x, me.id)),
        canHandOver: g.kind === 'guardian' && !patient.userId && ageInYears(patient.dateOfBirth, today) >= 18,
        handover: ho ? { expiresAt: ho.expiresAt } : undefined,
      }];
    });
    const invitations = (db.guardianships ?? []).filter((g) => g.guardianId === me.id && g.status === 'invited').map((g) => {
      const child = db.patients.find((p) => p.id === g.childId)!;
      return { id: g.id, childName: child.fullName, childDob: child.dateOfBirth, from: db.patients.find((p) => p.id === g.invitedBy)?.fullName ?? '—', relationship: g.relationship };
    });
    const mine = (db.guardianships ?? []).filter((g) => g.childId === me.id);
    const carers = mine.filter((g) => g.status === 'active').map((g) => personRef(db, g, me.id));
    const formerGuardians = mine.filter((g) => g.status === 'ended' && g.endReason === 'handover' && !carers.some((c) => c.id === g.guardianId))
      .map((g) => personRef(db, g, me.id))
      .filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i);
    return { self: me, activeId: ctx.patient!.id, managed, invitations, carers, formerGuardians };
  },

  /** Work on a managed profile (or pass null to go back to your own). */
  async switchTo(profileId: string | null): Promise<void> {
    const ctx = await requireCtx('patient');
    const me = ownOf(ctx);
    if (!profileId || profileId === me.id) { perTab.remove(PROFILE_KEY); return; }
    if (!canManage(ctx.db, me.id, profileId)) throw new AppError('ACCESS_DENIED', t('You don’t manage this record.'));
    perTab.set(PROFILE_KEY, profileId);
  },

  async createChild(input: NewChildInput): Promise<Patient> {
    await delay();
    const ctx = await requireCtx('patient');
    requireOwnProfile(ctx);
    const problem = validateChild(input);
    if (problem) throw new AppError('VALIDATION', problem);
    const me = ctx.patient!;
    return mutate((db) => {
      const at = nowISO();
      const rel = RELATIONSHIPS.find((r) => r.value === input.relationship)!;
      const child: Patient = {
        id: uid('pat'), patientCode: patientCode(brand.patientIdPrefix), fullName: clean(input.fullName), dateOfBirth: input.dateOfBirth,
        sex: input.sex || undefined, bloodGroup: input.bloodGroup && input.bloodGroup !== 'Unknown' ? input.bloodGroup : undefined,
        email: '', phone: '', emergencyCardEnabled: true, birthDetails: cleanBirth(input.birthDetails), createdAt: at,
        emergencyContact: { name: me.fullName, relationship: rel.contact, phone: me.phone },
      };
      db.patients.push(child);
      (db.guardianships ??= []).push({ id: uid('gdn'), childId: child.id, guardianId: me.id, relationship: input.relationship, kind: 'guardian', status: 'active', declaredAt: at, createdAt: at, acceptedAt: at });
      audit(db, { patientId: child.id, actor: { id: child.id, role: 'patient', name: child.fullName, guardian: { id: me.id, name: me.fullName } }, action: 'profile_created', target: { type: 'profile', id: child.id, label: child.fullName } });
      return child;
    });
  },

  /** Ask another parent or guardian (who has their own Niveda account) to help manage the record. */
  async inviteGuardian(childId: string, contact: string, relationship: GuardianRelationship): Promise<void> {
    await delay();
    const ctx = await requireCtx('patient');
    const me = ownOf(ctx);
    const g = canManage(ctx.db, me.id, childId);
    if (!g || g.kind !== 'guardian') throw new AppError('ACCESS_DENIED', t('You don’t manage this record.'));
    const c = contact.trim().toLowerCase();
    if (!c) throw new AppError('VALIDATION', t('Enter their email or mobile number.'));
    if (!relationship) throw new AppError('VALIDATION', t('Choose how they’re related to the child.'));
    const digits = c.replace(/\D/g, '').slice(-10);
    const user = ctx.db.users.find((u) => u.role === 'patient' && (u.email.toLowerCase() === c || (digits.length === 10 && u.phone.replace(/\D/g, '').slice(-10) === digits)));
    const them = user && ctx.db.patients.find((p) => p.id === user.profileId);
    if (!them) throw new AppError('NOT_FOUND', t('No Niveda account uses that email or number. Ask them to create one first, then invite them again.'));
    if (them.id === me.id) throw new AppError('VALIDATION', t('You already manage this record.'));
    const existing = (ctx.db.guardianships ?? []).find((x) => x.childId === childId && x.guardianId === them.id && x.status !== 'ended');
    if (existing) throw new AppError('CONFLICT', existing.status === 'active' ? t('They already help manage this record.') : t('They already have an invitation.'));
    await mutate((db) => {
      const child = db.patients.find((p) => p.id === childId)!;
      (db.guardianships ??= []).push({ id: uid('gdn'), childId, guardianId: them.id, relationship, kind: 'guardian', status: 'invited', invitedBy: me.id, createdAt: nowISO() });
      audit(db, { patientId: childId, actor: { id: child.id, role: 'patient', name: child.fullName, guardian: { id: me.id, name: me.fullName } }, action: 'guardian_invited', target: { type: 'guardian', id: them.id, label: them.fullName } });
      notify(db, { userId: them.userId!, kind: 'access', title: 'Invitation to manage a child’s record', body: `${me.fullName} asked you to help manage ${child.fullName}’s health record as their ${relationshipEn(relationship)}.`, link: '/app/family' });
    });
  },

  async respondToInvitation(id: string, accept: boolean, declared = false): Promise<void> {
    await delay();
    const ctx = await requireCtx('patient');
    const me = ownOf(ctx);
    const g = (ctx.db.guardianships ?? []).find((x) => x.id === id && x.guardianId === me.id && x.status === 'invited');
    if (!g) throw new AppError('NOT_FOUND', t('This invitation is no longer open.'));
    if (accept && !declared) throw new AppError('VALIDATION', t('Please confirm you are the child’s parent or legal guardian.'));
    await mutate((db) => {
      const x = db.guardianships!.find((y) => y.id === id)!;
      const child = db.patients.find((p) => p.id === x.childId)!;
      const at = nowISO();
      if (accept) {
        x.status = 'active'; x.acceptedAt = at; x.declaredAt = at;
        audit(db, { patientId: child.id, actor: { id: child.id, role: 'patient', name: child.fullName, guardian: { id: me.id, name: me.fullName } }, action: 'guardian_added', target: { type: 'guardian', id: me.id, label: me.fullName } });
      } else {
        x.status = 'ended'; x.endedAt = at; x.endReason = 'declined';
      }
      const inviter = x.invitedBy ? patientUserId(db, x.invitedBy) : undefined;
      if (inviter) notify(db, { userId: inviter, kind: 'access', title: accept ? 'Guardian added' : 'Invitation declined',
        body: accept ? `${me.fullName} now helps manage ${child.fullName}’s record.` : `${me.fullName} declined to help manage ${child.fullName}’s record.`, link: '/app/family', profileId: child.id, profileName: child.fullName });
    });
  },

  /** Stop managing a record. The last guardian of a child can't leave. */
  async leave(childId: string): Promise<void> {
    await delay();
    const ctx = await requireCtx('patient');
    const me = ownOf(ctx);
    const g = canManage(ctx.db, me.id, childId);
    if (!g) throw new AppError('NOT_FOUND', t('You don’t manage this record.'));
    const child = ctx.db.patients.find((p) => p.id === childId)!;
    if (!child.userId && guardiansOf(ctx.db, childId).filter((x) => x.kind === 'guardian').length <= 1) {
      throw new AppError('VALIDATION', t('You’re the only guardian of this record. Invite another parent or guardian before you leave.'));
    }
    await mutate((db) => {
      const x = db.guardianships!.find((y) => y.id === g.id)!;
      x.status = 'ended'; x.endedAt = nowISO(); x.endReason = 'left';
      audit(db, { patientId: childId, actor: { id: child.id, role: 'patient', name: child.fullName, guardian: { id: me.id, name: me.fullName } }, action: 'guardian_left', target: { type: 'guardian', id: me.id, label: me.fullName } });
      if (child.userId) notify(db, { userId: child.userId, kind: 'access', title: 'Carer stopped helping', body: `${me.fullName} no longer helps manage your record.`, link: '/app/family' });
    });
    if (perTab.get(PROFILE_KEY) === childId) perTab.remove(PROFILE_KEY);
  },

  /** At 18: a one-time code the young adult uses to sign up and take over their record. */
  async startHandover(childId: string): Promise<{ code: string; expiresAt: string }> {
    await delay();
    const ctx = await requireCtx('patient');
    const me = ownOf(ctx);
    const g = canManage(ctx.db, me.id, childId);
    if (!g || g.kind !== 'guardian') throw new AppError('ACCESS_DENIED', t('You don’t manage this record.'));
    const child = ctx.db.patients.find((p) => p.id === childId)!;
    if (child.userId) throw new AppError('CONFLICT', t('This record has already been handed over.'));
    if (ageInYears(child.dateOfBirth, todayISO()) < 18) throw new AppError('VALIDATION', t('A record can be handed over once its owner turns 18.'));
    return mutate((db) => {
      const at = nowISO();
      db.handovers = (db.handovers ?? []).filter((h) => h.childId !== childId || h.usedAt);
      const h = { childId, code: newHandoverCode(), createdBy: me.id, createdAt: at, expiresAt: addHours(at, HANDOVER_DAYS * 24) };
      db.handovers.push(h);
      audit(db, { patientId: childId, actor: { id: child.id, role: 'patient', name: child.fullName, guardian: { id: me.id, name: me.fullName } }, action: 'handover_started', target: { type: 'profile', id: child.id, label: child.fullName } });
      return { code: h.code, expiresAt: h.expiresAt };
    });
  },

  /** After a handover: let a former guardian keep helping, as a carer. */
  async keepHelping(guardianId: string): Promise<void> {
    await delay();
    const ctx = await requireCtx('patient');
    requireOwnProfile(ctx);
    const me = ctx.patient!;
    const former = (ctx.db.guardianships ?? []).find((g) => g.childId === me.id && g.guardianId === guardianId && g.status === 'ended' && g.endReason === 'handover');
    if (!former) throw new AppError('NOT_FOUND', t('Only a former parent or guardian can be asked to keep helping.'));
    if (canManage(ctx.db, guardianId, me.id)) throw new AppError('CONFLICT', t('They already help manage this record.'));
    await mutate((db) => {
      const at = nowISO();
      db.guardianships!.push({ id: uid('gdn'), childId: me.id, guardianId, relationship: former.relationship, kind: 'carer', status: 'active', invitedBy: me.id, createdAt: at, acceptedAt: at });
      const them = db.patients.find((p) => p.id === guardianId)!;
      audit(db, { patientId: me.id, actor: ctx.actor, action: 'carer_added', target: { type: 'guardian', id: guardianId, label: them.fullName } });
      if (them.userId) notify(db, { userId: them.userId, kind: 'access', title: 'You can help manage a record', body: `${me.fullName} asked you to keep helping manage their health record.`, link: '/app/family', profileId: me.id, profileName: me.fullName });
    });
  },

  /** The person ends a carer's access to their own record. */
  async removeCarer(guardianshipId: string): Promise<void> {
    await delay();
    const ctx = await requireCtx('patient');
    requireOwnProfile(ctx);
    const me = ctx.patient!;
    const g = (ctx.db.guardianships ?? []).find((x) => x.id === guardianshipId && x.childId === me.id && x.status === 'active');
    if (!g) throw new AppError('NOT_FOUND', t('They no longer help manage your record.'));
    await mutate((db) => {
      const x = db.guardianships!.find((y) => y.id === g.id)!;
      x.status = 'ended'; x.endedAt = nowISO(); x.endReason = 'removed';
      const them = db.patients.find((p) => p.id === g.guardianId)!;
      audit(db, { patientId: me.id, actor: ctx.actor, action: 'guardian_left', target: { type: 'guardian', id: them.id, label: them.fullName } });
      if (them.userId) notify(db, { userId: them.userId, kind: 'access', title: 'Access ended', body: `${me.fullName} ended your access to their records.` });
    });
  },

  /** Who manages a patient's record — shown to doctors who have access. */
  async guardiansFor(patientId: string): Promise<{ name: string; relationship: GuardianRelationship; kind: Guardianship['kind'] }[]> {
    const ctx = await requireCtx();
    if (ctx.doctor) requireGrant(ctx.db, ctx.doctor.id, patientId);
    else if (ctx.patient?.id !== patientId) throw new AppError('ACCESS_DENIED', t('You don’t have access to this.'));
    return guardiansOf(ctx.db, patientId).map((g) => ({ name: ctx.db.patients.find((p) => p.id === g.guardianId)?.fullName ?? '—', relationship: g.relationship, kind: g.kind }));
  },
};

/* ---------------- handover at sign-up (used by authService) ---------------- */

/** Checks a handover code against the date of birth given at sign-up. */
export async function checkHandover(code: string, dateOfBirth: string) {
  const db = await getDb();
  const h = (db.handovers ?? []).find((x) => x.code === code.trim().toUpperCase() && !x.usedAt);
  const child = h && db.patients.find((p) => p.id === h.childId);
  if (!h || !child || h.expiresAt <= nowISO() || child.userId || child.dateOfBirth !== dateOfBirth) {
    throw new AppError('VALIDATION', t('That handover code doesn’t match. Check the code and your date of birth, or ask your parent for a new code.'));
  }
  return { h, child };
}

/** Gives the record to its owner: their new account takes over the profile and guardians' access ends. */
export function completeHandover(db: Database, code: string, userId: string, email: string, phone: string): Patient {
  const h = db.handovers!.find((x) => x.code === code.trim().toUpperCase())!;
  const child = db.patients.find((p) => p.id === h.childId)!;
  const at = nowISO();
  h.usedAt = at;
  child.userId = userId; child.email = email; child.phone = phone;
  const self = { id: child.id, role: 'patient' as const, name: child.fullName };
  for (const g of (db.guardianships ?? []).filter((x) => x.childId === child.id && x.status !== 'ended')) {
    const wasActive = g.status === 'active';
    g.status = 'ended'; g.endedAt = at; g.endReason = 'handover';
    const gu = patientUserId(db, g.guardianId);
    if (gu && wasActive) notify(db, { userId: gu, kind: 'access', title: 'Record handed over', body: `${child.fullName} now has their own account and has taken over their health record. Your access has ended.`, link: '/app/family' });
  }
  audit(db, { patientId: child.id, actor: self, action: 'handover_completed', target: { type: 'profile', id: child.id, label: child.fullName } });
  return child;
}

/** Days after a due date before reminders call a dose overdue (re-exported for screens). */
export { GRACE_DAYS };
