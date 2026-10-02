/**
 * The installable website (PWA) and medicine reminders by Web Push.
 *
 * In live mode with a VAPID key configured, a patient who allows notifications
 * gets each dose as a push notification — with a Taken button — on iPhone/iPad
 * (when Niveda is added to the Home Screen), Android browsers, Windows, macOS,
 * Linux and ChromeOS, even when Niveda is closed. The Android app uses its own
 * alarms instead (lib/nativeAlarms.ts), so none of this runs there.
 */
import { backend, isLive } from '../config/backend';
import { isNativeApp } from './nativeFiles';
import { pushService } from '../services';

const SW_URL = './sw.js';

const browserSupports = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext;

/** Registers the service worker so the site can be installed and work offline. */
export function registerServiceWorker() {
  if (isNativeApp() || !browserSupports() || (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) return;
  window.addEventListener('load', () => { void navigator.serviceWorker.register(SW_URL).catch(() => undefined); });
}

/** True when this device can get reminders pushed while Niveda is closed. */
export const webPushAvailable = () =>
  isLive && !!backend.vapidPublicKey && !isNativeApp() && browserSupports() && 'PushManager' in window && 'Notification' in window;

/** iPhone/iPad only allow web notifications once the site is added to the Home Screen. */
export const needsHomeScreen = () => {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
};

function keyBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; } catch { return 'Asia/Kolkata'; } };

/**
 * Subscribes this device (asking for permission when `ask` is true) and tells the
 * server, with the device's time zone. Safe to call on every app start.
 */
export async function enableWebPush(ask = true): Promise<NotificationPermission | 'unsupported'> {
  if (!webPushAvailable()) return 'unsupported';
  const permission = Notification.permission === 'default' && ask ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return permission;
  const reg = (await navigator.serviceWorker.getRegistration(SW_URL)) ?? (await navigator.serviceWorker.register(SW_URL));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(backend.vapidPublicKey!) }));
  const j = sub.toJSON();
  await pushService.saveSubscription(j.endpoint ?? '', j.keys?.p256dh ?? '', j.keys?.auth ?? '', timeZone());
  return permission;
}

/** On sign-out: stop reminders on this device so the next person doesn't get them. */
export async function disableWebPush() {
  if (!webPushAvailable()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await pushService.deleteSubscription(sub.endpoint);
    await sub.unsubscribe();
  } catch { /* best effort */ }
}
