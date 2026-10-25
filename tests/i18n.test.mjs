// Interface languages: every text is translated, values survive, server text is translated on display.
//   node --test tests/i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const LANGS = ['hi', 'bn', 'mr', 'te', 'ta', 'gu', 'kn', 'ml'];
const placeholders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

// Re-scan the code first, so a new t('…') without a translation fails here, not in front of a patient.
execFileSync('node', [join(root, 'scripts/i18n-extract.mjs')], { cwd: root, stdio: 'ignore' });
const keys = read('src/i18n/keys.json');

const dir = mkdtempSync(join(tmpdir(), 'niveda-i18n-'));
const out = join(dir, 'i18n.mjs');
await build({
  stdin: { contents: "export * from './src/i18n/index.ts'; export * from './src/i18n/serverText.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
});
const i18n = await import(pathToFileURL(out).href);

test('every language file covers every interface text', () => {
  assert.deepEqual(readdirSync(join(root, 'src/i18n/locales')).sort(), LANGS.map((l) => `${l}.json`).sort());
  for (const lang of LANGS) {
    const dict = read(`src/i18n/locales/${lang}.json`);
    const missing = keys.filter((k) => !dict[k]?.trim());
    assert.deepEqual(missing.slice(0, 10), [], `${lang}: ${missing.length} texts missing — run npm run i18n:check`);
  }
});

test('translations keep every {placeholder} and the names that must stay in Latin script', () => {
  const keep = ['Niveda', 'ABHA', 'ABDM', 'PDF', 'QR', 'SMS'];
  for (const lang of LANGS) {
    const dict = read(`src/i18n/locales/${lang}.json`);
    for (const k of keys) {
      assert.equal(placeholders(dict[k]), placeholders(k), `${lang}: placeholders differ in “${k}”`);
      for (const word of keep) if (new RegExp(`\\b${word}\\b`).test(k)) assert.ok(dict[k].includes(word), `${lang}: “${word}” lost in “${k}”`);
    }
  }
});

test('t(): English by default, translated after switching, values filled in, unknown text unchanged', async () => {
  await i18n.loadLanguage('en');
  assert.equal(i18n.t('Welcome, {first}.', { first: 'Asha' }), 'Welcome, Asha.');
  await i18n.loadLanguage('hi');
  assert.equal(i18n.getLanguage(), 'hi');
  assert.equal(i18n.getLocale(), 'hi-IN');
  assert.equal(i18n.t('Welcome, {first}.', { first: 'Asha' }), 'स्वागत है, Asha।');
  assert.equal(i18n.t('Something nobody wrote yet'), 'Something nobody wrote yet');
  await i18n.loadLanguage('en');
});

test('tServer(): saved English notifications are shown in the reader’s language, names untouched', async () => {
  await i18n.loadLanguage('te');
  assert.equal(i18n.tServer('Access granted'), read('src/i18n/locales/te.json')['Access granted']);
  const body = i18n.tServer('Dr. Priya Sharma can no longer see your records.');
  assert.ok(body.startsWith('Dr. Priya Sharma'), body);
  assert.notEqual(body, 'Dr. Priya Sharma can no longer see your records.');
  assert.ok(!/[A-Za-z]{4,} (can|records)/.test(body), body);
  // What a person wrote stays as written; only the record type is translated.
  const typed = i18n.tServer('Consultation: Persistent cough');
  assert.ok(typed.endsWith(': Persistent cough'), typed);
  // An access request's label: each permission and the duration are translated.
  const te = read('src/i18n/locales/te.json');
  assert.equal(i18n.tServer('Medications, Lab reports · 24 hours'), `${te['Medications']}, ${te['Lab reports']} · ${te['{n} hours'].replace('{n}', '24')}`);
  // Unknown text is shown as it is.
  assert.equal(i18n.tServer('Some brand-new server message'), 'Some brand-new server message');
  await i18n.loadLanguage('en');
});
