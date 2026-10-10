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
