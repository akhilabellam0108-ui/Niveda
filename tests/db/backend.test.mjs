// Database tests for the Supabase backend.
//
// Runs the real migrations against a throwaway Postgres (with a small stand-in
// for Supabase's auth/storage schemas) and plays patients, doctors and an
// attacker against them. Every access rule is checked in the database itself,
// exactly as it will run on Supabase.
//
//   DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
//
// The database named in DATABASE_URL is used only to create and drop a
// temporary database; nothing else is touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ADMIN_URL = process.env.DATABASE_URL;
if (!ADMIN_URL) {
  console.log('DATABASE_URL not set — skipping database tests.');
  process.exit(0);
}
const DB = `niveda_test_${Date.now()}`;
let admin;
let db; // superuser connection to the test database

const root = new URL('../..', import.meta.url).pathname;
const sql = (f) => readFileSync(join(root, f), 'utf8');

/* ---------- helpers ---------- */

const users = {};
let clock = Math.floor(Date.now() / 1000);

/** Runs queries as a signed-in user, the way PostgREST does on Supabase. */
async function as(who, fn, claims = {}) {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    const u = users[who];
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({
      sub: u.id, role: 'authenticated', session_id: u.session, amr: [{ method: 'password', timestamp: clock }], ...claims,
    })]);
    const q = async (text, params) => (await c.query(text, params)).rows;
    const result = await fn(q);
    await c.query('commit');
    return result;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Claims for a session whose email code was just verified (step-up). */
const freshCode = () => ({ amr: [{ method: 'otp', timestamp: ++clock }] });

const rpc = (who, fn, args = [], claims) =>
  as(who, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args).then((r) => r[0].r), claims);

async function rejects(p, pattern) {
  await assert.rejects(p, (e) => {
    assert.match(e.message, pattern);
    return true;
  });
}

async function addUser(key, email, meta = {}) {
  const id = randomUUID();
  const session = randomUUID();
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, meta]);
  await db.query("insert into auth.sessions (id, user_id, user_agent) values ($1, $2, 'Test browser')", [session, id]);
  users[key] = { id, session };
}

const uploadFile = (who, path) => as(who, (q) => q("insert into storage.objects (bucket_id, name) values ('documents', $1)", [path]));

/* ---------- setup ---------- */

before(async () => {
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${DB}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${DB}`;
  db = new pg.Pool({ connectionString: url.toString(), max: 4 });
  await db.query(sql('tests/db/supabase-shim.sql'));
  for (const f of readdirSync(join(root, 'supabase/migrations')).sort()) await db.query(sql(`supabase/migrations/${f}`));

  await db.query("insert into public.hospitals (id, name, city, type) values ('hsp_north', 'Northbridge Hospital', 'Hyderabad', 'hospital'), ('hsp_lake', 'Lakeside Clinic', 'Hyderabad', 'clinic')");
  await addUser('asha', 'asha@example.com', { full_name: 'Asha Rao', date_of_birth: '1990-04-12', phone: '+91 98765 43210' });
  await addUser('vikram', 'vikram@example.com', { full_name: 'Vikram Shah', date_of_birth: '1985-01-02', phone: '+91 91234 56789' });
  await addUser('kavya', 'kavya@example.com');
  await addUser('rohan', 'rohan@example.com');
  await addUser('stranger', 'nobody@example.com');
  for (const [key, name, reg, hospital, code] of [['kavya', 'Dr. Kavya Menon', 'TSMC-10001', 'hsp_north', 'DR-KM01'], ['rohan', 'Dr. Rohan Iyer', 'TSMC-10002', 'hsp_lake', 'DR-RI02']]) {
    const r = await db.query('select public.admin_create_doctor($1, $2) as id', [users[key].id, { fullName: name, specialization: 'General medicine', registrationNumber: reg, hospitalId: hospital, email: `${key}@example.com`, accessCode: code }]);
    users[key].doctorId = r.rows[0].id;
  }
});

after(async () => {
  await db?.end();
  await admin?.query(`drop database if exists ${DB} with (force)`);
  await admin?.end();
});

/* ---------- the one-file setup matches the migrations ---------- */

test('supabase/setup.sql is up to date (run: node scripts/build-setup-sql.mjs)', async () => {
  const { buildSetupSql } = await import(pathToFileURL(join(root, 'scripts/build-setup-sql.mjs')).href);
  assert.equal(sql('supabase/setup.sql'), buildSetupSql());
});

test('setup.sql alone builds the whole database', async () => {
  const name = `${DB}_setup`;
  await admin.query(`create database ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const c = new pg.Client({ connectionString: url.toString() });
  try {
    await c.connect();
    await c.query(sql('tests/db/supabase-shim.sql'));
    await c.query(sql('supabase/setup.sql'));
    const t = (await c.query("select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name in ('patients', 'doctors', 'doctor_applications', 'admins', 'audit_log')")).rows[0].n;
    assert.equal(t, 5);
  } finally {
    await c.end();
    await admin.query(`drop database if exists ${name} with (force)`);
  }
});

