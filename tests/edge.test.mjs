// Unit tests for the Supabase Edge Functions' pure logic (no Deno, no network).
//   node --test tests/edge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'niveda-edge-'));
async function load(entry) {
  const out = join(dir, entry.replace(/\W/g, '_') + '.mjs');
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
  return import(pathToFileURL(out).href);
}

const sms = await load('supabase/functions/send-sms/sms.ts');

test('SMS: MSG91 request uses the DLT flow template with the code as a variable', () => {
  const r = sms.buildRequest({ provider: 'msg91', appName: 'Niveda', msg91AuthKey: 'k', msg91TemplateId: 't1' }, '+91 98765 43210', '123456');
  assert.equal(r.url, 'https://control.msg91.com/api/v5/flow');
  assert.equal(r.init.headers.authkey, 'k');
  assert.deepEqual(JSON.parse(r.init.body).recipients, [{ mobiles: '919876543210', otp: '123456', app: 'Niveda' }]);
});

test('SMS: Twilio request posts To/Body with basic auth, Messaging Service when MG…', () => {
  const r = sms.buildRequest({ provider: 'twilio', appName: 'Niveda', twilioAccountSid: 'AC1', twilioAuthToken: 'tok', twilioFrom: 'MG9' }, '9876543210', '654321');
  assert.match(r.url, /Accounts\/AC1\/Messages\.json$/);
  const body = new URLSearchParams(r.init.body);
  assert.equal(body.get('To'), '+919876543210');
  assert.equal(body.get('MessagingServiceSid'), 'MG9');
  assert.match(body.get('Body'), /^654321 is your Niveda code/);
  assert.equal(r.init.headers.authorization, `Basic ${Buffer.from('AC1:tok').toString('base64')}`);
});

test('SMS: refuses bad input and missing secrets; "log" provider sends nothing', () => {
  assert.throws(() => sms.buildRequest({ provider: 'msg91', appName: 'N' }, '+919876543210', '123456'), /MSG91_AUTH_KEY/);
  assert.throws(() => sms.buildRequest({ provider: 'log', appName: 'N' }, '123', '123456'), /phone/);
  assert.throws(() => sms.buildRequest({ provider: 'log', appName: 'N' }, '+919876543210', 'abc'), /code/);
  assert.equal(sms.buildRequest({ provider: 'log', appName: 'N' }, '+919876543210', '123456'), null);
  assert.equal(sms.maskPhone('+91 98765 43210'), '••••3210');
});

test('SMS: an MSG91 "type: error" answer counts as a failure', async () => {
  const cfg = { provider: 'msg91', appName: 'N', msg91AuthKey: 'k', msg91TemplateId: 't' };
  const fake = async () => new Response('{"type":"error","message":"bad template"}', { status: 200 });
  await assert.rejects(sms.sendOtpSms(cfg, '+919876543210', '123456', fake), /rejected/);
  const ok = async () => new Response('{"type":"success"}', { status: 200 });
  await sms.sendOtpSms(cfg, '+919876543210', '123456', ok);
});

/* ---------- ABDM / ABHA ---------- */

const abdm = await load('supabase/functions/abdm/abdm.ts');

async function rsaPair() {
  const k = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' }, true, ['encrypt', 'decrypt']);
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', k.publicKey)).toString('base64');
  return { pem: `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`, privateKey: k.privateKey };
}
const decrypt = async (key, b64) => new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, Buffer.from(b64, 'base64')));

test('ABHA: numbers and mobiles are checked and normalised', () => {
  assert.equal(abdm.normaliseAbhaNumber('12 3456 7890 1234'), '12-3456-7890-1234');
  assert.throws(() => abdm.normaliseAbhaNumber('1234'), /14 digits/);
  assert.equal(abdm.normaliseMobile('+91 98765 43210'), '9876543210');
  assert.throws(() => abdm.normaliseMobile('12345'), /10-digit/);
  assert.equal(abdm.maskAbhaNumber('12-3456-7890-1234'), 'xx-xxxx-xxxx-1234');
});

