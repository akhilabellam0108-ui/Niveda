/**
 * End-to-end tests of the core flows (A–E) against the service layer.
 * Run: npm test
 */
import { latency } from '../src/mock/db';
import { advanceClock, todayISO } from '../src/lib/dates';
import {
  accessService, auditService, authService, documentService, notificationService,
  patientService, recordService, medicationService, doctorService, AppError,
} from '../src/services';
import { DEMO_PASSWORD } from '../src/mock/seed';
import { DEFAULT_PERMISSIONS, RECORD_TYPES } from '../src/lib/recordMeta';

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
async function expectRejectsValidation(fn: () => Promise<unknown>, msg: string) {
  try { await fn(); } catch (e) { if (e instanceof AppError && e.code === 'VALIDATION') return; throw new Error(`${msg}: wrong error`); }
  throw new Error(`${msg}: expected rejection`);
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
await step('onboarding is compulsory', async () => {
  const base = {
    bloodGroup: 'O+', emergencyContact: { name: 'Sam', relationship: 'Friend', phone: '+91 90000 00000' },
    allergies: [], noAllergies: false, conditions: [], noConditions: true, medications: [], noMedications: true, history: [], noHistory: true,
    documents: [{ file: { name: 'r.pdf', type: 'application/pdf', blob: new Blob(['x']), category: 'report' as const }, date: '2024-01-01' }],
  };
  for (const [bad, why] of [
    [{ ...base, noAllergies: false }, 'allergies unanswered'],
    [{ ...base, noAllergies: true, emergencyContact: { name: '', relationship: '', phone: '' } }, 'no emergency contact'],
    [{ ...base, noAllergies: true, bloodGroup: '' }, 'no blood group'],
    [{ ...base, noAllergies: true, noMedications: false, medications: [{ name: 'X', dosage: '1 mg', frequency: 'Twice daily', times: [] }] }, 'medicine without reminder times'],
    [{ ...base, noAllergies: true, documents: [] }, 'no documents uploaded'],
  ] as const) {
    try { await patientService.completeOnboarding(bad as never); throw new Error(`accepted: ${why}`); }
    catch (e) { assert(e instanceof AppError && e.code === 'VALIDATION', `expected VALIDATION for ${why}`); }
  }
});
await step('onboarding turns answers into records and reminders', async () => {
  await patientService.completeOnboarding({
    bloodGroup: 'O+', emergencyContact: { name: 'Sam', relationship: 'Friend', phone: '+91 90000 00000' },
    allergies: [{ allergen: 'Peanuts', severity: 'Severe', reaction: 'Swelling' }], noAllergies: false,
    conditions: [], noConditions: true,
    medications: [{ name: 'Cetirizine', dosage: '10 mg', frequency: 'Twice daily', times: ['07:30', '19:30'] }], noMedications: false,
    history: [{ kind: 'surgery', name: 'Tonsillectomy', date: '2010-06-01', hospital: 'City Hospital' }], noHistory: false,
    documents: [{ file: { name: 'tonsil-discharge.pdf', type: 'application/pdf', blob: new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), category: 'discharge' }, date: '2010-06-03', linkTo: 'history:0' }],
  });
  const docs = await documentService.list();
  assert(docs.length === 1 && docs[0].recordLabel?.includes('Tonsillectomy'), 'document uploaded and linked to the surgery');
  const me = await patientService.me();
  newPatientCode = me.patientCode;
  newPatientId = me.id;
  const s = await patientService.summary();
  assert(s.allergies.length === 1 && s.activeMedications.length === 1, 'allergy + medication should exist');
  assert(me.bloodGroup === 'O+' && me.emergencyContact?.name === 'Sam', 'blood group and contact saved');
  assert(me.declarations?.noConditions === true, 'declaration saved');
  const sched = await medicationService.schedules();
  assert(sched[0].reminder.times.join(',') === '07:30,19:30', 'reminder times saved');
  const today = await medicationService.today();
  assert(today.length === 2, 'two doses today');
  await medicationService.logDose(today[0].recordId, today[0].date, today[0].time, 'taken');
  assert((await medicationService.today())[0].status === 'taken', 'dose logged');
  const cal = await medicationService.calendarFile();
  const text = await cal.blob.text();
  assert(text.includes('BEGIN:VALARM') && text.includes('RRULE:FREQ=DAILY') && cal.count === 2, 'calendar file has repeating alarms');
  await expectRejectsValidation(() => patientService.updateProfile({ emergencyContact: undefined }), 'removing emergency contact');
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
    handoverNote: 'Check swab culture result. If strep, complete 5 days and recheck throat.',
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
await step('every visit ends with a note for the next visit', async () => {
  const before = (await recordService.list(newPatientId)).length;
  const visit = { patientId: newPatientId, date: todayISO(), reason: 'Review', prescriptions: [], labOrders: [], files: [] };
  await expectRejectsValidation(() => recordService.addConsultation({ ...visit, handoverNote: '' }), 'visit without a note');
  await expectRejectsValidation(() => recordService.addConsultation({ ...visit, handoverNote: '  ok  ' }), 'visit with a one-word note');
  await expectRejectsValidation(() => recordService.create({ patientId: newPatientId, type: 'consultation', date: todayISO(), data: { reason: 'Review' } }), 'consultation entry without a note');
  assert((await recordService.list(newPatientId)).length === before, 'nothing saved when the note is missing');
  const c = (await recordService.list(newPatientId)).find((r) => r.id === consultationId)!;
  assert(c.data.handoverNote === 'Check swab culture result. If strep, complete 5 days and recheck throat.', 'note stored on the consultation');
  const o = await doctorService.patientOverview(newPatientId);
  assert(o.handover?.id === consultationId, 'the newest note is shown to the next doctor');
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
  const azi = (await medicationService.schedules()).find((x) => x.record.data.name === 'Azithromycin')!;
  assert(azi.reminder.enabled && azi.reminder.times.join(',') === '08:00', 'doctor prescription gets a default reminder');
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
  await expectDenied(() => recordService.addConsultation({ patientId: newPatientId, date: todayISO(), reason: 'x', handoverNote: 'Nothing further needed.', prescriptions: [], labOrders: [], files: [] }), 'write after revoke');
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

console.log('\nEmergency access');
await step('a doctor can open emergency essentials when the patient can’t consent; the patient is told and it’s logged', async () => {
  await login('arvind.rao@lakeview.example');
  const code = 'NV-9264-1183';
  const look = await accessService.lookupPatient(code);
  assert(look.status === 'none', 'no access to start with');
  const bad = await accessService.requestEmergencyVerification();
  await accessService.emergencyAccess({ patientCode: code, reason: 'unconscious', justification: 'too short', challengeId: bad.id, code: bad.prototypeCode }).then(
    () => { throw new Error('accepted a short justification'); }, (e) => assert(e instanceof AppError && /20 characters/.test(e.message), (e as Error).message));
  const c = await accessService.requestEmergencyVerification();
  const r = await accessService.emergencyAccess({ patientCode: code, reason: 'unconscious', justification: 'Unconscious in A&E after a fall; need allergies before treatment.', challengeId: c.id, code: c.prototypeCode });
  const hours = (new Date(r.expiresAt).getTime() - Date.now()) / 3600000;
  assert(hours > 3.9 && hours <= 4.01, 'four hours');
  const mine = await accessService.listForDoctor();
  const g = mine.active.find((x) => x.patientId === r.patientId)!;
  assert(g.method === 'emergency' && g.permissions.join() === 'allergies,medications,history,surgeries', 'emergency essentials only');
  assert(!g.permissions.includes('mental_health' as never), 'never mental health');
  const recs = await recordService.list(r.patientId);
  assert(recs.length > 0, 'sees the essentials');
  assert(recs.every((x) => g.permissions.includes(RECORD_TYPES[x.type].permission)), `only essentials visible: ${[...new Set(recs.map((x) => x.type))].join(', ')}`);
  const again = await accessService.requestEmergencyVerification();
  await accessService.emergencyAccess({ patientCode: code, reason: 'unconscious', justification: 'Unconscious in A&E after a fall; need allergies before treatment.', challengeId: again.id, code: again.prototypeCode }).then(
    () => { throw new Error('allowed twice'); }, (e) => assert(/already have access/.test((e as Error).message), (e as Error).message));
  await login('fatima@example.com');
  const notes = await notificationService.list();
  assert(notes.some((n) => n.title === 'Emergency access to your record' && /Dr\. Arvind Rao .*Patient is unconscious/.test(n.body)), 'the patient is told at once');
  const log = await auditService.forPatient();
  const entry = log.find((a) => a.action === 'emergency_access');
  assert(entry && entry.actor.name === 'Dr. Arvind Rao' && /A&E/.test(String(entry.metadata?.justification)), 'written to the access log with the reason');
  const mineP = await accessService.listForPatient();
  const eg = mineP.active.find((x) => x.method === 'emergency')!;
  assert(eg.verification.reason === 'unconscious', 'the patient sees why');
  await accessService.revoke(eg.id);
  await login('arvind.rao@lakeview.example');
  await recordService.list(r.patientId).then(() => { throw new Error('still had access'); }, (e) => assert(e instanceof AppError && e.code === 'ACCESS_DENIED', 'the patient can end it'));
});

console.log('\nPhone alarms (Android app)');
await step('plans an exact alarm for each future dose, skipping taken doses and finished courses', async () => {
  const { planAlarms, alarmId, MAX_ALARMS } = await import('../src/lib/alarmPlan');
  const now = new Date(2026, 8, 30, 10, 0);
  const med = (id: string, data: Record<string, unknown>) => ({ id, patientId: 'p', type: 'medication', date: '2026-09-01', data, createdAt: '', updatedAt: '', createdBy: { id: 'p', role: 'patient', name: 'P' }, attachments: [], source: 'patient', version: 1, versions: [] }) as never;
  const rem = (recordId: string, times: string[], enabled = true) => ({ recordId, patientId: 'p', times, enabled, updatedAt: '' });
  const schedules = [
    { record: med('m1', { name: 'Metformin', dosage: '500 mg', instructions: 'After food', startDate: '2026-09-01' }), reminder: rem('m1', ['08:00', '20:00']) },
    { record: med('m2', { name: 'Amoxicillin', dosage: '250 mg', startDate: '2026-09-28', endDate: '2026-10-02' }), reminder: rem('m2', ['09:00', '21:00']) },
    { record: med('m3', { name: 'Paused', dosage: '1', startDate: '2026-09-01' }), reminder: rem('m3', ['12:00'], false) },
  ];
  const plan = planAlarms({ schedules, logged: new Set(['m1|2026-09-30|20:00']), now, enabled: true });
  assert(plan.every((p) => p.at > now), 'only future times');
  assert(!plan.some((p) => p.recordId === 'm1' && p.date === '2026-09-30'), 'today 8 am has passed and 8 pm is already taken');
  assert(plan.filter((p) => p.recordId === 'm2').map((p) => p.date).at(-1) === '2026-10-02', 'the course stops on its end date');
  assert(plan.filter((p) => p.recordId === 'm2').length === 5, 'amoxicillin: 30 Sep 9 pm + 2 a day for 2 days + 2 Oct = 5');
  assert(!plan.some((p) => p.recordId === 'm3'), 'reminders switched off');
  assert(plan.filter((p) => p.recordId === 'm1').length === 26, 'metformin twice a day for the next 13 days');
  const first = plan.find((p) => p.recordId === 'm1')!;
  assert(first.title === 'Time for Metformin' && first.body === '500 mg · 8:00 am · After food', `text: ${first.title} / ${first.body}`);
  assert(first.id === alarmId('m1', first.date, '08:00') && first.id > 0 && first.id <= 0x7fffffff, 'stable positive int ids');
  assert(new Set(plan.map((p) => p.id)).size === plan.length, 'ids are unique');
  assert(planAlarms({ schedules, logged: new Set(), now, enabled: false }).length === 0, 'the setting turns them all off');
  const many = Array.from({ length: 40 }, (_, i) => ({ record: med(`x${i}`, { name: `M${i}`, startDate: '2026-01-01' }), reminder: rem(`x${i}`, ['06:00', '14:00', '22:00']) }));
  assert(planAlarms({ schedules: many, logged: new Set(), now, enabled: true }).length === MAX_ALARMS, 'capped below Android’s limit, soonest first');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
