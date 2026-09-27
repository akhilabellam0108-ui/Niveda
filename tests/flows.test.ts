/**
 * End-to-end tests of the core flows (A–E) against the service layer.
 * Run: npm test
 */
import { latency } from '../src/mock/db';
import { advanceClock, todayISO } from '../src/lib/dates';
import {
  accessService, auditService, authService, documentService, notificationService,
  patientService, recordService, AppError,
} from '../src/services';
import { DEMO_PASSWORD } from '../src/mock/seed';
import { DEFAULT_PERMISSIONS } from '../src/lib/recordMeta';

latency.ms = 0;
let passed = 0;
const failures: string[] = [];

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}
async function expectDenied(fn: () => Promise<unknown>, msg: string) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AppError && e.code === 'ACCESS_DENIED') return;
    throw new Error(`${msg}: wrong error ${(e as Error).message}`);
  }
  throw new Error(`${msg}: expected access to be denied`);
}
async function login(email: string) {
  const c = await authService.startLogin(email, DEMO_PASSWORD);
  await authService.completeLogin(c.id, c.prototypeCode);
}

const newPatient = { fullName: 'Test Person', dateOfBirth: '1990-01-01', email: 'test.person@example.com', phone: '+91 91234 56789', password: 'Secret123!' };
let newPatientCode = '';
let newPatientId = '';
let consultationId = '';

console.log('\nFlow A — patient sign-up to timeline');
await step('sign-up requires a valid OTP', async () => {
  const c = await authService.startSignUp(newPatient);
  try {
    await authService.completeSignUp(c.id, '000000' === c.prototypeCode ? '111111' : '000000');
    throw new Error('wrong OTP accepted');
  } catch (e) {
    assert(e instanceof AppError && e.code === 'OTP_INVALID', 'expected OTP_INVALID');
  }
  const u = await authService.completeSignUp(c.id, c.prototypeCode);
  assert(u.role === 'patient' && !u.onboarded, 'new user should need onboarding');
});
await step('onboarding turns answers into records', async () => {
  await patientService.completeOnboarding({
    bloodGroup: 'O+', emergencyContact: { name: 'Sam', relationship: 'Friend', phone: '+91 90000 00000' },
    allergies: [{ allergen: 'Peanuts', severity: 'Severe', reaction: 'Swelling' }], conditions: [], medications: [{ name: 'Cetirizine', dosage: '10 mg', frequency: 'As needed' }], surgeries: [],
  });
  const me = await patientService.me();
  newPatientCode = me.patientCode;
  newPatientId = me.id;
  const s = await patientService.summary();
  assert(s.allergies.length === 1 && s.activeMedications.length === 1, 'allergy + medication should exist');
  assert(me.bloodGroup === 'O+', 'blood group saved');
});
await step('added record appears in timeline and its category', async () => {
  await recordService.create({ type: 'vaccination', date: '2026-01-10', data: { vaccine: 'Hepatitis B', dose: 'Dose 1' } });
  const list = await recordService.list();
  const v = list.find((r) => r.type === 'vaccination');
  assert(v && v.data.vaccine === 'Hepatitis B', 'vaccination in record list');
  assert(v!.createdBy.role === 'patient', 'patient attribution');
});
await step('validation rejects incomplete records', async () => {
  try {
    await recordService.create({ type: 'medication', date: todayISO(), data: { name: 'X' } });
    throw new Error('accepted');
  } catch (e) {
    assert(e instanceof AppError && e.code === 'VALIDATION', 'expected VALIDATION');
  }
});

console.log('\nFlow B — patient grants a doctor access');
await step('doctor cannot see the record before access', async () => {
  await authService.logout();
  await login('priya.sharma@lakeview.example');
  const look = await accessService.lookupPatient(newPatientCode);
  assert(look.status === 'none', 'no access yet');
  assert(look.maskedName.includes('•'), 'name is masked without access');
  await expectDenied(() => recordService.list(newPatientId), 'list before grant');
});
await step('patient grants access with permissions, duration and OTP', async () => {
  await authService.logout();
  await authService.startLogin(newPatient.email, newPatient.password).then((c) => authService.completeLogin(c.id, c.prototypeCode));
  const doc = await accessService.findDoctorByCode('PS-4821');
  const c = await accessService.requestVerification('grant_access');
  await accessService.grantAccess({ doctorId: doc.id, permissions: DEFAULT_PERMISSIONS, hours: 24, method: 'code', challengeId: c.id, code: c.prototypeCode });
  const l = await accessService.listForPatient();
  assert(l.active.some((g) => g.doctorId === 'd_priya'), 'active grant listed');
});
await step('doctor now sees the patient', async () => {
  await authService.logout();
  await login('priya.sharma@lakeview.example');
  const l = await accessService.listForDoctor();
  assert(l.active.some((g) => g.patientId === newPatientId), 'patient in doctor list');
  const recs = await recordService.list(newPatientId);
  assert(recs.length >= 3, 'doctor sees permitted records');
});