/* ---------- the record's rules come from the app's own definitions ---------- */

test('server record types match src/lib/recordMeta.ts', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'nv-')), 'meta.mjs');
  await build({ entryPoints: [join(root, 'src/lib/recordMeta.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
  const { RECORD_TYPES } = await import(pathToFileURL(out).href);
  const rows = (await db.query('select * from public.record_types order by type')).rows;
  assert.equal(rows.length, Object.keys(RECORD_TYPES).length);
  for (const r of rows) {
    const m = RECORD_TYPES[r.type];
    assert.ok(m, r.type);
    assert.deepEqual([r.label, r.permission, r.title_key, r.patient_can_add, r.doctor_can_add], [m.label, m.permission, m.titleKey, m.patientCanAdd, m.doctorCanAdd], r.type);
    assert.deepEqual(r.field_keys, m.fields.map((f) => f.key), r.type);
    assert.deepEqual(r.required_keys, m.fields.filter((f) => f.required).map((f) => f.key), r.type);
  }
});

/* ---------- Flow A: patient sign-up and compulsory setup ---------- */

test('A. sign-up creates the patient, onboarding is compulsory and server-validated', async () => {
  const acct = await rpc('asha', 'complete_signup');
  assert.equal(acct.role, 'patient');
  assert.equal(acct.onboarded, false);
  assert.match((await as('asha', (q) => q('select patient_code from patients')))[0].patient_code, /^NV-\d{4}-\d{4}$/);
  users.asha.patientId = acct.profileId;
  assert.deepEqual(await rpc('asha', 'complete_signup'), acct, 'calling again is harmless');

  await rpc('vikram', 'complete_signup');
  users.vikram.patientId = (await rpc('vikram', 'my_account')).profileId;

  // Same phone number can't be reused.
  await addUser('dup', 'dup@example.com', { full_name: 'Dup', date_of_birth: '1999-01-01', phone: '9876543210' });
  await rejects(rpc('dup', 'complete_signup'), /CONFLICT: This phone number/);

  const base = {
    bloodGroup: 'B+', emergencyContact: { name: 'Ravi Rao', relationship: 'Brother', phone: '+91 90000 11111' },
    allergies: [{ allergen: 'Penicillin', severity: 'Severe', reaction: 'Rash and swelling' }], noAllergies: false,
    conditions: [], noConditions: true,
    medications: [{ name: 'Metformin', dosage: '500 mg', frequency: 'Twice daily', times: ['07:30', '19:30'] }], noMedications: false,
    history: [{ kind: 'surgery', name: 'Appendectomy', date: '2015-06-01', hospital: 'City Hospital' }], noHistory: false,
    documents: [],
  };
  await rejects(rpc('asha', 'complete_onboarding', [base]), /VALIDATION: Upload at least one medical document/);
  await rejects(rpc('asha', 'complete_onboarding', [{ ...base, noConditions: false }]), /ongoing conditions, or confirm/);
  await rejects(rpc('asha', 'complete_onboarding', [{ ...base, emergencyContact: { name: 'X' } }]), /emergency contact/);

  // Upload: a patient may only write into their own folder.
  const docId = 'doc_asha0000000001';
  await rejects(uploadFile('asha', `${users.vikram.patientId}/${docId}`), /row-level security/);
  await rejects(rpc('asha', 'register_document', [null, docId, 'discharge.pdf', 'application/pdf', 1000, 'discharge', '2015-06-05']), /didn’t finish uploading/);
  await uploadFile('asha', `${users.asha.patientId}/${docId}`);
  await rpc('asha', 'register_document', [null, docId, 'discharge.pdf', 'application/pdf', 1000, 'discharge', '2015-06-05']);

  await rpc('asha', 'complete_onboarding', [{ ...base, documents: [{ documentId: docId, linkTo: 'history:0' }] }]);
  assert.equal((await rpc('asha', 'my_account')).onboarded, true);
  await rejects(rpc('asha', 'complete_onboarding', [{ ...base, documents: [{ documentId: docId }] }]), /already set up/);

  const recs = await as('asha', (q) => q('select type, data, attachments from records order by type'));
  assert.deepEqual(recs.map((r) => r.type), ['allergy', 'medication', 'surgery']);
  assert.deepEqual(recs.find((r) => r.type === 'surgery').attachments, [docId]);
  const rem = await as('asha', (q) => q('select times, enabled from medication_reminders'));
  assert.deepEqual(rem[0], { times: ['07:30', '19:30'], enabled: true });
  const p = (await as('asha', (q) => q('select blood_group, emergency_card_enabled, declarations from patients')))[0];
  assert.equal(p.blood_group, 'B+');
  assert.equal(p.emergency_card_enabled, true);
  assert.equal(p.declarations.noConditions, true);

  // A mental-health note the patient keeps private.
  users.asha.privateNote = await rpc('asha', 'create_record', [null, 'mental_health', '2024-02-01', { topic: 'Counselling', provider: 'Dr. Sen' }]);
  // Patients can't add doctor-only entries.
  await rejects(rpc('asha', 'create_record', [null, 'clinical_note', '2024-02-01', { subject: 'x', note: 'y' }]), /added by your doctor/);
  // Server-side validation of required fields and dates.
  await rejects(rpc('asha', 'create_record', [null, 'allergy', '2024-02-01', { allergen: 'Dust' }]), /required fields \(severity, reaction\)/);
  await rejects(rpc('asha', 'create_record', [null, 'allergy', '2099-01-01', { allergen: 'Dust', severity: 'Mild', reaction: 'Sneezing' }]), /too far in the future/);
});

/* ---------- Flow B: access ---------- */

test('B. a doctor sees nothing until the patient grants access with a fresh code', async () => {
  const counts = () => as('kavya', (q) => q('select (select count(*) from records)::int r, (select count(*) from patients)::int p, (select count(*) from documents)::int d, (select count(*) from storage.objects)::int o'));
  assert.deepEqual((await counts())[0], { r: 0, p: 0, d: 0, o: 0 });

  const look = await rpc('kavya', 'lookup_patient', [(await as('asha', (q) => q('select patient_code from patients')))[0].patient_code.replace(/-/g, ' ')]);
  assert.equal(look.status, 'none');
  assert.equal(look.maskedName, 'A••• R••');
  await rejects(rpc('kavya', 'create_record', [users.asha.patientId, 'consultation', '2026-09-28', { reason: 'Check-up' }]), /ACCESS_DENIED: You no longer have access/);
  await rejects(rpc('kavya', 'emergency_profile', [users.asha.patientId]), /ACCESS_DENIED/);

  // Directory hides contact details and access codes; the code works only via lookup.
  const dir = await as('asha', (q) => q('select * from doctor_directory order by full_name'));
  assert.equal(dir.length, 2);
  assert.ok(!('email' in dir[0]) && !('access_code' in dir[0]));
  assert.equal((await as('asha', (q) => q('select count(*)::int n from doctors')))[0].n, 0, 'patients can’t read the doctors table');
  assert.equal((await rpc('asha', 'find_doctor_by_code', ['dr km01'])).id, users.kavya.doctorId);

  const perms = ['history', 'medications', 'allergies', 'labs', 'surgeries'];
  await rejects(rpc('asha', 'grant_access', [users.kavya.doctorId, perms, 24, 'code']), /OTP_EXPIRED: Please confirm with the code/);
  const code = freshCode();
  users.asha.grant = await rpc('asha', 'grant_access', [users.kavya.doctorId, perms, 24, 'code'], code);
  await rejects(rpc('asha', 'grant_access', [users.rohan.doctorId, perms, 24, 'code'], code), /already been used/);
  await rejects(rpc('asha', 'grant_access', [users.rohan.doctorId, perms, 24 * 91, 'code'], freshCode()), /between 1 hour and 90 days/);

  const [c] = await counts();
  assert.equal(c.p, 1);
  assert.equal(c.r, 3, 'sees allergy, medication and surgery — not the mental-health note');
  assert.equal(c.d, 1, 'sees the discharge summary attached to the surgery');
  assert.equal(c.o, 1, 'and can download that file');
  assert.equal((await as('rohan', (q) => q('select count(*)::int n from records')))[0].n, 0, 'other doctors still see nothing');
  assert.equal((await as('vikram', (q) => q('select count(*)::int n from records')))[0].n, 0, 'other patients see nothing');

  const notes = await as('kavya', (q) => q('select title from notifications'));
  assert.deepEqual(notes.map((n) => n.title), ['Access granted']);
});

/* ---------- Flow C: the doctor adds to the record ---------- */

test('C. a visit becomes linked, attributed entries; corrections keep history', async () => {
  const pid = users.asha.patientId;
  const docId = 'doc_kavya000000001';
  await uploadFile('kavya', `${pid}/${docId}`);
  await rejects(uploadFile('kavya', `${users.vikram.patientId}/doc_kavya000000002`), /row-level security/);
  await rpc('kavya', 'register_document', [pid, docId, 'cbc.pdf', 'application/pdf', 2048, 'report', '2026-09-28']);

  const items = [
    { type: 'consultation', date: '2026-09-28', data: { reason: 'Fatigue', doctor: 'Dr. Kavya Menon', facility: 'Northbridge Hospital' } },
    { type: 'diagnosis', date: '2026-09-28', data: { condition: 'Anaemia', status: 'Active' } },
    { type: 'medication', date: '2026-09-28', data: { name: 'Ferrous sulphate', dosage: '200 mg', frequency: 'Once daily' } },
    { type: 'lab_test', date: '2026-09-28', data: { test: 'CBC', status: 'Ordered' } },
    { type: 'follow_up', date: '2026-10-12', data: { purpose: 'Review: Anaemia' } },
  ];
  // Forged attribution in the request is ignored: the session decides who the author is.
  items[0].created_by = { id: 'pat_fake', role: 'patient', name: 'Someone else' };
  const ids = await rpc('kavya', 'add_visit', [pid, JSON.stringify(items), [docId]]);
  assert.equal(ids.length, 5);

  const recs = await as('asha', (q) => q('select id, type, parent_id, source, created_by, organization, attachments from records where id = any($1)', [ids]));
  const consult = recs.find((r) => r.type === 'consultation');
  assert.deepEqual(consult.attachments, [docId]);
  for (const r of recs) {
    assert.equal(r.created_by.id, users.kavya.doctorId);
    assert.equal(r.created_by.organization, 'Northbridge Hospital');
    assert.deepEqual(r.organization, { id: 'hsp_north', name: 'Northbridge Hospital' });
    assert.equal(r.source, 'doctor');
    if (r.type !== 'consultation') assert.equal(r.parent_id, consult.id);
  }
  const rx = recs.find((r) => r.type === 'medication');
  assert.deepEqual((await as('asha', (q) => q('select times from medication_reminders where record_id = $1', [rx.id])))[0].times, ['08:00']);
  const [n] = await as('asha', (q) => q("select body from notifications where title = 'New entry in your record'"));
  assert.match(n.body, /Dr\. Kavya Menon added a consultation, a diagnosis, 1 prescription, 1 lab order and 1 attachment to your medical record\. Reminders are set/);

  // Doctors can't write outside what was shared, or write patient-only types.
  await rejects(rpc('kavya', 'create_record', [pid, 'mental_health', '2026-09-28', { topic: 'x' }]), /hasn’t shared this part/);
  await rejects(rpc('kavya', 'create_record', [pid, 'other', '2026-09-28', { title: 'x' }]), /only be added by the patient/);
  await rejects(rpc('kavya', 'add_visit', [pid, JSON.stringify([{ type: 'imaging', date: '2026-09-28', data: { study: 'X-ray' } }])]), /starts with the consultation/);

  // Corrections: patient can't touch a doctor's entry; doctor's amendment keeps version 1.
  const dx = recs.find((r) => r.type === 'diagnosis');
  await rejects(rpc('asha', 'amend_record', [dx.id, '2026-09-28', { condition: 'Nothing', status: 'Resolved' }, 'I disagree']), /can only be corrected by a doctor/);
  await rejects(rpc('kavya', 'amend_record', [dx.id, '2026-09-28', { condition: 'Anaemia', status: 'Active' }, 'No change']), /Nothing has changed/);
  await rpc('kavya', 'amend_record', [dx.id, '2026-09-28', { condition: 'Iron-deficiency anaemia', status: 'Active', severity: 'Mild' }, 'Confirmed by ferritin']);
  const versions = await as('asha', (q) => q('select version, data ->> $2 as condition, change_type, reason, changed_by ->> $3 as by from record_versions where record_id = $1 order by version', [dx.id, 'condition', 'name']));
  assert.deepEqual(versions, [
    { version: 1, condition: 'Anaemia', change_type: 'created', reason: null, by: 'Dr. Kavya Menon' },
    { version: 2, condition: 'Iron-deficiency anaemia', change_type: 'amended', reason: 'Confirmed by ferritin', by: 'Dr. Kavya Menon' },
  ]);

  // Lab result completes the order; medication can be stopped once.
  const order = recs.find((r) => r.type === 'lab_test');
  const resultId = await rpc('kavya', 'add_lab_result', [order.id, { result: 'Hb 10.2 g/dL', status: 'Low' }, '2026-09-29']);
  const [o] = await as('asha', (q) => q('select data, version from records where id = $1', [order.id]));
  assert.equal(o.data.status, 'Completed');
  assert.equal(o.data.resultRecordId, resultId);
  assert.equal((await as('asha', (q) => q('select data ->> $2 as t from records where id = $1', [resultId, 'test'])))[0].t, 'CBC');
  await rpc('asha', 'discontinue_medication', [rx.id, 'Finished course', '2026-10-01']);
  await rejects(rpc('asha', 'discontinue_medication', [rx.id, 'again', '2026-10-01']), /already stopped/);
});

test('C2. nobody can write around the API', async () => {
  const pid = users.asha.patientId;
  await rejects(as('asha', (q) => q("insert into records (patient_id, type, date, data, created_by, source) values ($1, 'allergy', current_date, '{}', '{}', 'patient')", [pid])), /permission denied/);
  await rejects(as('asha', (q) => q("update records set data = '{}'")), /permission denied/);
  await rejects(as('kavya', (q) => q("update access_grants set expires_at = now() + interval '1 year'")), /permission denied/);
  await rejects(as('asha', (q) => q("insert into audit_log (actor, action) values ('{}', 'x')")), /permission denied/);
  await rejects(as('asha', (q) => q("insert into notifications (user_id, kind, title, body) values ($1, 'record', 'x', 'y')", [users.kavya.id])), /permission denied/);
  await rejects(as('asha', (q) => q('select public._insert_record($1, $2, current_date, $3)', [pid, 'allergy', {}])), /permission denied for function/);
  await rejects(as('asha', (q) => q('select public._audit($1, $2, $3, $4)', [pid, {}, 'x', {}])), /permission denied for function/);
  await rejects(as('asha', (q) => q('select public.admin_create_doctor($1, $2)', [users.asha.id, {}])), /permission denied for function/);
  // A patient can't schedule reminders or log doses against someone else's medicine.
  const [rx] = await as('asha', (q) => q("select id from records where type = 'medication' limit 1"));
  await rejects(as('vikram', (q) => q("insert into dose_logs (patient_id, record_id, date, time, status) values ($1, $2, current_date, '08:00', 'taken')", [users.vikram.patientId, rx.id])), /row-level security/);
  await as('asha', (q) => q("insert into dose_logs (patient_id, record_id, date, time, status) values ($1, $2, current_date, '08:00', 'taken')", [pid, rx.id]));
  // Even the database owner can't rewrite attribution or history.
  await rejects(db.query("update records set created_by = '{\"id\":\"x\"}' where patient_id = $1", [pid]), /IMMUTABLE: who added an entry/);
  await rejects(db.query('delete from record_versions'), /IMMUTABLE/);
  await rejects(db.query('delete from records'), /IMMUTABLE/);
  // Signed-out visitors get nothing at all.
  const c = await db.connect();
  try {
    await c.query('begin; set local role anon');
    await rejects(c.query('select * from patients'), /permission denied/);
  } finally {
    await c.query('rollback');
    c.release();
  }
});

/* ---------- Documents ---------- */

test('documents: patients remove their own uploads, never a doctor’s', async () => {
  const pid = users.asha.patientId;
  await rejects(rpc('asha', 'delete_document', ['doc_kavya000000001']), /stay with the record/);
  const own = 'doc_asha0000000002';
  await uploadFile('asha', `${pid}/${own}`);
  await rpc('asha', 'register_document', [null, own, 'note.txt', 'text/plain', 12, 'other', '2026-09-28']);
  await rejects(as('asha', (q) => q("delete from storage.objects where name = $1 returning name", [`${pid}/${own}`]).then((r) => { if (!r.length) throw new Error('blocked by row-level security'); })), /row-level security/);
  const path = await rpc('asha', 'delete_document', [own]);
  const deleted = await as('asha', (q) => q('delete from storage.objects where name = $1 returning name', [path]));
  assert.equal(deleted.length, 1);
  await rejects(rpc('asha', 'register_document', [null, 'doc_bad', 'x.exe', 'application/x-msdownload', 10, 'other', '2026-09-28']), /Invalid document id/);
});

/* ---------- Flow D: revoke and expiry ---------- */

test('D. revoking or expiry ends access immediately', async () => {
  const pid = users.asha.patientId;
  // Narrowing needs no code; widening does.
  await rpc('asha', 'update_grant_permissions', [users.asha.grant, ['history', 'allergies']]);
  assert.equal((await as('kavya', (q) => q("select count(*)::int n from records where type = 'medication'")))[0].n, 0);
  await rejects(rpc('asha', 'update_grant_permissions', [users.asha.grant, ['history', 'allergies', 'medications']]), /OTP_EXPIRED/);
  await rpc('asha', 'update_grant_permissions', [users.asha.grant, ['history', 'allergies', 'medications']], freshCode());

  await rpc('asha', 'revoke_grant', [users.asha.grant]);
  assert.deepEqual((await as('kavya', (q) => q('select (select count(*) from records)::int r, (select count(*) from documents)::int d, (select count(*) from storage.objects)::int o, (select count(*) from patients)::int p')))[0], { r: 0, d: 0, o: 0, p: 0 });
  await rejects(rpc('kavya', 'create_record', [pid, 'consultation', '2026-09-28', { reason: 'x' }]), /ACCESS_DENIED/);
  const overview = await rpc('kavya', 'doctor_access_overview');
  assert.equal(overview.active.length, 0);
  assert.equal(overview.past[0].patient.full_name, 'A••• R••', 'ended patients are masked');

  // Expiry: access stops at the expiry time even before the job runs.
  const g = await rpc('asha', 'grant_access', [users.kavya.doctorId, ['history'], 1, 'directory'], freshCode());
  assert.ok((await as('kavya', (q) => q('select count(*)::int n from records')))[0].n > 0);
  await db.query("update access_grants set granted_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where id = $1", [g]);
  assert.equal((await as('kavya', (q) => q('select count(*)::int n from records')))[0].n, 0);
  await db.query('select public._sweep_grants(null, null)');
  await db.query('select public._sweep_grants(null, null)');
  const log = await as('asha', (q) => q("select actor ->> 'role' as role from audit_log where action = 'access_expired'"));
  assert.deepEqual(log, [{ role: 'system' }], 'expiry logged exactly once, by the system');
});

test('D2. doctors request access; patients approve with a code', async () => {
  const pid = users.vikram.patientId;
  const code = (await as('vikram', (q) => q('select patient_code from patients')))[0].patient_code;
  const look = await rpc('rohan', 'lookup_patient', [code]);
  const req = await rpc('rohan', 'request_access', [look.patientId, ['history', 'allergies'], 72, 'Referral for chest pain']);
  await rejects(rpc('rohan', 'request_access', [pid, ['history'], 72, 'again']), /already have a pending request/);
  assert.equal((await rpc('rohan', 'lookup_patient', [code])).status, 'pending');
  const [n] = await as('vikram', (q) => q("select body from notifications where kind = 'request'"));
  assert.match(n.body, /Dr\. Rohan Iyer \(Lakeside Clinic\) requested access to your medical history, allergies for 3 days\./);
  await rejects(rpc('vikram', 'approve_request', [req, ['history'], 72]), /OTP_EXPIRED/);
  await rpc('vikram', 'approve_request', [req, ['history'], 72], freshCode());
  await rejects(rpc('vikram', 'approve_request', [req, ['history'], 72], freshCode()), /already been answered/);
  const look2 = await rpc('rohan', 'lookup_patient', [code]);
  assert.equal(look2.status, 'active');
  assert.equal(look2.maskedName, 'Vikram Shah');
});

/* ---------- Flow E: audit ---------- */

test('E. the audit log is complete, private to each side, append-only and tamper-evident', async () => {
  const actions = (await as('asha', (q) => q('select action from audit_log order by seq'))).map((r) => r.action);
  for (const a of ['account_created', 'document_uploaded', 'record_added', 'access_granted', 'record_amended', 'medication_discontinued', 'access_changed', 'access_revoked', 'access_expired', 'document_deleted']) {
    assert.ok(actions.includes(a), `patient log has ${a}`);
  }
  assert.equal((await as('vikram', (q) => q('select count(*)::int n from audit_log where patient_id = $1', [users.asha.patientId])))[0].n, 0);
  const mine = await as('kavya', (q) => q("select distinct actor ->> 'id' as id from audit_log"));
  assert.deepEqual(mine, [{ id: users.kavya.doctorId }], 'doctors read only their own actions');
  const activity = await rpc('kavya', 'doctor_activity');
  assert.ok(activity.length > 0 && activity.every((a) => a.patient_name === 'Asha Rao'));

  // Views are logged once per 10 minutes.
  await rpc('rohan', 'log_history_view', [users.vikram.patientId]);
  await rpc('rohan', 'log_history_view', [users.vikram.patientId]);
  assert.equal((await as('vikram', (q) => q("select count(*)::int n from audit_log where action = 'viewed_history'")))[0].n, 1);

  await rejects(db.query("update audit_log set action = 'nothing'"), /IMMUTABLE/);
  await rejects(db.query('delete from audit_log'), /IMMUTABLE/);
  assert.equal((await db.query('select public.verify_audit_chain() as broken')).rows[0].broken, null);
  // Someone with raw database access who disables the guard is still caught.
  await db.query('alter table audit_log disable trigger audit_log_immutable');
  const victim = (await db.query("select seq from audit_log where action = 'access_granted' order by seq limit 1")).rows[0].seq;
  await db.query("update audit_log set metadata = '{\"duration\":\"forever\"}' where seq = $1", [victim]);
  await db.query('alter table audit_log enable trigger audit_log_immutable');
  assert.equal(Number((await db.query('select public.verify_audit_chain() as broken')).rows[0].broken), Number(victim));
});

/* ---------- Sessions, notifications, erasure ---------- */

test('sessions and notifications belong to their owner', async () => {
  const other = randomUUID();
  await db.query("insert into auth.sessions (id, user_id, user_agent) values ($1, $2, 'Old phone')", [other, users.asha.id]);
  const s = await rpc('asha', 'list_my_sessions');
  assert.equal(s.length, 2);
  assert.equal(s[0].current, true);
  await rejects(rpc('asha', 'revoke_session', [users.asha.session]), /Use “Log out”/);
  await rpc('vikram', 'revoke_session', [other]);
  assert.equal((await rpc('asha', 'list_my_sessions')).length, 2, 'someone else can’t sign you out');
  assert.equal(await rpc('asha', 'revoke_other_sessions'), 1);
  assert.equal((await rpc('asha', 'list_my_sessions')).length, 1);

  const unread = () => as('asha', (q) => q('select count(*)::int n from notifications where not read'));
  assert.ok((await unread())[0].n > 0);
  await rpc('kavya', 'mark_notifications_read');
  assert.ok((await unread())[0].n > 0, 'marking read affects only your own');
  await rpc('asha', 'mark_notifications_read');
  assert.equal((await unread())[0].n, 0);
});

test('account erasure is possible only deliberately', async () => {
  await rejects(db.query('delete from auth.users where id = $1', [users.vikram.id]), /IMMUTABLE/);
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query("set local niveda.allow_erasure = 'on'");
    await c.query('delete from auth.users where id = $1', [users.vikram.id]);
    await c.query('commit');
  } finally {
    c.release();
  }
  assert.equal((await db.query('select count(*)::int n from patients where id = $1', [users.vikram.patientId])).rows[0].n, 0);
});

/* ---------- Doctor sign-up and verification by the Niveda team ---------- */

test('doctors apply, only a Niveda administrator can verify them, and approval makes them a doctor', async () => {
  const form = {
    signup_kind: 'doctor', fullName: '  Dr. Meera   Nair ', phone: '+91 99887 76655', registrationNumber: 'kmc-55501',
    medicalCouncil: 'Karnataka Medical Council', registrationYear: '2012', specialization: 'Paediatrics', qualifications: 'MBBS, MD',
    yearsOfPractice: '11', hospitalName: 'Sunrise Children’s Hospital', hospitalCity: 'Bengaluru', hospitalType: 'hospital',
  };
  await addUser('meera', 'meera@example.com', form);
  await addUser('copycat', 'copycat@example.com', { ...form, fullName: 'Someone Else', phone: '+91 90000 11111' });
  await addUser('team', 'team@niveda.example');
  await addUser('sneaky', 'sneaky@niveda.example');
  await db.query("update auth.users set email_confirmed_at = null where email = 'sneaky@niveda.example'");
  await db.query("insert into public.admins (email) values ('team@niveda.example'), ('sneaky@niveda.example')");

  const acct = await rpc('meera', 'complete_signup');
  assert.equal(acct.role, 'applicant');
  assert.equal(acct.isAdmin, false);
  const mine = await rpc('meera', 'my_doctor_application');
  assert.equal(mine.status, 'pending');
  assert.equal(mine.fullName, 'Dr. Meera Nair', 'spaces tidied');
  assert.equal(mine.registrationNumber, 'KMC-55501');
  assert.equal(mine.accessCode, null);
  await rejects(rpc('copycat', 'complete_signup'), /already linked to a Niveda account/);
  await rejects(rpc('meera', 'lookup_patient', ['NV-0000-0000']), /isn’t available for your account/, 'an applicant is not a doctor yet');
  assert.equal((await as('asha', (q) => q('select count(*)::int n from doctor_applications')))[0].n, 0, 'applications are private');

  for (const who of ['asha', 'meera', 'kavya', 'sneaky']) {
    await rejects(rpc(who, 'admin_doctor_applications'), /Only the Niveda team/);
    await rejects(rpc(who, 'admin_review_doctor_application', [mine.id, 'approve', null]), /Only the Niveda team/);
  }
  assert.deepEqual((await rpc('team', 'admin_doctor_applications')).map((a) => a.id), [mine.id]);

  await rejects(rpc('team', 'admin_review_doctor_application', [mine.id, 'decline', ' ']), /Tell the doctor why/);
  const declined = await rpc('team', 'admin_review_doctor_application', [mine.id, 'decline', 'The number doesn’t match the council register.']);
  assert.equal(declined.status, 'declined');
  await rejects(rpc('team', 'admin_review_doctor_application', [mine.id, 'approve', null]), /already been reviewed/);
  await rejects(rpc('meera', 'update_doctor_application', [{ ...form, yearsOfPractice: '99' }]), /years of practice/);
  const fixed = await rpc('meera', 'update_doctor_application', [{ ...form, registrationNumber: 'KMC-55502' }]);
  assert.equal(fixed.status, 'pending');
  assert.equal(fixed.reviewNote, 'The number doesn’t match the council register.', 'the reason stays visible after resubmitting');
  assert.deepEqual((await rpc('team', 'admin_doctor_applications', ['pending'])).map((a) => a.registrationNumber), ['KMC-55502']);

  const approved = await rpc('team', 'admin_review_doctor_application', [mine.id, 'approve', null]);
  assert.equal(approved.status, 'approved');
  assert.match(approved.accessCode, /^DR-[0-9A-F]{4}$/);
  assert.equal((await rpc('meera', 'my_account')).role, 'doctor');
  const doc = (await db.query('select d.verified_at, h.name, h.city from doctors d join hospitals h on h.id = d.hospital_id where d.user_id = $1', [users.meera.id])).rows[0];
  assert.ok(doc.verified_at);
  assert.deepEqual([doc.name, doc.city], ['Sunrise Children’s Hospital', 'Bengaluru']);
  assert.equal((await as('asha', (q) => q("select verified from doctor_directory where registration_number = 'KMC-55502'")))[0].verified, true);
  await rejects(rpc('meera', 'update_doctor_application', [form]), /already approved/);
  const notes = await as('meera', (q) => q('select title from notifications order by created_at'));
  assert.deepEqual(notes.map((n) => n.title), ['Application received', 'Your application needs changes', 'You’re verified on Niveda'.replace('’', "'")]);
});

/* ---------- Emergency ("break-glass") access ---------- */

test('emergency access: verified doctors only, justified, code-confirmed, limited, logged and reviewable', async () => {
  // A fresh patient who has shared nothing with Kavya.
  await addUser('ravi', 'ravi@example.com', { full_name: 'Ravi Kumar', date_of_birth: '1970-06-01', phone: '+91 97777 12345' });
  const acct = await rpc('ravi', 'complete_signup');
  const code = (await as('ravi', (q) => q('select patient_code from patients')))[0].patient_code;
  await db.query("insert into public.records (patient_id, type, date, data, created_by) values ($1, 'allergy', current_date, '{\"allergen\":\"Penicillin\",\"severity\":\"Life-threatening\"}', '{\"id\":\"x\",\"role\":\"patient\",\"name\":\"Ravi Kumar\"}'), ($1, 'mental_health', current_date, '{\"topic\":\"Private\"}', '{\"id\":\"x\",\"role\":\"patient\",\"name\":\"Ravi Kumar\"}')", [acct.profileId]).catch(async () => {
    // Fall back to the app's own API if the table needs more columns.
    await rpc('ravi', 'create_record', [null, 'allergy', new Date().toISOString().slice(0, 10), { allergen: 'Penicillin', severity: 'Life-threatening', reaction: 'Anaphylaxis' }, null, [], null]);
    await rpc('ravi', 'create_record', [null, 'mental_health', new Date().toISOString().slice(0, 10), { topic: 'Private' }, null, [], null]);
  });
  const why = 'Brought in unconscious after a road accident; need allergies before giving antibiotics.';

  await rejects(rpc('asha', 'emergency_access', [code, 'unconscious', why]), /isn’t available for your account/, 'patients can’t');
  await rejects(rpc('kavya', 'emergency_access', [code, 'bored', why], freshCode()), /Choose why/);
  await rejects(rpc('kavya', 'emergency_access', [code, 'unconscious', 'please'], freshCode()), /at least 20 characters/);
  await rejects(rpc('kavya', 'emergency_access', ['NV-0000-0000', 'unconscious', why], freshCode()), /No patient matches/);
  await rejects(rpc('kavya', 'emergency_access', [code, 'unconscious', why]), /code we email you/, 'needs a fresh code');
  await db.query('update doctors set verified_at = null where id = $1', [users.rohan.doctorId]);
  await rejects(rpc('rohan', 'emergency_access', [code, 'unconscious', why], freshCode()), /Only verified doctors/);
  await db.query('update doctors set verified_at = now() where id = $1', [users.rohan.doctorId]);

  const r = await rpc('kavya', 'emergency_access', [code, 'unconscious', why], freshCode());
  assert.equal(r.patientId, acct.profileId);
  const hours = (new Date(r.expiresAt) - Date.now()) / 3600000;
  assert.ok(hours > 3.9 && hours <= 4.01, 'four hours');
  const seen = await as('kavya', (q) => q('select type from records where patient_id = $1 order by type', [acct.profileId]));
  assert.deepEqual(seen.map((x) => x.type), ['allergy'], 'emergency essentials only — no mental health');
  await rejects(rpc('kavya', 'emergency_access', [code, 'unconscious', why], freshCode()), /already have access/);

  const log = await as('ravi', (q) => q("select actor, metadata from audit_log where action = 'emergency_access'"));
  assert.equal(log.length, 1);
  assert.equal(log[0].actor.name, 'Dr. Kavya Menon');
  assert.equal(log[0].metadata.justification, why);
  const note = await as('ravi', (q) => q("select body from notifications where title = 'Emergency access to your record'"));
  assert.match(note[0].body, /Dr\. Kavya Menon .* in an emergency: Patient is unconscious\. It ends by itself in 4 hours/);
  const g = await as('ravi', (q) => q("select id, method from access_grants where method = 'emergency'"));
  assert.equal(g.length, 1);

  // The team sees and reviews it; a concern ends it immediately.
  await rejects(rpc('kavya', 'admin_emergency_accesses'), /Only the Niveda team/);
  const list = await rpc('team', 'admin_emergency_accesses');
  assert.equal(list.length, 1);
  assert.equal(list[0].patient.maskedName, 'R••• K••••', 'the team sees who accessed, not the patient’s record');
  assert.equal(list[0].doctor.name, 'Dr. Kavya Menon');
  await rejects(rpc('team', 'admin_review_emergency_access', [list[0].id, 'concern', '']), /Write down the concern/);
  await rpc('team', 'admin_review_emergency_access', [list[0].id, 'concern', 'No matching emergency admission at the hospital.']);
  assert.equal((await as('kavya', (q) => q('select count(*)::int n from records where patient_id = $1', [acct.profileId])))[0].n, 0, 'access ended');
  assert.equal((await rpc('team', 'admin_emergency_accesses', ['concern'])).length, 1);

  // At most 3 times in 24 hours.
  for (let i = 0; i < 2; i++) {
    await rpc('kavya', 'emergency_access', [code, 'life_threatening', why], freshCode());
    await db.query("update access_grants set status = 'revoked', revoked_at = now() where doctor_id = $1 and status = 'active' and method = 'emergency'", [users.kavya.doctorId]);
  }
  await rejects(rpc('kavya', 'emergency_access', [code, 'life_threatening', why], freshCode()), /3 times in the last 24 hours/);
});