test('ABHA: values are encrypted with RSA-OAEP SHA-1 against ABDM’s public key', async () => {
  const { pem, privateKey } = await rsaPair();
  const key = await abdm.importAbdmKey(pem);
  const enc = await abdm.encrypt(key, '12-3456-7890-1234');
  assert.notEqual(enc, '12-3456-7890-1234');
  assert.equal(await decrypt(privateKey, enc), '12-3456-7890-1234');
});

test('ABHA: profile parsing and matching the Niveda patient', () => {
  const p = abdm.parseProfile({ ABHANumber: '91123456789012', preferredAbhaAddress: 'asha.rao@sbx', firstName: 'Asha', lastName: 'Rao', yearOfBirth: '1990', monthOfBirth: '4', dayOfBirth: '12', gender: 'F' });
  assert.deepEqual(p, { abhaNumber: '91-1234-5678-9012', abhaAddress: 'asha.rao@sbx', name: 'Asha Rao', dateOfBirth: '1990-04-12', gender: 'F', mobile: '' });
  assert.equal(abdm.parseProfile({ ABHANumber: '91123456789012', name: 'X', dateOfBirth: '12-04-1990' }).dateOfBirth, '1990-04-12');
  assert.deepEqual(abdm.matchesPatient(p, { fullName: 'Asha  R. Rao', dateOfBirth: '1990-04-12' }), { ok: true });
  assert.match(abdm.matchesPatient(p, { fullName: 'Vikram Shah', dateOfBirth: '1990-04-12' }).reason, /name/);
  assert.match(abdm.matchesPatient(p, { fullName: 'Asha Rao', dateOfBirth: '1991-04-12' }).reason, /date of birth/);
});

test('ABHA: the full login flow against a fake ABDM', async () => {
  const { pem, privateKey } = await rsaPair();
  const calls = [];
  const fake = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, headers: init.headers ?? {}, body });
    const json = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (url.endsWith('/sessions')) return json({ accessToken: 'GW', expiresIn: 1200 });
    if (url.endsWith('/public/certificate')) return json({ publicKey: pem });
    if (url.endsWith('/login/request/otp')) {
      assert.equal(await decrypt(privateKey, body.loginId), '91-1234-5678-9012');
      return json({ txnId: 'T1', message: 'OTP sent' });
    }
    if (url.endsWith('/login/verify')) {
      if ((await decrypt(privateKey, body.authData.otp.otpValue)) !== '123456') return new Response(JSON.stringify({ error: { message: 'Invalid OTP' } }), { status: 400 });
      return json({ authResult: 'success', txnId: 'T1', tokens: { token: 'XT', refreshToken: 'R' }, accounts: [{ ABHANumber: '91-1234-5678-9012', name: 'Asha Rao' }] });
    }
    if (url.endsWith('/profile/account')) return json({ ABHANumber: '91-1234-5678-9012', name: 'Asha Rao', preferredAbhaAddress: 'asha@sbx' });
    return new Response('nope', { status: 404 });
  };
  const cfg = abdm.configFromEnv((k) => ({ ABDM_CLIENT_ID: 'id', ABDM_CLIENT_SECRET: 'secret' })[k] ?? '');
  assert.equal(cfg.cmId, 'sbx');
  const c = new abdm.AbdmClient(cfg, fake);
  const { txnId } = await c.requestOtp('abha-number', '91123456789012');
  assert.equal(txnId, 'T1');
  await assert.rejects(c.verifyOtp('abha-number', txnId, '000000'), /Invalid OTP/);
  const v = await c.verifyOtp('abha-number', txnId, '123456');
  assert.equal(v.xToken, 'XT');
  const profile = await c.profile(v.xToken);
  assert.equal(profile.abhaAddress, 'asha@sbx');

  const sess = calls.filter((x) => x.url.endsWith('/sessions'));
  assert.equal(sess.length, 1, 'the gateway token is reused');
  assert.deepEqual(sess[0].body, { clientId: 'id', clientSecret: 'secret', grantType: 'client_credentials' });
  const prof = calls.find((x) => x.url.endsWith('/profile/account'));
  assert.equal(prof.headers['X-token'], 'Bearer XT');
  assert.equal(prof.headers.Authorization, 'Bearer GW');
  assert.equal(prof.headers['X-CM-ID'], 'sbx');
  assert.ok(prof.headers['REQUEST-ID'] && prof.headers.TIMESTAMP);
});

