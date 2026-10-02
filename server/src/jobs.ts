/**
 * Background work, once a minute: expire access, warn patients before access ends,
 * push medicine reminders to subscribed devices, and tidy old sessions/codes.
 */
import { dosesFor, fmtClock, localNow } from '@shared/reminders';
import type { Db } from './db/db';
import { toGrant } from './db/mappers';
import { expireGrants, notify, prefsFor, touchPatient } from './core';
import { events } from './events';
import { pushToUser } from './services/push';
import { scheduleData } from './routes/medications';

async function remindBeforeExpiry(db: Db) {
  const rows = await db.query(`UPDATE access_grants SET reminder_sent = true WHERE status = 'active' AND NOT reminder_sent AND expires_at > now() AND expires_at < now() + interval '24 hours' RETURNING *`);
  for (const r of rows) {
    const g = toGrant(r);
    const d = await db.one<{ full_name: string }>('SELECT full_name FROM doctors WHERE id = $1', [g.doctorId]);
    const p = await db.one<{ user_id: string }>('SELECT user_id FROM patients WHERE id = $1', [g.patientId]);
    if (p) await notify(db, { userId: p.user_id, kind: 'reminder', title: 'Access ends soon', body: `${d?.full_name}’s access to your records ends within 24 hours.`, link: '/app/access' });
    await touchPatient(db, g.patientId);
  }
}

/** Sends one push per due dose (within 15 minutes of its time) to patients who enabled push. */
export async function pushDueDoses(db: Db) {
  const patients = await db.query<{ patient_id: string; user_id: string }>(
    `SELECT DISTINCT m.patient_id, p.user_id FROM medication_reminders m JOIN patients p ON p.id = m.patient_id
     JOIN push_subscriptions s ON s.user_id = p.user_id WHERE m.enabled`);
  let sent = 0;
  for (const { patient_id, user_id } of patients) {
    const prefs = await prefsFor(db, user_id);
    if (prefs.medAlarms === false) continue;
    const now = localNow(prefs.timezone);
    const { records, reminders, logs } = await scheduleData(db, patient_id);
    const due = dosesFor(now.date, records, reminders, logs, now).filter((d) => d.status === 'due' && now.minutes - toMin(d.time) <= 15);
    for (const d of due) {
      const inserted = await db.query('INSERT INTO push_sent (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [`${user_id}|${d.key}`]);
      if (!inserted.length) continue;
      sent += await pushToUser(db, user_id, {
        title: `Time to take ${d.name}`, body: `${d.dosage} · due ${fmtClock(d.time)}${d.instructions ? ` · ${d.instructions}` : ''}`,
        tag: d.key, url: '/#/app/medications', data: { recordId: d.recordId, date: d.date, time: d.time },
        actions: [{ action: 'taken', title: 'Taken' }, { action: 'snooze', title: 'Snooze 10 min' }],
      });
    }
  }
  return sent;
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

async function tidy(db: Db) {
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query(`DELETE FROM otp_challenges WHERE created_at < now() - interval '1 day'`);
  await db.query(`DELETE FROM push_sent WHERE sent_at < now() - interval '3 days'`);
}

export function startJobs(db: Db) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await expireGrants(db);
      await remindBeforeExpiry(db);
      await pushDueDoses(db);
      await tidy(db);
    } catch (e) {
      console.error('Background job failed', e);
    } finally {
      running = false;
    }
  };
  void tick();
  const a = setInterval(() => void tick(), 60_000);
  const b = setInterval(() => events.heartbeat(), 25_000);
  return () => { clearInterval(a); clearInterval(b); };
}
