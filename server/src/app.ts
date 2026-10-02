/** Builds the Express app. Kept separate from index.ts so tests can run it in-process. */
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { AppError } from '@shared/api';
import { config, isTest } from './config';
import type { Db } from './db/db';
import { errorHandler, h, ctxOf } from './core';
import { events } from './events';
import { authRoutes, requireAuth, sessionMiddleware } from './routes/auth';
import { recordRoutes } from './routes/records';
import { documentRoutes } from './routes/documents';
import { accessRoutes } from './routes/access';
import { patientRoutes } from './routes/patient';
import { auditRoutes, doctorRoutes, notificationRoutes, settingsRoutes } from './routes/misc';
import { medicationRoutes } from './routes/medications';
import { extraRoutes, publicConfig } from './routes/extras';

export function createApp(db: Db, opts: { webDir?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        workerSrc: ["'self'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => { req.db = db; next(); });

  const api = express.Router();
  // CSRF defence: state-changing API calls must carry a custom header, which other sites can't send.
  api.use((req: Request, _res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('x-niveda') === '1') return next();
    next(new AppError('ACCESS_DENIED', 'Request blocked.'));
  });
  if (!isTest) {
    api.use('/auth', rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes.' } } }));
    api.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } } }));
  }
  api.use(sessionMiddleware());

  api.get('/health', h(async (_req, res) => { await db.query('SELECT 1'); res.json({ ok: true }); }));
  api.get('/config', (_req, res) => { res.json(publicConfig()); });
  api.use('/auth', authRoutes());

  api.use(requireAuth);
  api.get('/events', (req, res) => {
    const ctx = ctxOf(req);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    events.add(ctx.user.id, res);
  });
  api.use('/records', recordRoutes());
  api.use('/documents', documentRoutes());
  api.use('/access', accessRoutes());
  api.use('/patient', patientRoutes());
  api.use('/doctor', doctorRoutes());
  api.use('/notifications', notificationRoutes());
  api.use('/audit', auditRoutes());
  api.use('/settings', settingsRoutes());
  api.use('/medications', medicationRoutes());
  api.use('/', extraRoutes());
  api.use((_req, _res, next) => next(new AppError('NOT_FOUND', 'Not found.')));

  app.use('/api', api);

  // In production the same server serves the built web app.
  const web = opts.webDir;
  if (web && existsSync(web)) {
    app.use(express.static(web, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('sw.js') || p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(web, 'index.html')); });
  }

  app.use(errorHandler);
  return app;
}
