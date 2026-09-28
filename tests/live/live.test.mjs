// End-to-end test of the live app code (src/services/remote) against real
// Supabase components: the Auth server and PostgREST binaries, a Postgres with
// Niveda's migrations, and a storage stand-in with the same access rules.
// A patient and a doctor each get their own copy of the app, signing in with
// codes read from the emails the Auth server sends.
//
// Needs Postgres and the two binaries (see tests/live/README.md), then:
//   LIVE_PG="-h /tmp/pg -p 5433 -U postgres" SUPABASE_BIN=/tmp/sbx npm run test:live
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { startStack } from './stack.mjs';
import { createDoctor } from '../../scripts/create-doctor.mjs';

const PG = process.env.LIVE_PG;
const BIN = process.env.SUPABASE_BIN;
if (!PG || !BIN) {
  console.log('LIVE_PG / SUPABASE_BIN not set — skipping live end-to-end tests.');
  process.exit(0);
}
const root = new URL('../..', import.meta.url).pathname;
const pgHost = /-h (\S+)/.exec(PG)?.[1] ?? 'localhost';
const pgPort = Number(/-p (\S+)/.exec(PG)?.[1] ?? 5432);
const DB = 'niveda_live';

let stack;
let bundle;
const apps = {};

/** A fresh copy of the app's service layer, with its own session (like a separate browser). */
const app = (name) => import(`${pathToFileURL(bundle).href}?${name}`);

const patient = { email: 'asha.rao@example.com', password: 'Asha-2026-secure', fullName: 'Asha Rao', dateOfBirth: '1990-04-12', phone: '+91 98765 43210' };
const doctor = { email: 'kavya.menon@example.com', password: 'Kavya-2026-secure', name: 'Dr. Kavya Menon' };
const shared = {};

before(async () => {
  execSync(`${root}/tests/live/setup-db.sh ${PG}`, { stdio: 'ignore', env: { ...process.env, LIVE_DB: DB, SUPABASE_BIN: BIN } });
  stack = await startStack({ pgHost, pgPort, db: DB, bin: BIN });
  bundle = join(mkdtempSync(join(tmpdir(), 'nv-live-')), 'services.mjs');
  await build({
    entryPoints: [join(root, 'src/services/index.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error',
    define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: stack.url, VITE_SUPABASE_ANON_KEY: stack.anonKey }) },
  });
  apps.patient = await app('patient');
  apps.doctor = await app('doctor');
  assert.equal(apps.patient.isLive, true);
});

after(async () => { await stack?.stop(); });

async function rejectsWith(p, pattern) {
  await assert.rejects(p, (e) => { assert.match(`${e.code}: ${e.message}`, pattern); return true; });
}

const file = (name, text, category, type = 'application/pdf') => ({ name, type, category, blob: new Blob([text], { type }) });

test('an administrator adds a verified doctor', async () => {
  const r = await createDoctor({
    url: stack.url, serviceKey: stack.serviceKey, email: doctor.email, password: doctor.password, name: doctor.name,
    registration: 'TSMC-10001', specialization: 'General medicine', hospital: 'Northbridge Hospital', city: 'Hyderabad', years: 9,
  });
  assert.match(r.accessCode, /^DR-[0-9A-F]{4}$/);
  shared.accessCode = r.accessCode;
  shared.doctorId = r.doctorId;
});

test('a patient signs up with an emailed code and completes the compulsory setup', async () => {
  const { authService, patientService, recordService, medicationService } = apps.patient;
  const before = stack.mailCount();
  const challenge = await authService.startSignUp(patient);
  assert.equal(challenge.prototypeCode, '', 'the code is never shown on screen');
  assert.match(challenge.destination, /^as•+@example\.com$/);
  await rejectsWith(authService.completeSignUp(challenge.id, '000000'), /OTP_INVALID/);
  const user = await authService.completeSignUp(challenge.id, await stack.codeFor(patient.email, before));
  assert.equal(user.role, 'patient');
  assert.equal(user.onboarded, false);
  await rejectsWith(authService.startSignUp(patient), /CONFLICT: An account with this email already exists/);

  const me = await patientService.me();
  assert.match(me.patientCode, /^NV-\d{4}-\d{4}$/);
  shared.patientCode = me.patientCode;
  shared.patientId = me.id;

  const answers = {
    bloodGroup: 'B+', emergencyContact: { name: 'Ravi Rao', relationship: 'Brother', phone: '+91 90000 11111' },
    allergies: [{ allergen: 'Penicillin', severity: 'Severe', reaction: 'Rash and swelling' }], noAllergies: false,
    conditions: [], noConditions: true,
    medications: [{ name: 'Metformin', dosage: '500 mg', frequency: 'Twice daily', times: ['07:30', '19:30'] }], noMedications: false,
    history: [{ kind: 'surgery', name: 'Appendectomy', date: '2015-06-01', hospital: 'City Hospital' }], noHistory: false,
    documents: [{ file: file('discharge-summary.pdf', '%PDF-1.4 discharge summary', 'discharge'), date: '2015-06-05', linkTo: 'history:0' }],
  };
  await rejectsWith(patientService.completeOnboarding({ ...answers, documents: [] }), /VALIDATION: Upload at least one medical document/);
  await patientService.completeOnboarding(answers);
  assert.equal((await authService.currentUser()).onboarded, true);

  const records = await recordService.list();
  assert.deepEqual(records.map((r) => r.type).sort(), ['allergy', 'medication', 'surgery']);
  assert.equal(records.find((r) => r.type === 'surgery').attachments.length, 1);
  const schedules = await medicationService.schedules();
  assert.deepEqual(schedules[0].reminder.times, ['07:30', '19:30']);
  const summary = await patientService.summary();
  assert.equal(summary.counts.documents, 1);
  assert.equal(summary.patient.bloodGroup, 'B+');
});

