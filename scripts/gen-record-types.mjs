// Prints the SQL rows for public.record_types from src/lib/recordMeta.ts, so the
// server's rules come from the same definitions the app uses.
// Run: node scripts/gen-record-types.mjs
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = join(mkdtempSync(join(tmpdir(), 'nv-')), 'meta.mjs');
await build({ entryPoints: ['src/lib/recordMeta.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const { RECORD_TYPES } = await import(pathToFileURL(out).href);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (xs) => `array[${xs.map(q).join(', ')}]::text[]`;
const rows = Object.values(RECORD_TYPES).map((m) =>
  `  (${q(m.type)}, ${q(m.label)}, ${q(m.permission)}, ${q(m.titleKey)}, ${m.patientCanAdd}, ${m.doctorCanAdd}, ${arr(m.fields.map((f) => f.key))}, ${arr(m.fields.filter((f) => f.required).map((f) => f.key))})`);
console.log(`insert into public.record_types (type, label, permission, title_key, patient_can_add, doctor_can_add, field_keys, required_keys) values\n${rows.join(',\n')};`);
