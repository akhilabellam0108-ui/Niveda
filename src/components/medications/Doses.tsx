import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, Check, SkipForward, Undo2, AlarmClock, Pill } from 'lucide-react';
import { medicationService, friendlyError, subscribe, type Dose } from '../../services';
import { perTab } from '../../mock/storage';
import { fmtClock } from '../../lib/reminders';
import { brand } from '../../config/brand';
import { useSession } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { Badge, Button, EmptyState, Modal } from '../ui';
import { isNativeApp, syncNativeAlarms } from '../../lib/nativeAlarms';

/** Re-render on an interval so "due" / "missed" labels stay current. */
export function useClock(ms = 30000) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setT(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return t;
}

const STATUS: Record<Dose['status'], { label: string; tone?: 'ok' | 'warn' | 'danger' | 'info' }> = {
  taken: { label: 'Taken', tone: 'ok' }, skipped: { label: 'Skipped' }, due: { label: 'Due now', tone: 'warn' },
  upcoming: { label: 'Upcoming', tone: 'info' }, missed: { label: 'Missed', tone: 'danger' },
};

export function DoseList({ doses, compact }: { doses: Dose[]; compact?: boolean }) {
  const toast = useToast();
  const act = async (d: Dose, status: 'taken' | 'skipped' | 'undo') => {
    try {
      if (status === 'undo') await medicationService.undoDose(d.recordId, d.date, d.time);
      else { await medicationService.logDose(d.recordId, d.date, d.time, status); toast(status === 'taken' ? `${d.name} marked as taken` : `${d.name} skipped`); }
    } catch (e) { toast(friendlyError(e), 'error'); }
  };
  if (!doses.length) return <EmptyState compact icon={Pill} title="No doses scheduled today" body="Medicines with reminder times appear here each day." />;
  return (
    <ul className="list" aria-label="Today’s doses">
      {doses.map((d) => {
        const done = d.status === 'taken' || d.status === 'skipped';
        return (
          <li key={d.key} className={`dose-row ${d.status === 'due' ? 'due' : ''} ${d.status === 'missed' ? 'missed' : ''} ${done ? 'done' : ''}`}>
            <span className="dose-time">{fmtClock(d.time)}</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small strong dose-name truncate">{d.name} <span className="muted" style={{ fontWeight: 400 }}>{d.dosage}</span></div>
              {!compact && d.instructions && <div className="xs muted truncate">{d.instructions}</div>}
            </div>
            {(!compact || ['due', 'missed', 'taken'].includes(d.status)) && <Badge tone={STATUS[d.status].tone} dot={d.status === 'due'}>{STATUS[d.status].label}</Badge>}
            {done ? (
              <Button size="sm" variant="ghost" iconOnly icon={Undo2} aria-label={`Undo ${d.name} at ${fmtClock(d.time)}`} onClick={() => act(d, 'undo')} />
            ) : (
              <div className="row" style={{ '--gap': '4px' } as React.CSSProperties}>
                <Button size="sm" variant={d.status === 'upcoming' ? 'secondary' : 'primary'} icon={Check} iconOnly={compact} aria-label={`Mark ${d.name} at ${fmtClock(d.time)} as taken`} onClick={() => act(d, 'taken')}>{!compact && <span className="desktop-only">Taken</span>}</Button>
                <Button size="sm" variant="ghost" iconOnly icon={SkipForward} aria-label={`Skip ${d.name} at ${fmtClock(d.time)}`} onClick={() => act(d, 'skipped')} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- Alarm ---------------- */

const ALERTED_KEY = 'niveda.alerted';

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.28);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.3);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch { /* audio not available */ }
}

export function showSystemNotification(title: string, body: string, tag: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, tag, requireInteraction: true, icon: undefined });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* not supported */ }
}

export function testAlarm(sound: boolean) {
  if (sound) beep();
  showSystemNotification(`${brand.name}: test reminder`, 'This is how medicine reminders will appear.', 'niveda-test');
}

/**
 * Watches today's schedule while the app is open. When a dose falls due it rings,
 * shows a system notification (if allowed) and opens a reminder with Taken / Skip / Snooze.
 */
export function MedicationAlarms() {
  const { prefs } = useSession();
  const toast = useToast();
  const [due, setDue] = useState<Dose[]>([]);
  const [open, setOpen] = useState(false);
  const alerted = useRef<Set<string>>(new Set(JSON.parse(perTab.get(ALERTED_KEY) ?? '[]') as string[]));
  const snoozed = useRef<Map<string, number>>(new Map());

  const check = useCallback(async () => {
    if (!prefs.medAlarms) { setDue([]); return; }
    let doses: Dose[];
    try { doses = await medicationService.today(); } catch { return; }
    const t = Date.now();
    const list = doses.filter((d) => d.status === 'due' && (snoozed.current.get(d.key) ?? 0) <= t);
    setDue(list);
    const fresh = list.filter((d) => !alerted.current.has(d.key));
    if (!fresh.length) { if (!list.length) setOpen(false); return; }
    fresh.forEach((d) => alerted.current.add(d.key));
    perTab.set(ALERTED_KEY, JSON.stringify([...alerted.current].slice(-200)));
    setOpen(true);
    if (prefs.medAlarmSound) beep();
    showSystemNotification(
      fresh.length === 1 ? `Time to take ${fresh[0].name}` : `Time to take ${fresh.length} medicines`,
      fresh.map((d) => `${d.name} ${d.dosage} · ${fmtClock(d.time)}`).join('\n'),
      fresh[0].key,
    );
  }, [prefs.medAlarms, prefs.medAlarmSound]);

  useEffect(() => {
    void check();
    const id = setInterval(() => void check(), 20000);
    const unsub = subscribe(() => void check());
    return () => { clearInterval(id); unsub(); };
  }, [check]);

  const log = async (d: Dose, status: 'taken' | 'skipped') => {
    try {
      await medicationService.logDose(d.recordId, d.date, d.time, status);
      setDue((x) => { const n = x.filter((y) => y.key !== d.key); if (!n.length) setOpen(false); return n; });
    } catch (e) { toast(friendlyError(e), 'error'); }
  };
  const snooze = () => {
    const until = Date.now() + 10 * 60000;
    due.forEach((d) => { snoozed.current.set(d.key, until); alerted.current.delete(d.key); });
    setOpen(false);
    toast('We’ll remind you again in 10 minutes');
  };

  return (
    <Modal open={open && due.length > 0} onClose={() => setOpen(false)} size="sm" title="Time for your medicine"
      footer={<><Button icon={AlarmClock} onClick={snooze}>Snooze 10 min</Button><Button variant="ghost" onClick={() => setOpen(false)}>Later</Button></>}>
      <div className="stack">
        <div className="alarm-ring" aria-hidden><BellRing /></div>
        <ul className="list card">
          {due.map((d) => (
            <li key={d.key} className="dose-row" style={{ padding: '12px 14px' }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="strong">{d.name} <span className="muted" style={{ fontWeight: 400 }}>{d.dosage}</span></div>
                <div className="xs muted">Due {fmtClock(d.time)}{d.instructions ? ` · ${d.instructions}` : ''}</div>
              </div>
              <Button size="sm" variant="primary" icon={Check} onClick={() => log(d, 'taken')}>Taken</Button>
              <Button size="sm" variant="ghost" iconOnly icon={SkipForward} aria-label={`Skip ${d.name}`} onClick={() => log(d, 'skipped')} />
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/**
 * In the Android app, keeps the phone's medicine alarms in step with the record:
 * on start, whenever reminders or prescriptions change, and when the app comes back
 * to the foreground. Does nothing in a browser.
 */
export function NativeAlarmSync() {
  const { prefs } = useSession();
  useEffect(() => {
    if (!isNativeApp()) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const run = () => { clearTimeout(t); t = setTimeout(() => { void syncNativeAlarms(prefs.medAlarms).catch(() => undefined); }, 800); };
    run();
    const unsub = subscribe(run);
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(t); unsub(); document.removeEventListener('visibilitychange', onVisible); };
  }, [prefs.medAlarms]);
  return null;
}
