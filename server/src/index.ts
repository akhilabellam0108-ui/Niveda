import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProductionConfig, config, isProd } from './config';
import { openDatabase } from './db/setup';
import { createApp } from './app';
import { startJobs } from './jobs';
import { initPush } from './services/push';

async function main() {
  assertProductionConfig();
  const db = await openDatabase();
  initPush();
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Built layout: dist/server/index.js next to dist/web/
  const webDir = process.env.WEB_DIR ?? path.resolve(here, '../web');
  const app = createApp(db, { webDir });
  const stopJobs = startJobs(db);
  const server = app.listen(config.port, () => {
    console.log(`Niveda API listening on http://localhost:${config.port}${isProd ? '' : ' (development)'}`);
    console.log(config.databaseUrl ? 'Database: PostgreSQL' : `Database: embedded Postgres in ${path.join(config.dataDir, 'pgdata')}`);
    if (config.otpDevEcho) console.log('One-time codes are shown in the app (OTP_DEV_ECHO=true). Never enable this in production.');
  });
  const shutdown = async () => {
    stopJobs();
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