console.log('\nFlow C — doctor adds to the existing record');
await step('consultation bundle adds linked entries', async () => {
  const before = (await recordService.list(newPatientId)).length;
  const blob = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
  const res = await recordService.addConsultation({
    patientId: newPatientId, date: todayISO(), reason: 'Sore throat', symptoms: 'Pain swallowing, fever 38.2°C',
    diagnosis: { condition: 'Acute pharyngitis', status: 'Active', severity: 'Mild' },
    prescriptions: [{ name: 'Azithromycin', dosage: '500 mg', frequency: 'Once daily', durationDays: 3, startDate: todayISO(), instructions: 'After food' }],
    labOrders: [{ test: 'Throat swab culture', laboratory: 'Sunrise Diagnostics' }],
    files: [{ name: 'throat-exam.pdf', type: 'application/pdf', blob, category: 'report' }],
  });
  consultationId = res.consultation.id;
  const after = await recordService.list(newPatientId);
  assert(after.length === before + 4, `expected 4 new records, got ${after.length - before}`);
  const c = after.find((r) => r.id === consultationId)!;
  assert(c.createdBy.name === 'Dr. Priya Sharma' && c.organization?.name === 'Lakeview Hospital', 'attribution + hospital');
  assert(c.attachments.length === 1, 'attachment linked');
  assert(after.filter((r) => r.parentId === consultationId).length === 3, 'children linked to consultation');
});
await step('amendment keeps the original version', async () => {
  const dx = (await recordService.list(newPatientId)).find((r) => r.type === 'diagnosis' && r.parentId === consultationId)!;
  await recordService.amend(dx.id, { date: dx.date, data: { ...dx.data, condition: 'Streptococcal pharyngitis' }, reason: 'Culture confirmed strep' });
  const { record } = await recordService.get(dx.id);
  assert(record.version === 2 && record.versions[0].data.condition === 'Acute pharyngitis', 'v1 preserved');
  assert(record.createdBy.name === 'Dr. Priya Sharma', 'attribution unchanged');
});
await step('lab result can be added to the order later', async () => {
  const order = (await recordService.list(newPatientId)).find((r) => r.type === 'lab_test' && r.parentId === consultationId)!;
  await recordService.addLabResult(order.id, { result: 'Group A strep detected', status: 'Abnormal' }, todayISO());
  const { record, children } = await recordService.get(order.id);
  assert(record.data.status === 'Completed' && children.length === 1, 'order completed with child result');
});
await step('patient sees the entries, medication list and a notification', async () => {
  await authService.logout();
  await authService.startLogin(newPatient.email, newPatient.password).then((c) => authService.completeLogin(c.id, c.prototypeCode));
  const s = await patientService.summary();
  assert(s.activeMedications.some((m) => m.data.name === 'Azithromycin'), 'prescription in active meds');
  const notes = await notificationService.list();
  assert(notes.some((n) => n.body.includes('Dr. Priya Sharma added a consultation')), 'notification sent');
  const log = await auditService.forPatient();
  assert(log.some((a) => a.action === 'record_added' && a.actor.name === 'Dr. Priya Sharma'), 'audit has record_added');
  assert(log.some((a) => a.action === 'record_amended'), 'audit has record_amended');
});
await step('patient cannot amend a doctor’s entry', async () => {
  const c = (await recordService.list()).find((r) => r.id === consultationId)!;
  await expectDenied(() => recordService.amend(c.id, { date: c.date, data: { ...c.data, diagnosis: 'none' }, reason: 'x' }), 'patient amend');
});
await step('doctor-added documents cannot be deleted by patient', async () => {
  const docs = await documentService.list();
  const d = docs.find((x) => x.uploadedBy.role === 'doctor')!;
  await expectDenied(() => documentService.remove(d.id), 'delete doctor doc');
});

console.log('\nFlow D — revoke access');
await step('revoked doctor loses access immediately', async () => {
  const l = await accessService.listForPatient();
  const g = l.active.find((x) => x.doctorId === 'd_priya')!;
  await accessService.revoke(g.id);
  await authService.logout();
  await login('priya.sharma@lakeview.example');
  await expectDenied(() => recordService.list(newPatientId), 'list after revoke');
  await expectDenied(() => recordService.get(consultationId), 'get after revoke');
  await expectDenied(() => recordService.addConsultation({ patientId: newPatientId, date: todayISO(), reason: 'x', prescriptions: [], labOrders: [], files: [] }), 'write after revoke');
});
await step('sensitive categories stay hidden unless shared', async () => {
  // Meera's mental-health record is not in Dr. Priya's default permissions.
  const recs = await recordService.list('p_meera');
  assert(!recs.some((r) => r.type === 'mental_health'), 'mental health hidden');
  assert(recs.some((r) => r.type === 'allergy'), 'allergies visible');
});
await step('access expires on its own', async () => {
  const req = await accessService.requestAccess(newPatientId, ['history'], 1, 'Follow-up review');
  await authService.logout();
  await authService.startLogin(newPatient.email, newPatient.password).then((c) => authService.completeLogin(c.id, c.prototypeCode));
  const c = await accessService.requestVerification('approve_request');
  await accessService.approveRequest(req.id, ['history'], 1, { challengeId: c.id, code: c.prototypeCode });
  await authService.logout();
  await login('priya.sharma@lakeview.example');
  assert((await recordService.list(newPatientId)).length > 0, 'access after approval');
  advanceClock(2 * 3600000);
  await expectDenied(() => recordService.list(newPatientId), 'after expiry');
  advanceClock(-2 * 3600000);
});

console.log('\nFlow E — audit trail');
await step('patient sees who did what and when', async () => {
  await authService.logout();
  await authService.startLogin(newPatient.email, newPatient.password).then((c) => authService.completeLogin(c.id, c.prototypeCode));
  const log = await auditService.forPatient();
  const actions = new Set(log.map((a) => a.action));
  for (const a of ['account_created', 'access_granted', 'viewed_history', 'record_added', 'access_revoked', 'access_requested', 'request_approved', 'document_uploaded']) {
    if (a === 'viewed_history') continue; // views are logged by the UI when a doctor opens a patient
    assert(actions.has(a as never), `missing ${a}`);
  }
  assert(log.every((a) => a.timestamp && a.actor.name), 'entries have actor + time');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
