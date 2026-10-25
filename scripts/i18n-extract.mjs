#!/usr/bin/env node
/**
 * Lists every English interface text that needs a translation, and checks each language file.
 *
 *   npm run i18n:extract   writes src/i18n/keys.json (the English texts)
 *   npm run i18n:check     also reports what each locale file is missing or has left over
 *
 * Sources of texts:
 *  1. t('…') / tr('…') calls in src/ (first argument, a plain string)
 *  2. choices, record-type names and other English data that is translated where it is shown
 *     (marked in code with t(variable)): read from src/lib/recordMeta.ts and friends
 *  3. messages the database raises with fail('CODE', '…') in supabase/migrations
 *  4. notification and audit templates in src/i18n/serverText.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');

const keys = new Set();

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

// Data whose English text is kept for saving and translated where shown.
const DATA_PROPS = new Set(['label', 'plural', 'options']);
const DATA_FILES = [/lib\/recordMeta\.ts$/, /services\/exportService\.ts$/, /services\/accessService\.ts$/];
// The vaccination schedule and child-profile choices: dose names, age groups and notes, and named
// constants (ALL_CAPS) holding English text.
const SCHEDULE_FILES = [/lib\/immunization\.ts$/, /services\/familyService\.ts$/];
const SCHEDULE_PROPS = new Set(['dose']);
const SCHEDULE_CONSTS = new Set(['AGE_GROUPS', 'JE', 'DELIVERY_TYPES']);

for (const file of walk(path.join(root, 'src'))) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isData = DATA_FILES.some((r) => r.test(file));
  const isSchedule = SCHEDULE_FILES.some((r) => r.test(file));
  const addText = (v) => {
    if (ts.isStringLiteral(v) && /[A-Za-z]/.test(v.text)) keys.add(v.text);
    if (ts.isArrayLiteralExpression(v)) for (const el of v.elements) if (ts.isStringLiteral(el) && /[A-Za-z]/.test(el.text)) keys.add(el.text);
  };
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^(t|tr)$/.test(node.expression.text)) {
      const a = node.arguments[0];
      if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) keys.add(a.text);
    }
    // <T text="… {x} …" x={…} /> — a whole sentence with markup inside.
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(sf) === 'T') {
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== 'text' || !attr.initializer) continue;
        const init = attr.initializer;
        if (ts.isStringLiteral(init)) keys.add(init.text);
        else if (ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))) keys.add(init.expression.text);
      }
    }
    if (isData && ts.isPropertyAssignment(node) && DATA_PROPS.has(node.name.getText(sf))) addText(node.initializer);
    if (isSchedule && ts.isPropertyAssignment(node) && SCHEDULE_PROPS.has(node.name.getText(sf))) addText(node.initializer);
    if (isSchedule && ts.isVariableDeclaration(node) && node.initializer && SCHEDULE_CONSTS.has(node.name.getText(sf))) addText(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// Messages raised by the database: fail('CODE', 'message') — only whole literal messages can be matched.
const migrations = path.join(root, 'supabase/migrations');
for (const f of fs.readdirSync(migrations)) {
  const sql = fs.readFileSync(path.join(migrations, f), 'utf8');
  for (const m of sql.matchAll(/fail\(\s*'[A-Z_]+'\s*,\s*'((?:[^']|'')*)'\s*\)/g)) keys.add(m[1].replace(/''/g, "'"));
}

// Server-made notifications / audit labels (templates with {placeholders}).
const serverText = fs.readFileSync(path.join(root, 'src/i18n/serverText.ts'), 'utf8');
const block = serverText.split('/* templates:start */')[1]?.split('/* templates:end */')[0] ?? '';
for (const m of block.matchAll(/'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));

const sorted = [...keys].filter((k) => /[A-Za-z]/.test(k)).sort((a, b) => a.localeCompare(b));
fs.writeFileSync(path.join(root, 'src/i18n/keys.json'), JSON.stringify(sorted, null, 1) + '\n');
console.log(`${sorted.length} interface texts → src/i18n/keys.json`);

if (process.argv.includes('--check')) {
  let bad = false;
  const placeholders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const f of fs.readdirSync(path.join(root, 'src/i18n/locales')).sort()) {
    const dict = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales', f), 'utf8'));
    const missing = sorted.filter((k) => !dict[k]);
    const extra = Object.keys(dict).filter((k) => !keys.has(k));
    const brokenVars = sorted.filter((k) => dict[k] && placeholders(dict[k]) !== placeholders(k));
    console.log(`${f}: ${sorted.length - missing.length}/${sorted.length} translated${extra.length ? `, ${extra.length} unused` : ''}${brokenVars.length ? `, ${brokenVars.length} with wrong {placeholders}` : ''}`);
    if (missing.length || brokenVars.length) bad = true;
    if (process.argv.includes('--verbose')) {
      for (const k of missing.slice(0, 40)) console.log(`   missing: ${k}`);
      for (const k of brokenVars.slice(0, 40)) console.log(`   placeholders: ${k}`);
    }
  }
  process.exitCode = bad ? 1 : 0;
}
