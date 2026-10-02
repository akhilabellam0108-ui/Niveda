/**
 * Web Push: lets medicine reminders reach the phone or computer even when Niveda
 * isn't open. Uses VAPID keys (generated for development if not configured).
 */
import webpush from 'web-push';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, isProd, isTest } from '../config';
import type { Db } from '../db/db';

let ready = false;
let publicKey = '';

export function initPush(): string {
  if (ready) return publicKey;
  let { publicKey: pub, privateKey: priv } = config.push;
  if (!pub || !priv) {
    if (isProd) { console.warn('VAPID keys not set — push reminders are disabled.'); return ''; }
    if (isTest) return '';
    const file = path.join(config.dataDir, 'dev-vapid.json');
    if (existsSync(file)) ({ publicKey: pub, privateKey: priv } = JSON.parse(readFileSync(file, 'utf8')));
    else {
      ({ publicKey: pub, privateKey: priv } = webpush.generateVAPIDKeys());
      mkdirSync(config.dataDir, { recursive: true });
      writeFileSync(file, JSON.stringify({ publicKey: pub, privateKey: priv }), { mode: 0o600 });
    }
  }
  webpush.setVapidDetails(config.push.subject, pub, priv);
  ready = true;
  publicKey = pub;
  return pub;
}

export async function pushToUser(db: Db, userId: string, payload: { title: string; body: string; tag?: string; url?: string; actions?: { action: string; title: string }[]; data?: unknown }) {
  if (!ready) return 0;
  const subs = await db.query<{ endpoint: string; keys: { p256dh: string; auth: string } }>('SELECT endpoint, keys FROM push_subscriptions WHERE user_id = $1', [userId]);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [s.endpoint]);
      else console.warn('Push failed', code);
    }
  }
  return sent;
}