test('ABHA: a mobile number with several ABHAs asks the patient to choose', () => {
  const v = abdm.parseVerify({ authResult: 'success', txnId: 'T2', token: 'TT', tokenType: 'T-TOKEN', accounts: [{ ABHANumber: '1', name: 'A' }, { ABHANumber: '2', name: 'B' }] });
  assert.equal(v.tToken, 'TT');
  assert.equal(v.accounts.length, 2);
  assert.throws(() => abdm.parseVerify({ authResult: 'failed', message: 'Wrong OTP' }), /Wrong OTP/);
});

const scan = await load('supabase/functions/document-access/scan.ts');
const bytes = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));

test('file check: real PDFs, photos and text pass; the type comes from the bytes', () => {
  assert.deepEqual(scan.scanFile(bytes('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'), 'application/pdf'), { ok: true, kind: 'pdf' });
  assert.deepEqual(scan.scanFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), 'image/png'), { ok: true, kind: 'png' });
  assert.deepEqual(scan.scanFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'image/jpeg'), { ok: true, kind: 'jpeg' });
  assert.deepEqual(scan.scanFile(bytes('\0\0\0\x18ftypheic\0\0'), 'image/heic'), { ok: true, kind: 'heic' });
  assert.deepEqual(scan.scanFile(bytes('Haemoglobin 13.2 g/dL'), 'text/plain'), { ok: true, kind: 'text' });
  assert.deepEqual(scan.scanFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/png'), { ok: true, kind: 'jpeg' }, 'a JPEG named .png is still a photo');
});

test('file check: programs, packed files, web pages, disguised and dangerous PDFs are blocked', () => {
  const no = (b, t, re) => { const r = scan.scanFile(b, t); assert.equal(r.ok, false); assert.match(r.reason, re); };
  no(bytes('MZ\x90\0\x03'), 'application/pdf', /program/);
  no(bytes('\x7fELF\x02'), 'application/octet-stream', /program/);
  no(bytes('PK\x03\x04docx'), 'application/pdf', /Zip, Office/);
  no(bytes('<html><script>alert(1)</script>'), 'text/plain', /Web pages/);
  no(bytes('<?xml version="1.0"?><svg onload="x()"/>'), 'image/svg+xml', /SVG|Web pages/);
  no(bytes('%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>'), 'application/pdf', /JavaScript/);
  no(bytes('%PDF-1.4\n<< /S /J#61vaScript >>'), 'application/pdf', /JavaScript/, 'hidden with #xx codes');
  no(bytes('%PDF-1.4\n<< /Type /Action /S /Launch /F (cmd.exe) >>'), 'application/pdf', /other programs/);
  no(bytes('%PDF-1.4\n<< /Names << /EmbeddedFiles 3 0 R >> >>'), 'application/pdf', /hidden inside/);
  no(bytes('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'), 'text/plain', /antivirus test/);
  no(bytes('%PDF-1.4 fine'), 'image/jpeg', /isn’t what its name says/);
  no(new Uint8Array([1, 0, 2, 0, 3]), 'text/plain', /isn’t recognised/);
  no(new Uint8Array(), 'text/plain', /empty/);
});

test('file check: the app and the server use the same code', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync('src/lib/fileScan.ts', 'utf8'), /supabase\/functions\/document-access\/scan/);
});
