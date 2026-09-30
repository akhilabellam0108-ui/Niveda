import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Plus, Ban, History, TriangleAlert, UserRound, CalendarDays, BellRing, BellOff, Watch, Bell, CalendarPlus, Smartphone } from 'lucide-react';
import type { MedicalRecord } from '../../types';
import { isMedicationActive, medicationService, recordService, friendlyError, type MedicationSchedule } from '../../services';
import { DoseList, useClock } from '../../components/medications/Doses';
import { TimesEditor } from '../../components/medications/TimesEditor';
import { downloadBlob } from '../../components/documents/DocumentViewer';
import { defaultTimes, fmtClock } from '../../lib/reminders';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { brand } from '../../config/brand';
import { fmtDate } from '../../lib/dates';
import { ALLERGY_SEVERITY_RANK, isSevereAllergy } from '../../lib/recordMeta';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, InlineError, Input, Modal, SkeletonList, Tabs } from '../../components/ui';
import { StatusBadge, TypeIcon } from '../../components/records/RecordCard';
import { usePatientUI } from '../../components/layout/PatientShell';
import { alarmPermission, isNativeApp, requestAlarmPermission, type AlarmPermission } from '../../lib/nativeAlarms';

export function MedicationsPage() {
  useDocumentTitle(`Medications · ${brand.name}`);
  const ui = usePatientUI();
  const toast = useToast();
  const records = useLive(() => recordService.list(), []);
  const [tab, setTab] = useState<'current' | 'past'>('current');
  const [stop, setStop] = useState<MedicalRecord>();
  const [reason, setReason] = useState('');
  const meds = useMemo(() => (records.data ?? []).filter((r) => r.type === 'medication'), [records.data]);
  const current = meds.filter((m) => isMedicationActive(m));
  const past = meds.filter((m) => !isMedicationActive(m));
  const list = tab === 'current' ? current : past;
  const tick = useClock(60000);
  const doses = useLive(() => medicationService.today(), [tick]);
  const schedules = useLive(() => medicationService.schedules(), []);
  const sched = (id: string) => schedules.data?.find((x) => x.record.id === id);
  const [editing, setEditing] = useState<MedicationSchedule>();
  const [watchOpen, setWatchOpen] = useState(false);

  return (
    <>
      <div className="page-head">
        <div><h1>Medications</h1><p>What you take now and everything you’ve taken before. Prescriptions from your doctors appear here automatically.</p></div>
        <Button variant="primary" icon={Plus} onClick={() => ui.addRecord('medication')}>Add medication</Button>
      </div>
      <NotificationPrompt />
      <section className="card" aria-label="Today’s doses">
        <div className="card-head">
          <h2>Today’s doses</h2>
          <Button size="sm" icon={Watch} onClick={() => setWatchOpen(true)}>Phone & smartwatch</Button>
        </div>
        {!doses.data ? <SkeletonList rows={2} card={false} /> : <DoseList doses={doses.data} />}
      </section>
      <Tabs label="Medication lists" value={tab} onChange={setTab} tabs={[{ value: 'current', label: 'Current', count: current.length }, { value: 'past', label: 'Previous', count: past.length }]} />
      {records.error ? <ErrorState error={records.error} onRetry={records.reload} /> : !records.data ? <SkeletonList rows={3} /> : list.length === 0 ? (
        <div className="card">
          {tab === 'current'
            ? <EmptyState icon={Pill} title="No medications recorded yet" body="Add your first medication to keep your treatment history up to date." action={<Button variant="primary" icon={Plus} onClick={() => ui.addRecord('medication')}>Add medication</Button>} />
            : <EmptyState icon={History} title="No previous medications" body="Medicines you stop or finish will move here, with their full history." />}
        </div>
      ) : (
        <div className="card">
          {list.map((m) => (
            <div key={m.id} className="med-card">
              <TypeIcon type="medication" />
              <div className="grow stack" style={{ '--gap': '6px', minWidth: 0 } as React.CSSProperties}>
                <div className="row-wrap">
                  <button className="rec-open" style={{ fontSize: 'var(--t-md)' }} onClick={() => ui.openRecord(m.id)}>{String(m.data.name)}</button>
                  <span className="med-dose muted">{String(m.data.dosage)}</span>
                  <StatusBadge record={m} />
                  {m.version > 1 && <Badge icon={History}>v{m.version}</Badge>}
                </div>
                <div className="small">{String(m.data.frequency)}{m.data.reason ? ` · for ${String(m.data.reason)}` : ''}</div>
                {m.data.instructions && <div className="small muted">{String(m.data.instructions)}</div>}
                {isMedicationActive(m) && (() => {
                  const sc = sched(m.id);
                  if (!sc) return null;
                  const pct = sc.adherence.pct;
                  return (
                    <div className="row-wrap" style={{ '--gap': '10px' } as React.CSSProperties}>
                      {sc.reminder.enabled && sc.reminder.times.length
                        ? <Badge tone="accent" icon={BellRing}>{sc.reminder.times.map(fmtClock).join(' · ')}</Badge>
                        : <Badge icon={BellOff}>{m.data.frequency === 'As needed' ? 'As needed · no reminders' : 'Reminders off'}</Badge>}
                      {pct !== undefined && (
                        <span className={`adherence ${pct < 80 ? 'low' : ''}`} title={`${sc.adherence.taken} of ${sc.adherence.due} doses taken in the last 7 days`}>
                          <span className="bar"><div style={{ width: `${pct}%` }} /></span>{pct}% taken · last 7 days
                        </span>
                      )}
                    </div>
                  );
                })()}
                <div className="rec-meta">
                  <span><CalendarDays aria-hidden />{fmtDate(m.date)} → {m.data.discontinuedOn ? `stopped ${fmtDate(String(m.data.discontinuedOn))}` : m.data.endDate ? fmtDate(String(m.data.endDate)) : 'ongoing'}</span>
                  <span><UserRound aria-hidden />{m.data.prescriber ? String(m.data.prescriber) : m.createdBy.role === 'patient' ? 'Added by you' : m.createdBy.name}</span>
                </div>
              </div>
              <div className="med-actions">
                {isMedicationActive(m) && sched(m.id) && <Button size="sm" variant="ghost" icon={BellRing} onClick={() => setEditing(sched(m.id))}><span className="desktop-only">Reminders</span></Button>}
                <Button size="sm" variant="ghost" icon={History} onClick={() => ui.openRecord(m.id)}><span className="desktop-only">History</span></Button>
                {isMedicationActive(m) && <Button size="sm" icon={Ban} onClick={() => { setReason(''); setStop(m); }}><span className="desktop-only">Stop</span></Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!stop} onClose={() => setStop(undefined)} danger confirmLabel="Stop medication" title={`Stop ${stop ? String(stop.data.name) : ''}?`}
        body="It moves to your previous medications and the change is added to your timeline. Talk to your doctor before stopping prescribed medicines."
        onConfirm={async () => { await recordService.discontinueMedication(stop!.id, reason); toast('Medication stopped'); }}>
        <Field label="Reason (optional)">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Course completed" />}</Field>
      </ConfirmDialog>
      {editing && <ReminderDialog schedule={editing} onClose={() => setEditing(undefined)} />}
      <WatchDialog open={watchOpen} onClose={() => setWatchOpen(false)} />
    </>
  );
}

function ReminderDialog({ schedule, onClose }: { schedule: MedicationSchedule; onClose: () => void }) {
  const toast = useToast();
  const r = schedule.record;
  const [enabled, setEnabled] = useState(schedule.reminder.enabled);
  const [times, setTimes] = useState<string[]>(schedule.reminder.times.length ? schedule.reminder.times : defaultTimes(String(r.data.frequency)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  return (
    <Modal open onClose={onClose} title={`Reminders · ${r.data.name}`} description={`${r.data.dosage} · ${r.data.frequency}. Changing times doesn’t change the prescription.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => {
        setBusy(true); setErr(undefined);
        try { await medicationService.setReminder(r.id, times, enabled); toast('Reminders saved'); onClose(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
      }}>Save</Button></>}>
      <div className="stack">
        <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span><b>Remind me to take this</b><br /><span className="xs muted">Rings and shows a notification when each dose is due.</span></span></label>
        {enabled && <TimesEditor times={times} onChange={setTimes} />}
        <InlineError message={err} />
      </div>
    </Modal>
  );
}

export function NotificationPrompt() {
  const native = isNativeApp();
  const supported = !native && typeof window !== 'undefined' && 'Notification' in window;
  const [perm, setPerm] = useState(supported ? Notification.permission : 'denied');
  const [alarm, setAlarm] = useState<AlarmPermission>('granted');
  useEffect(() => { if (supported) setPerm(Notification.permission); }, [supported]);
  useEffect(() => {
    if (!native) return;
    const check = () => { void alarmPermission().then(setAlarm); };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [native]);

  if (native) {
    if (alarm === 'granted' || alarm === 'unsupported') return null;
    return (
      <div className="alert alert-warn">
        <Bell aria-hidden />
        <div className="grow">
          <div className="alert-title">{alarm === 'needs-permission' ? 'Allow notifications so your medicine alarms can ring' : 'Allow exact alarms so doses ring on time'}</div>
          <div>{alarm === 'needs-permission' ? `${brand.name} rings at each dose time, even when the app is closed.` : 'Without this, Android may delay reminders by several minutes to save battery. Turn on “Alarms & reminders” for Niveda.'}</div>
        </div>
        <Button size="sm" variant="primary" onClick={async () => setAlarm(await requestAlarmPermission())}>{alarm === 'needs-permission' ? 'Allow' : 'Open settings'}</Button>
      </div>
    );
  }
  if (!supported || perm === 'granted') return null;
  return (
    <div className={`alert ${perm === 'denied' ? 'alert-warn' : 'alert-accent'}`}>
      <Bell aria-hidden />
      <div className="grow">
        <div className="alert-title">{perm === 'denied' ? 'Notifications are blocked' : 'Get reminders even when this tab is in the background'}</div>
        <div>{perm === 'denied' ? 'Allow notifications for this site in your browser settings to get medicine alerts outside the app.' : 'Allow notifications so each dose pops up on your screen — and on a watch paired with your phone.'} For alarms that ring even when {brand.name} is closed, <a href={brand.androidAppUrl}>get the Android app</a>.</div>
      </div>
      {perm === 'default' && <Button size="sm" variant="primary" onClick={async () => setPerm(await Notification.requestPermission())}>Allow</Button>}
    </div>
  );
}

function WatchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const native = isNativeApp();
  if (native) {
    return (
      <Modal open={open} onClose={onClose} title="Reminders on your phone and smartwatch" footer={<Button variant="primary" onClick={onClose}>Done</Button>}
        description={`${brand.name} sets an alarm on this phone for every dose in the next two weeks. It rings even when the app is closed or the phone restarts, and moves automatically when your times change.`}>
        <ul className="small stack" style={{ '--gap': '8px', paddingLeft: 18, margin: 0 } as React.CSSProperties}>
          <li>Press <strong>Taken</strong>, <strong>Snooze</strong> or <strong>Skip</strong> right on the notification.</li>
          <li><strong>Wear OS watches</strong> (Pixel, Galaxy Watch 4 and later, and others) show the same reminder with the same buttons, so you can mark a dose from your wrist.</li>
          <li>Other watches and fitness bands buzz too if phone notifications are mirrored to them in their companion app (turn on notifications for {brand.name}).</li>
          <li>Open {brand.name} at least once a fortnight so the next two weeks of alarms are set.</li>
        </ul>
      </Modal>
    );
  }
  return (
    <Modal open={open} onClose={onClose} title="Reminders on your phone and smartwatch"
      description="Get the Android app for alarms that ring even when Niveda is closed, with Taken / Snooze / Skip on the notification and on a Wear OS watch. On iPhone, add the schedule to your calendar."
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={CalendarPlus} loading={busy} onClick={async () => {
        setBusy(true); setErr(undefined);
        try { const { blob, filename, count } = await medicationService.calendarFile(); downloadBlob(blob, filename); toast(`${count} reminder${count > 1 ? 's' : ''} saved to ${filename}`); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
      }}>Download calendar file</Button></>}>
      <div className="stack">
        <a className="btn btn-secondary" href={brand.androidAppUrl}><Smartphone aria-hidden />Download the Android app</a>
        <p className="xs subtle">Open the file on your Android phone and allow installing from this source when asked.</p>
        <div className="xs subtle strong">OR USE YOUR CALENDAR</div>
        <ol className="small stack" style={{ '--gap': '8px', paddingLeft: 18, margin: 0 } as React.CSSProperties}>
          <li>Download the calendar file (.ics).</li>
          <li>Open it on your phone, or import it into Google Calendar, Apple Calendar or Outlook.</li>
          <li>Make sure calendar notifications are mirrored to your watch in the watch’s companion app.</li>
        </ol>
        <p className="xs subtle">If you change reminder times or a doctor adds a new prescription, download the file again.</p>
        <InlineError message={err} />
      </div>
    </Modal>
  );
}

export function AllergiesPage() {
  useDocumentTitle(`Allergies · ${brand.name}`);
  const ui = usePatientUI();
  const records = useLive(() => recordService.list(), []);
  const allergies = useMemo(() => (records.data ?? []).filter((r) => r.type === 'allergy').sort((a, b) => (ALLERGY_SEVERITY_RANK[String(b.data.severity)] ?? 0) - (ALLERGY_SEVERITY_RANK[String(a.data.severity)] ?? 0)), [records.data]);
  const severe = allergies.filter(isSevereAllergy);
  return (
    <>
      <div className="page-head">
        <div><h1>Allergies</h1><p>Shown at the top of your record for every doctor with access, and on your <Link to="/app/emergency">emergency card</Link>.</p></div>
        <Button variant="primary" icon={Plus} onClick={() => ui.addRecord('allergy')}>Add allergy</Button>
      </div>
      {records.error ? <ErrorState error={records.error} onRetry={records.reload} /> : !records.data ? <SkeletonList rows={3} /> : allergies.length === 0 ? (
        <div className="card"><EmptyState icon={TriangleAlert} title="No allergies recorded" body="If you have any allergies — to medicines, foods or anything else — add them so doctors always see them." action={<Button variant="primary" icon={Plus} onClick={() => ui.addRecord('allergy')}>Add allergy</Button>} /></div>
      ) : (
        <>
          {severe.length > 0 && (
            <div className="alert alert-danger" role="alert">
              <TriangleAlert aria-hidden />
              <div><div className="alert-title">{severe.length} severe {severe.length === 1 ? 'allergy' : 'allergies'}</div>{severe.map((a) => `${a.data.allergen} (${a.data.reaction})`).join(' · ')}</div>
            </div>
          )}
          <Card>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Allergen</th><th>Reaction</th><th>Severity</th><th>Identified</th><th className="desktop-only">Notes</th></tr></thead>
                <tbody>
                  {allergies.map((a) => (
                    <tr key={a.id}>
                      <td><button className="rec-open" onClick={() => ui.openRecord(a.id)}>{String(a.data.allergen)}</button></td>
                      <td>{String(a.data.reaction ?? '—')}</td>
                      <td><StatusBadge record={a} /></td>
                      <td className="nowrap num">{fmtDate(a.date)}</td>
                      <td className="desktop-only muted">{String(a.data.notes ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
