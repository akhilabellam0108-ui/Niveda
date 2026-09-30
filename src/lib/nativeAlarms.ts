/**
 * Medicine alarms in the Android app. They are scheduled with the phone's own
 * alarm service, so they ring on time even when Niveda is closed, the phone is
 * idle or it has been restarted. Each has Taken / Snooze / Skip buttons, which
 * also appear on a paired smartwatch (Wear OS shows the phone's notifications).
 *
 * In a browser every function here does nothing; the in-app alarm
 * (components/medications/Doses.tsx) covers the web version.
 */
import { LocalNotifications, type ActionPerformed } from '@capacitor/local-notifications';
import { medicationService } from '../services';
import { planAlarms, type PlannedAlarm } from './alarmPlan';

import { isNativeApp } from './nativeFiles';

export { isNativeApp };

const CHANNEL = 'medicines';
const ACTIONS = 'dose';
const SNOOZE_MINUTES = 10;

type DoseExtra = { kind: 'dose' | 'snooze'; recordId: string; date: string; time: string };

let ready: Promise<void> | null = null;

/** Once per app start: the notification channel, the action buttons and what they do. */
export function initNativeAlarms(): Promise<void> {
  if (!isNativeApp()) return Promise.resolve();
  if (!ready) {
    ready = (async () => {
      await LocalNotifications.createChannel({
        id: CHANNEL, name: 'Medicine reminders', description: 'Rings when it’s time to take a medicine',
        importance: 5, visibility: 0, vibration: true, lights: true, lightColor: '#1d6b5f',
      });
      await LocalNotifications.registerActionTypes({
        types: [{
          id: ACTIONS,
          actions: [
            { id: 'taken', title: 'Taken' },
            { id: 'snooze', title: `Snooze ${SNOOZE_MINUTES} min` },
            { id: 'skip', title: 'Skip', destructive: true },
          ],
        }],
      });
      await LocalNotifications.addListener('localNotificationActionPerformed', (a) => { void handleAction(a); });
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function handleAction({ actionId, notification }: ActionPerformed) {
  const x = notification.extra as DoseExtra | undefined;
  if (!x?.recordId) return;
  try {
    if (actionId === 'taken' || actionId === 'skip') {
      await medicationService.logDose(x.recordId, x.date, x.time, actionId === 'taken' ? 'taken' : 'skipped');
      return;
    }
    if (actionId === 'snooze') {
      await LocalNotifications.schedule({
        notifications: [{
          id: (notification.id ^ 0x40000000) & 0x7fffffff, title: notification.title, body: notification.body,
          schedule: { at: new Date(Date.now() + SNOOZE_MINUTES * 60000), allowWhileIdle: true },
          channelId: CHANNEL, actionTypeId: ACTIONS, extra: { ...x, kind: 'snooze' } satisfies DoseExtra,
        }],
      });
      return;
    }
  } catch {
    // Not signed in on this start (or offline): open the medicines page instead.
  }
  window.location.hash = '#/app/medications';
}

export type AlarmPermission = 'granted' | 'needs-permission' | 'needs-exact' | 'unsupported';

/** Whether reminders can ring, and on time. */
export async function alarmPermission(): Promise<AlarmPermission> {
  if (!isNativeApp()) return 'unsupported';
  const p = await LocalNotifications.checkPermissions();
  if (p.display !== 'granted') return 'needs-permission';
  try {
    const exact = await LocalNotifications.checkExactNotificationSetting();
    if (exact.exact_alarm !== 'granted') return 'needs-exact';
  } catch {
    // Older Android versions allow exact alarms without asking.
  }
  return 'granted';
}

/** Asks for whatever is missing. Returns the new state. */
export async function requestAlarmPermission(): Promise<AlarmPermission> {
  if (!isNativeApp()) return 'unsupported';
  const now = await alarmPermission();
  if (now === 'needs-permission') await LocalNotifications.requestPermissions();
  else if (now === 'needs-exact') await LocalNotifications.changeExactNotificationSetting();
  return alarmPermission();
}

let lastPlan = '';

/**
 * Makes the phone's scheduled alarms match the patient's current reminders.
 * Cheap to call often: it only changes what differs.
 */
export async function syncNativeAlarms(enabled: boolean): Promise<number> {
  if (!isNativeApp()) return 0;
  await initNativeAlarms();
  let plan: PlannedAlarm[] = [];
  if (enabled) {
    const [schedules, today] = await Promise.all([medicationService.schedules(), medicationService.today()]);
    const logged = new Set(today.filter((d) => d.status === 'taken' || d.status === 'skipped').map((d) => `${d.recordId}|${d.date}|${d.time}`));
    plan = planAlarms({ schedules, logged, now: new Date(), enabled });
  }
  const signature = plan.map((p) => `${p.id}@${p.at.getTime()}:${p.title}:${p.body}`).join(',');
  if (signature === lastPlan) return plan.length;

  if (plan.length && (await LocalNotifications.checkPermissions()).display === 'prompt') {
    await LocalNotifications.requestPermissions();
  }
  const pending = (await LocalNotifications.getPending()).notifications.filter((n) => (n.extra as DoseExtra | undefined)?.kind === 'dose');
  const wanted = new Map(plan.map((p) => [p.id, p]));
  const stale = pending.filter((n) => {
    const p = wanted.get(n.id);
    return !p || n.title !== p.title || n.body !== p.body || new Date(n.schedule?.at ?? 0).getTime() !== p.at.getTime();
  });
  if (stale.length) await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) });
  const kept = new Set(pending.filter((n) => !stale.includes(n)).map((n) => n.id));
  const add = plan.filter((p) => !kept.has(p.id));
  for (let i = 0; i < add.length; i += 50) {
    await LocalNotifications.schedule({
      notifications: add.slice(i, i + 50).map((p) => ({
        id: p.id, title: p.title, body: p.body, largeBody: p.body,
        schedule: { at: p.at, allowWhileIdle: true },
        channelId: CHANNEL, actionTypeId: ACTIONS, autoCancel: true, group: 'niveda-medicines',
        extra: { kind: 'dose', recordId: p.recordId, date: p.date, time: p.time } satisfies DoseExtra,
      })),
    });
  }
  lastPlan = signature;
  return plan.length;
}

/** On sign-out: no medicine names left on the phone. */
export async function clearNativeAlarms(): Promise<void> {
  if (!isNativeApp()) return;
  lastPlan = '';
  const pending = (await LocalNotifications.getPending()).notifications;
  if (pending.length) await LocalNotifications.cancel({ notifications: pending.map((n) => ({ id: n.id })) });
  await LocalNotifications.removeAllDeliveredNotifications().catch(() => undefined);
}
