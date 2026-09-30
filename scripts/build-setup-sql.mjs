#!/usr/bin/env node
// Joins every migration into supabase/setup.sql, so a new Supabase project can be
// set up by pasting one file into the SQL editor. Run after changing a migration:
//   node scripts/build-setup-sql.mjs
// (The database tests fail if setup.sql is out of date.)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;

export function buildSetupSql() {
  const dir = join(root, 'supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const parts = files.map((f) => `-- ==================================================================\n-- ${f}\n-- ==================================================================\n\n${readFileSync(join(dir, f), 'utf8').trim()}\n`);
  return `-- Niveda — complete database setup for a NEW Supabase project.
-- Generated from supabase/migrations by scripts/build-setup-sql.mjs; don't edit by hand.
--
-- 1. Supabase → Database → Extensions → enable "pg_cron" first.
-- 2. SQL Editor → New query → paste this whole file → Run. It should end with "Success".
-- 3. Make yourself a Niveda administrator (reviews doctors' applications):
--      insert into public.admins (email) values ('you@example.com');
--    You become one as soon as you sign in to Niveda with that email.
--
-- Run it once. For an existing project, run only the new files in supabase/migrations.

${parts.join('\n')}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(join(root, 'supabase/setup.sql'), buildSetupSql());
  console.log('Wrote supabase/setup.sql');
}