test('sign-in is password plus an emailed code', async () => {
  const { authService } = apps.doctor;
  await rejectsWith(authService.startLogin(doctor.email, 'wrong-password-1'), /AUTH_FAILED/);
  const before = stack.mailCount();
  const c = await authService.startLogin(doctor.email, doctor.password);
  assert.equal(await authService.currentUser(), null, 'no session until the code is entered');
  const user = await authService.completeLogin(c.id, await stack.codeFor(doctor.email, before));
  assert.equal(user.role, 'doctor');
  const me = await apps.doctor.doctorService.me();
  assert.equal(me.hospital.name, 'Northbridge Hospital');
});

test('a doctor sees nothing until the patient grants access with a fresh code', async () => {
  const d = apps.doctor;
  const p = apps.patient;
  const look = await d.accessService.lookupPatient(shared.patientCode);
  assert.deepEqual([look.status, look.maskedName], ['none', 'A••• R••']);
  await rejectsWith(d.recordService.list(shared.patientId), /ACCESS_DENIED/);
  await rejectsWith(d.patientService.emergencyProfile(shared.patientId), /ACCESS_DENIED/);

  const found = await p.accessService.findDoctorByCode(shared.accessCode.toLowerCase());
  assert.equal(found.fullName, doctor.name);
  assert.equal(found.email, '', 'contact details stay private');
  const search = await p.accessService.searchDoctors('northbridge');
  assert.equal(search[0]?.id, shared.doctorId);

  const before = stack.mailCount();
  const challenge = await p.accessService.requestVerification('grant_access');
  const code = await stack.codeFor(patient.email, before);
  await rejectsWith(p.accessService.grantAccess({ doctorId: shared.doctorId, permissions: ['history'], hours: 24, method: 'code', challengeId: challenge.id, code: '111111' }), /OTP_INVALID/);
  const grant = await p.accessService.grantAccess({ doctorId: shared.doctorId, permissions: ['history', 'medications', 'allergies', 'labs', 'surgeries'], hours: 24, method: 'code', challengeId: challenge.id, code });
  assert.equal(grant.status, 'active');
  shared.grantId = grant.id;
  // The session created by that code has been spent: sharing more needs a new one.
  await rejectsWith(p.accessService.grantAccess({ doctorId: shared.doctorId, permissions: ['history'], hours: 1, method: 'code', challengeId: challenge.id, code }), /OTP_INVALID|OTP_EXPIRED/);
  const sessions = await p.authService.listSessions();
  assert.equal(sessions.length, 1, 'the replaced session was tidied up');

  const overview = await d.doctorService.patientOverview(shared.patientId);
  assert.equal(overview.patient.fullName, 'Asha Rao');
  assert.equal(overview.patient.email, '');
  assert.equal(overview.allergies.length, 1);
  assert.equal((await d.accessService.listForDoctor()).active.length, 1);
});

