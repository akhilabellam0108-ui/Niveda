/**
 * Web Push for medicine reminders. After the patient allows notifications, this device
 * registers with the server, which then pushes each due dose even when Niveda is closed.
 */
import { configService } from '../services';
import { api } from '../services/api';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyToBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Registers this device for reminders. Asks for permission if needed. Returns the permission state. */
export async function enablePush(ask = true): Promise<NotificationPermission | 'unsupported'> {
  if (!supported()) return 'unsupported';
  const permission = Notification.permission === 'default' && ask ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return permission;
  try {
    const cfg = await configService.get();
    if (!cfg.pushPublicKey) return permission; // server not configured for push; in-app alarms still work
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(cfg.pushPublicKey) }));
    const j = sub.toJSON();
    await api('POST', '/push/subscribe', { body: { endpoint: j.endpoint, keys: j.keys }, silent: true });
  } catch (e) {
    console.warn('Push registration failed', e);
  }
  return permission;
}

/** Stops reminders on this device (on sign-out, so the next person doesn’t get them). */
export async function disablePush() {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('POST', '/push/unsubscribe', { body: { endpoint: sub.endpoint }, silent: true }).catch(() => undefined);
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
}
