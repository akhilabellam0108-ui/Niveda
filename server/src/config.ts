/**
 * All server settings come from environment variables (see .env.example).
 * Production refuses to start with unsafe or missing settings.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const env = process.env;
const bool = (v: string | undefined, d = false) => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

const dataDir = path.resolve(env.DATA_DIR ?? 'data');

/** In development, generate secrets once and keep them in data/dev-secrets.json. */
function devSecret(name: string, bytes = 32): string {
  if (isProd) throw new Error(`${name} must be set in production`);
  if (isTest) return randomBytes(bytes).toString('base64');
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'dev-secrets.json');
  const store: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (!store[name]) {
    store[name] = randomBytes(bytes).toString('base64');
    writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
  }
  return store[name];
}

export const config = {
  port: Number(env.PORT ?? 8080),
  appUrl: env.APP_URL ?? 'http://localhost:5173',
  dataDir,
  /** Postgres connection string. When empty, an embedded Postgres (PGlite) in DATA_DIR is used. */
  databaseUrl: env.DATABASE_URL ?? '',
  databaseSsl: bool(env.DATABASE_SSL),
  /** Where encrypted documents are stored. */
  storageDir: path.resolve(env.STORAGE_DIR ?? path.join(dataDir, 'files')),
  /** 32-byte key (base64) used to encrypt documents at rest with AES-256-GCM. */
  fileKey: Buffer.from(env.FILE_ENCRYPTION_KEY ?? devSecret('FILE_ENCRYPTION_KEY'), 'base64'),
  /** Secret mixed into one-time-code hashes. */
  otpPepper: env.OTP_PEPPER ?? devSecret('OTP_PEPPER'),
  sessionHours: Number(env.SESSION_HOURS ?? 12),
  cookieSecure: bool(env.COOKIE_SECURE, isProd),
  trustProxy: bool(env.TRUST_PROXY, isProd),

  otpChannel: (env.OTP_CHANNEL ?? 'email') as 'email' | 'sms',
  /** Show one-time codes in API responses. For local development only; refused in production. */
  otpDevEcho: bool(env.OTP_DEV_ECHO, !isProd),

  smtp: {
    url: env.SMTP_URL ?? '',
    host: env.SMTP_HOST ?? '',
    port: Number(env.SMTP_PORT ?? 587),
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
    from: env.MAIL_FROM ?? 'Niveda <no-reply@niveda.local>',
  },
  sms: {
    provider: (env.SMS_PROVIDER ?? 'none') as 'none' | 'twilio' | 'msg91',
    twilioSid: env.TWILIO_ACCOUNT_SID ?? '',
    twilioToken: env.TWILIO_AUTH_TOKEN ?? '',
    twilioFrom: env.TWILIO_FROM ?? '',
    msg91Key: env.MSG91_AUTH_KEY ?? '',
    msg91Template: env.MSG91_TEMPLATE_ID ?? '',
  },
  push: {
    publicKey: env.VAPID_PUBLIC_KEY ?? '',
    privateKey: env.VAPID_PRIVATE_KEY ?? '',
    subject: env.VAPID_SUBJECT ?? 'mailto:admin@niveda.local',
  },
  /** Load fictional demo patients and doctors on first start. */
  seedDemo: bool(env.SEED_DEMO, !isProd),
  demoPassword: env.DEMO_PASSWORD ?? 'demo1234',
};

export function assertProductionConfig() {
  if (!isProd) return;
  const problems: string[] = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is required');
  if (config.fileKey.length !== 32) problems.push('FILE_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  if (!env.OTP_PEPPER) problems.push('OTP_PEPPER is required (a long random secret)');
  if (config.otpDevEcho) problems.push('OTP_DEV_ECHO must be off');
  if (config.otpChannel === 'email' && !config.smtp.url && !config.smtp.host) problems.push('SMTP settings are required to send codes by email');
  if (config.otpChannel === 'sms' && config.sms.provider === 'none') problems.push('SMS_PROVIDER is required when OTP_CHANNEL=sms');
  if (!config.cookieSecure) problems.push('COOKIE_SECURE must be on (serve over HTTPS)');
  if (problems.length) throw new Error(`Unsafe production configuration:\n - ${problems.join('\n - ')}`);
}
