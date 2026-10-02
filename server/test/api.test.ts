/**
 * End-to-end API tests for flows A–E, run against the real Express app and an
 * in-memory Postgres (PGlite). `npm test`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), 'niveda-files-'));
const { openDatabase } = await import('../src/db/setup');
const { createApp } = await import('../src/app');
const request = (await import('supertest')).default;

const db = await openDatabase({ memory: true, seedDemo: true });
const app = createApp(db);
const DEMO_PW = 'demo1234';
const pdf = Buffer.from('%PDF-1.4\n%test\n');

type Agent = ReturnType<typeof request.agent>;
const agent = () => request.agent(app);
const post = (a: Agent, url: string, body?: object) => a.post(url).set('x-niveda', '1').send(body ?? {});

async function login(a: Agent, email: string, password = DEMO_PW) {
  const c = await post(a, '/api/auth/login/start', { identifier: email, password });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const r = await post(a, '/api/auth/login/complete', { challengeId: c.body.id, code: c.body.devCode });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function verify(a: Agent, purpose: string) {
  const c = await post(a, '/api/auth/verify', { purpose });
  assert.equal(c.status, 200);
  return { challengeId: c.body.id as string, code: c.body.devCode as string };
}

const patient = agent();
const doctor = agent();
let patientId = '';
let patientCode = '';
let consultationId = '';

test('security basics', async () => {
  const r = await request(app).get('/api/records');
  assert.equal(r.status, 401);
  const csrf = await request(app).post('/api/auth/login/start').send({ identifier: 'x', password: 'y' });
  assert.equal(csrf.status, 403, 'mutations without the custom header are refused');
  const bad = await post(agent(), '/api/auth/login/start', { identifier: 'meera@example.com', password: 'wrong' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, 'AUTH_FAILED');
  const audit = await db.query('SELECT id FROM audit_logs LIMIT 1');
  await assert.rejects(db.query('DELETE FROM audit_logs WHERE id = $1', [audit[0].id]), /append-only/);
});

test('Flow A — sign up with a code, compulsory onboarding, records in timeline', async () => {
  const start = await post(patient, '/api/auth/signup/start', { fullName: 'Kiran Rao', dateOfBirth: '1992-05-17', email: 'kiran@example.com', phone: '+91 90909 12345', password: 'Health2026' });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const wrong = await post(patient, '/api/auth/signup/complete', { challengeId: start.body.id, code: start.body.devCode === '000000' ? '111111' : '000000' });
  assert.equal(wrong.body.error.code, 'OTP_INVALID');
  const done = await post(patient, '/api/auth/signup/complete', { challengeId: start.body.id, code: start.body.devCode });
  assert.equal(done.status, 200);
  assert.equal(done.body.user.onboarded, false);
  patientId = done.body.patient.id;
  patientCode = done.body.patient.patientCode;

  const base = {
    bloodGroup: 'O+', emergencyContact: { name: 'Asha', relationship: 'Mother', phone: '+91 90000 00000' },
    allergies: [{ allergen: 'Sulfa drugs', severity: 'Severe', reaction: 'Rash' }], noAllergies: false,
    conditions: [], noConditions: true,
    medications: [{ name: 'Vitamin D3', dosage: '1000 IU', frequency: 'Twice daily', times: ['07:30', '19:30'] }], noMedications: false,
    history: [{ kind: 'surgery', name: 'Tonsillectomy', date: '2010-06-01', hospital: 'City Hospital' }], noHistory: false,
    documents: [], noDocuments: false,
  };
  const missing = await patient.post('/api/patient/onboarding').set('x-niveda', '1').field('payload', JSON.stringify(base));
  assert.equal(missing.status, 400);
  assert.match(missing.body.error.message, /medical documents/);
  const noEc = await patient.post('/api/patient/onboarding').set('x-niveda', '1').field('payload', JSON.stringify({ ...base, noDocuments: true, emergencyContact: { name: '', relationship: '', phone: '' } }));
  assert.match(noEc.body.error.message, /emergency contact/);

  const ok = await patient.post('/api/patient/onboarding').set('x-niveda', '1')
    .field('payload', JSON.stringify({ ...base, documents: [{ name: 'discharge.pdf', category: 'discharge', date: '2010-06-03', linkTo: 'history:0' }] }))
    .attach('files', pdf, { filename: 'discharge.pdf', contentType: 'application/pdf' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const me = await patient.get('/api/auth/me');
  assert.equal(me.body.user.onboarded, true);
  assert.equal(me.body.patient.emergencyContact.name, 'Asha');

  const docs = await patient.get('/api/documents');
  assert.equal(docs.body.length, 1);
  assert.match(docs.body[0].recordLabel, /Tonsillectomy/);
  const file = await patient.get(`/api/documents/${docs.body[0].id}/file`);
  assert.equal(file.status, 200);
  assert.equal(Buffer.from(file.body).toString(), pdf.toString(), 'file decrypts to the original');

  const add = await patient.post('/api/records').set('x-niveda', '1').field('payload', JSON.stringify({ type: 'vaccination', date: '2025-11-03', data: { vaccine: 'Tetanus (Td)', dose: 'Booster' } }));
  assert.equal(add.status, 200);
  const list = await patient.get('/api/records');
  assert.ok(list.body.some((r: { data: { vaccine?: string } }) => r.data.vaccine === 'Tetanus (Td)'));
  const bad = await patient.post('/api/records').set('x-niveda', '1').field('payload', JSON.stringify({ type: 'medication', date: '2025-01-01', data: { name: 'X' } }));
  assert.equal(bad.status, 400);

  const doses = await patient.get('/api/medications/today');
  assert.equal(doses.body.length, 2);
  const log = await post(patient, '/api/medications/doses', { recordId: doses.body[0].recordId, date: doses.body[0].date, time: doses.body[0].time, status: 'taken' });
  assert.equal(log.status, 200);
  const cal = await patient.get('/api/medications/calendar.ics');
  assert.match(cal.text, /BEGIN:VALARM/);
  const rmEc = await patient.patch('/api/patient/profile').set('x-niveda', '1').send({ emergencyContact: null });
  assert.equal(rmEc.status, 400);
});

test('Flow B — patient grants access with permissions, duration and a code', async () => {
  await login(doctor, 'priya.sharma@lakeview.example');
  const look = await doctor.get(`/api/access/lookup/${patientCode}`);
  assert.equal(look.body.status, 'none');
  assert.match(look.body.maskedName, /•/);
  assert.equal((await doctor.get(`/api/records?patientId=${patientId}`)).status, 403);

  const d = await patient.get('/api/access/doctors/by-code/PS-4821');
  assert.equal(d.body.fullName, 'Dr. Priya Sharma');
  const noCode = await post(patient, '/api/access/grants', { doctorId: d.body.id, permissions: ['history'], hours: 24, method: 'code', challengeId: 'x', code: '123456' });
  assert.equal(noCode.status, 400);
  const v = await verify(patient, 'grant_access');
  const g = await post(patient, '/api/access/grants', { doctorId: d.body.id, permissions: ['history', 'medications', 'allergies', 'labs', 'surgeries', 'vaccinations'], hours: 24, method: 'code', ...v });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const recs = await doctor.get(`/api/records?patientId=${patientId}`);
  assert.equal(recs.status, 200);
  assert.ok(recs.body.length >= 4);
});

test('Flow C — doctor adds directly to the existing record', async () => {
  const res = await doctor.post('/api/records/consultation').set('x-niveda', '1')
    .field('payload', JSON.stringify({
      patientId, date: new Date().toISOString().slice(0, 10), reason: 'Cough and fever', symptoms: 'Fever 38.4',
      diagnosis: { condition: 'Community-acquired pneumonia', status: 'Active', severity: 'Mild' },
      prescriptions: [{ name: 'Azithromycin', dosage: '500 mg', frequency: 'Once daily', durationDays: 5, startDate: new Date().toISOString().slice(0, 10) }],
      labOrders: [{ test: 'Chest X-ray' }], files: [{ name: 'exam.pdf', category: 'report' }],
    }))
    .attach('files', pdf, { filename: 'exam.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  consultationId = res.body.consultation.id;
  assert.equal(res.body.created.length, 4);
  assert.equal(res.body.consultation.createdBy.name, 'Dr. Priya Sharma');
  assert.equal(res.body.consultation.organization.name, 'Lakeview Hospital');

  const dx = res.body.created.find((r: { type: string }) => r.type === 'diagnosis');
  const am = await post(doctor, `/api/records/${dx.id}/amend`, { date: dx.date, data: { ...dx.data, condition: 'Right lower lobe pneumonia' }, reason: 'X-ray confirmed' });
  assert.equal(am.status, 200);
  assert.equal(am.body.version, 2);
  assert.equal(am.body.versions[0].data.condition, 'Community-acquired pneumonia');
  assert.equal(am.body.createdBy.name, 'Dr. Priya Sharma');

  const order = res.body.created.find((r: { type: string }) => r.type === 'lab_test');
  const lr = await doctor.post(`/api/records/${order.id}/lab-result`).set('x-niveda', '1').field('payload', JSON.stringify({ date: new Date().toISOString().slice(0, 10), data: { result: 'Consolidation right base', status: 'Abnormal' } }));
  assert.equal(lr.status, 200);
  const detail = await doctor.get(`/api/records/${order.id}`);
  assert.equal(detail.body.record.data.status, 'Completed');

  const summary = await patient.get('/api/patient/summary');
  assert.ok(summary.body.activeMedications.some((m: { data: { name: string } }) => m.data.name === 'Azithromycin'));
  const sched = await patient.get('/api/medications/schedules');
  const azi = sched.body.find((s: { record: { data: { name: string } } }) => s.record.data.name === 'Azithromycin');
  assert.deepEqual(azi.reminder.times, ['08:00']);
  const notes = await patient.get('/api/notifications');
  assert.ok(notes.body.some((n: { body: string }) => n.body.includes('Dr. Priya Sharma added a consultation')));
  const patAmend = await post(patient, `/api/records/${consultationId}/amend`, { date: res.body.consultation.date, data: { reason: 'x' }, reason: 'x' });
  assert.equal(patAmend.status, 403);
  const docs = await patient.get('/api/documents');
  const drDoc = docs.body.find((d: { uploadedBy: { role: string } }) => d.uploadedBy.role === 'doctor');
  assert.equal((await patient.delete(`/api/documents/${drDoc.id}`).set('x-niveda', '1')).status, 403);
});

test('Flow D — revoked access ends immediately; sensitive data stays hidden; access expires', async () => {
  const list = await patient.get('/api/access');
  const g = list.body.active.find((x: { doctor: { fullName: string } }) => x.doctor.fullName === 'Dr. Priya Sharma');
  assert.equal((await post(patient, `/api/access/grants/${g.id}/revoke`)).status, 200);
  assert.equal((await doctor.get(`/api/records?patientId=${patientId}`)).status, 403);
  assert.equal((await doctor.get(`/api/records/${consultationId}`)).status, 403);
  const write = await doctor.post('/api/records/consultation').set('x-niveda', '1').field('payload', JSON.stringify({ patientId, date: '2026-01-01', reason: 'x', prescriptions: [], labOrders: [] }));
  assert.equal(write.status, 403);

  const meera = await doctor.get('/api/records?patientId=p_meera');
  assert.equal(meera.status, 200);
  assert.ok(!meera.body.some((r: { type: string }) => r.type === 'mental_health'), 'mental health not shared by default');

  const rq = await post(doctor, '/api/access/requests', { patientId, permissions: ['history'], hours: 1, reason: 'Review' });
  assert.equal(rq.status, 200);
  const v = await verify(patient, 'approve_request');
  assert.equal((await post(patient, `/api/access/requests/${rq.body.id}/approve`, { permissions: ['history'], hours: 1, ...v })).status, 200);
  assert.equal((await doctor.get(`/api/records?patientId=${patientId}`)).status, 200);
  await db.query(`UPDATE access_grants SET expires_at = now() - interval '1 minute' WHERE patient_id = $1 AND status = 'active'`, [patientId]);
  assert.equal((await doctor.get(`/api/records?patientId=${patientId}`)).status, 403);
});

test('Flow E — the patient sees who did what and when', async () => {
  const log = await patient.get('/api/audit/patient');
  const actions = new Set(log.body.map((a: { action: string }) => a.action));
  for (const a of ['account_created', 'signed_in', 'access_granted', 'record_added', 'record_amended', 'viewed_record', 'document_uploaded', 'access_revoked', 'access_requested', 'request_approved', 'access_expired']) {
    assert.ok(actions.has(a), `missing ${a}`);
  }
  const sessions = await patient.get('/api/auth/sessions');
  assert.ok(sessions.body.some((s: { current: boolean }) => s.current));
  await post(patient, '/api/auth/logout');
  assert.equal((await patient.get('/api/records')).status, 401);
});

test.after(async () => { await db.close(); });