test('the doctor adds a visit; the patient sees it, with the doctor’s file', async () => {
  const d = apps.doctor;
  const p = apps.patient;
  const res = await d.recordService.addConsultation({
    patientId: shared.patientId, date: '2026-09-28', reason: 'Fatigue', symptoms: 'Tired for 3 weeks',
    diagnosis: { condition: 'Anaemia', status: 'Active', severity: 'Mild' },
    prescriptions: [{ name: 'Ferrous sulphate', dosage: '200 mg', frequency: 'Once daily', durationDays: 30, startDate: '2026-09-28' }],
    labOrders: [{ test: 'Complete blood count' }], followUp: '2026-10-12',
    files: [file('referral-note.pdf', '%PDF-1.4 referral note from Dr. Menon', 'report')],
  });
  assert.equal(res.created.length, 5);
  assert.equal(res.consultation.createdBy.name, doctor.name);
  assert.equal(res.consultation.organization.name, 'Northbridge Hospital');
  assert.equal(res.consultation.attachments.length, 1);

  const dx = res.created.find((r) => r.type === 'diagnosis');
  const amended = await d.recordService.amend(dx.id, { date: dx.date, data: { ...dx.data, condition: 'Iron-deficiency anaemia' }, reason: 'Confirmed by ferritin' });
  assert.equal(amended.version, 2);
  assert.equal(amended.versions[0].data.condition, 'Anaemia');
  const order = res.created.find((r) => r.type === 'lab_test');
  await d.recordService.get(res.consultation.id);
  await d.recordService.addLabResult(order.id, { result: 'Hb 10.2 g/dL', status: 'Low' }, '2026-09-29');
  await rejectsWith(d.recordService.create({ patientId: shared.patientId, type: 'mental_health', date: '2026-09-28', data: { topic: 'x' } }), /ACCESS_DENIED: The patient hasn’t shared this part/);

  const notes = await p.notificationService.list();
  assert.ok(notes.some((n) => /Dr\. Kavya Menon added a consultation, a diagnosis, 1 prescription, 1 lab order and 1 attachment to your medical record\./.test(n.body)));
  assert.ok(notes.some((n) => n.body === 'Dr. Kavya Menon added your Complete blood count result.'));
  assert.ok((await p.notificationService.unreadCount()) > 0);
  await p.notificationService.markAllRead();
  assert.equal(await p.notificationService.unreadCount(), 0);

  const { record, children } = await p.recordService.get(res.consultation.id);
  assert.equal(children.length, 4);
  const docs = await p.documentService.list();
  const referral = docs.find((x) => x.name === 'referral-note.pdf');
  assert.match(referral.recordLabel, /^Consultation: Fatigue/);
  const opened = await p.documentService.open(referral.id);
  assert.equal(await opened.blob.text(), '%PDF-1.4 referral note from Dr. Menon');
  await rejectsWith(p.documentService.remove(referral.id), /stay with the record/);
  await rejectsWith(p.recordService.amend(record.id, { date: record.date, data: { ...record.data, reason: 'Edited' }, reason: 'mine now' }), /can only be corrected by a doctor/);

  const today = await p.medicationService.today();
  const iron = today.find((dose) => dose.name === 'Ferrous sulphate');
  assert.equal(iron?.time, '08:00', 'the prescription got a default reminder');
  await p.medicationService.logDose(iron.recordId, iron.date, iron.time, 'taken');
  assert.equal((await p.medicationService.today()).find((x) => x.key === iron.key).status, 'taken');
  await p.medicationService.undoDose(iron.recordId, iron.date, iron.time);
  await p.medicationService.setReminder(iron.recordId, ['09:15'], true);
  assert.equal((await p.medicationService.today()).find((x) => x.recordId === iron.recordId).time, '09:15');
  const log = await p.auditService.forPatient();
  for (const a of ['account_created', 'signed_in', 'document_uploaded', 'record_added', 'record_amended', 'access_granted', 'viewed_record']) {
    assert.ok(log.some((e) => e.action === a), `log has ${a}`);
  }
  assert.ok(log.some((e) => e.action === 'record_added' && e.actor.name === doctor.name));
  const activity = await d.auditService.forDoctor();
  assert.ok(activity.every((a) => a.actor.id === shared.doctorId));
});

test('the patient exports and searches their record', async () => {
  const p = apps.patient;
  const out = await p.exportService.build(['all'], 'json');
  const json = JSON.parse(await out.blob.text());
  assert.equal(json.patient.name, 'Asha Rao');
  assert.ok(json.records.length >= 8);
  const hits = await p.searchPatient('ferrous');
  assert.ok(hits.some((h) => h.kind === 'record'));
  const cal = await p.medicationService.calendarFile();
  assert.ok(cal.count >= 2);
});

test('revoking ends the doctor’s access at once', async () => {
  const d = apps.doctor;
  const p = apps.patient;
  const docs = await d.documentService.list(shared.patientId);
  assert.ok(docs.length >= 1);
  await p.accessService.revoke(shared.grantId);
  await rejectsWith(d.recordService.list(shared.patientId), /ACCESS_DENIED/);
  await rejectsWith(d.documentService.open(docs[0].id), /ACCESS_DENIED/);
  const o = await d.accessService.listForDoctor();
  assert.equal(o.active.length, 0);
  assert.equal(o.past[0].patient.fullName, 'A••• R••');
  const { past } = await p.accessService.listForPatient();
  assert.equal(past[0].status, 'revoked');
});

test('password change and reset', async () => {
  const d = apps.doctor;
  await rejectsWith(d.authService.changePassword('not-my-password1', 'New-Kavya-2026'), /AUTH_FAILED/);
  await d.authService.changePassword(doctor.password, 'New-Kavya-2026');
  await d.authService.logout();
  assert.equal(await d.authService.currentUser(), null);
  await rejectsWith(d.authService.startLogin(doctor.email, doctor.password), /AUTH_FAILED/);

  const before = stack.mailCount();
  const c = await d.authService.startPasswordReset(doctor.email);
  await d.authService.completePasswordReset(c.id, await stack.codeFor(doctor.email, before), 'Reset-Kavya-2026');
  const b2 = stack.mailCount();
  const c2 = await d.authService.startLogin(doctor.email, 'Reset-Kavya-2026');
  const user = await d.authService.completeLogin(c2.id, await stack.codeFor(doctor.email, b2));
  assert.equal(user.role, 'doctor');
});
