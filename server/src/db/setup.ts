/**
 * Database setup: connect, apply the schema, create reference data and (in development)
 * load the demo world once.
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { config, isTest } from '../config';
import { connectPglite, connectPostgres, type Db } from './db';
import { SCHEMA_SQL } from './schema';
import { hospitals } from './demoData';
import { loadDemo } from './demo';

export async function openDatabase(opts: { memory?: boolean; seedDemo?: boolean } = {}): Promise<Db> {
  let db: Db;
  if (config.databaseUrl && !opts.memory) db = await connectPostgres(config.databaseUrl, config.databaseSsl);
  else if (opts.memory || isTest) db = await connectPglite();
  else {
    const dir = path.join(config.dataDir, 'pgdata');
    mkdirSync(dir, { recursive: true });
    db = await connectPglite(dir);
  }
  await db.exec(SCHEMA_SQL);
  const demo = opts.seedDemo ?? config.seedDemo;
  const loaded = await db.one(`SELECT 1 FROM app_meta WHERE key = 'demo_loaded'`);
  const anyUsers = await db.one('SELECT 1 FROM users LIMIT 1');
  if (demo && !loaded && !anyUsers) {
    await loadDemo(db);
    if (!isTest) console.log('Loaded fictional demo data (SEED_DEMO=true).');
  } else {
    // Hospitals are reference data every install needs; add the defaults if none exist.
    if (!(await db.one('SELECT 1 FROM hospitals LIMIT 1'))) {
      for (const h of hospitals) await db.query('INSERT INTO hospitals (id, name, city, type) VALUES ($1,$2,$3,$4)', [h.id, h.name, h.city, h.type]);
    }
  }
  return db;
}
