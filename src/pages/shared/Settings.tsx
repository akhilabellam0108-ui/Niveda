import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams, Link } from 'react-router-dom';
import { BellRing, Camera, Copy, UserRound, LockKeyhole, ShieldCheck, Bell, Palette, Languages, Download, LifeBuoy, LogOut, FlaskConical, FileJson, FileText, CheckCircle2, RotateCcw } from 'lucide-react';
import type { Preferences } from '../../types';
import { exportService, patientService, resetDemoData, settingsService, EXPORT_SCOPES, friendlyError } from '../../services';
import { useSession, applyTheme } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { useDocumentTitle } from '../../state/hooks';
import { brand } from '../../config/brand';
import { ageFrom, fmtDate } from '../../lib/dates';
import { Avatar, Button, Card, ConfirmDialog, Field, InlineError, Input, Select, Skeleton } from '../../components/ui';
import { downloadBlob } from '../../components/documents/DocumentViewer';
import { BLOOD_GROUPS, readImage } from '../auth/Onboarding';
import { NotificationPrompt } from '../patient/Medications';
import { testAlarm } from '../../components/medications/Doses';
import { isLive } from '../../config/backend';

/* ---------------- Profile ---------------- */

export function ProfilePage() {
  useDocumentTitle(`Profile · ${brand.name}`);
  const { patient } = useSession();
  const toast = useToast();
  const [f, setF] = useState({ fullName: '', dateOfBirth: '', sex: '', phone: '', email: '', bloodGroup: '', ecName: '', ecRel: '', ecPhone: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    if (patient) setF({ fullName: patient.fullName, dateOfBirth: patient.dateOfBirth, sex: patient.sex ?? '', phone: patient.phone, email: patient.email, bloodGroup: patient.bloodGroup ?? '', ecName: patient.emergencyContact?.name ?? '', ecRel: patient.emergencyContact?.relationship ?? '', ecPhone: patient.emergencyContact?.phone ?? '' });
  }, [patient]);
  if (!patient) return <Skeleton h={400} />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(undefined);
    try {
      await patientService.updateProfile({
        fullName: f.fullName, dateOfBirth: f.dateOfBirth, sex: f.sex as 'female' | 'male' | 'other' | '', phone: f.phone, email: f.email, bloodGroup: f.bloodGroup || undefined,
        emergencyContact: { name: f.ecName, relationship: f.ecRel, phone: f.ecPhone },
      });
      toast('Profile saved');
    } catch (x) { setErr(friendlyError(x)); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Profile</h1><p>Your personal details. Doctors with access see your name, age and blood group.</p></div></div>
      <section className="card card-pad row" style={{ '--gap': '18px', flexWrap: 'wrap' } as React.CSSProperties}>
        <Avatar name={patient.fullName} src={patient.photoDataUrl} size="xl" />
        <div className="grow">
          <h2 className="display" style={{ fontSize: 26 }}>{patient.fullName}</h2>
          <div className="small muted">{ageFrom(patient.dateOfBirth)} years · born {fmtDate(patient.dateOfBirth)} · member since {fmtDate(patient.createdAt)}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <span className="small">Patient ID <b className="num">{patient.patientCode}</b></span>
            <Button size="sm" variant="ghost" icon={Copy} onClick={() => { void navigator.clipboard?.writeText(patient.patientCode); toast('Patient ID copied'); }}>Copy</Button>
          </div>
        </div>
        <label className="btn btn-secondary">
          <Camera aria-hidden />Change photo
          <input type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { await patientService.updateProfile({ photoDataUrl: await readImage(file) }); toast('Photo updated'); } catch { toast('That image couldn’t be used.', 'error'); } }} />
        </label>
      </section>
      <form className="card card-pad stack" onSubmit={save}>
        <h2 style={{ fontSize: 'var(--t-md)' }}>Personal details</h2>
        <div className="form-grid">
          <Field label="Full name" required>{(p) => <Input {...p} value={f.fullName} onChange={set('fullName')} />}</Field>
          <Field label="Date of birth" required>{(p) => <Input {...p} type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} />}</Field>
          <Field label="Sex">{(p) => <Select {...p} value={f.sex} onChange={set('sex')} placeholder="Prefer not to say" options={[{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' }]} />}</Field>
          <Field label="Blood group">{(p) => <Select {...p} value={f.bloodGroup} onChange={set('bloodGroup')} placeholder="Unknown" options={BLOOD_GROUPS} />}</Field>
          <Field label="Mobile number" help="Used for one-time codes.">{(p) => <Input {...p} type="tel" value={f.phone} onChange={set('phone')} />}</Field>
          <Field label="Email">{(p) => <Input {...p} type="email" value={f.email} onChange={set('email')} />}</Field>
        </div>
        <h2 style={{ fontSize: 'var(--t-md)', marginTop: 8 }}>Emergency contact</h2>
        <div className="form-grid">
          <Field label="Name" required className="wide">{(p) => <Input {...p} value={f.ecName} onChange={set('ecName')} />}</Field>
          <Field label="Relationship" required>{(p) => <Input {...p} value={f.ecRel} onChange={set('ecRel')} />}</Field>
          <Field label="Phone" required>{(p) => <Input {...p} type="tel" value={f.ecPhone} onChange={set('ecPhone')} />}</Field>
        </div>
        <InlineError message={err} />
        <div><Button type="submit" variant="primary" loading={busy}>Save changes</Button></div>
      </form>
    </>
  );
}

/* ---------------- Settings ---------------- */

const SECTIONS = [
  { key: 'account', label: 'Account', icon: UserRound },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'language', label: 'Language', icon: Languages },
  { key: 'export', label: 'Data & export', icon: Download },
  { key: 'help', label: 'Help & support', icon: LifeBuoy },
];

export function SettingsPage({ base = '/app/settings', role = 'patient' }: { base?: string; role?: 'patient' | 'doctor' }) {
  useDocumentTitle(`Settings · ${brand.name}`);
  const { section = 'account' } = useParams();
  const { signOut, prefs, user } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const sections = SECTIONS.filter((s) => role === 'patient' || s.key !== 'export');
  const setPref = async (p: Partial<Preferences>) => {
    try { const next = await settingsService.update(p); if (p.theme) applyTheme(next.theme); toast('Saved'); } catch (e) { toast(friendlyError(e), 'error'); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Settings</h1></div></div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map((s) => <NavLink key={s.key} to={`${base}/${s.key}`} className={() => `nav-link ${section === s.key ? 'active' : ''}`}><s.icon aria-hidden />{s.label}</NavLink>)}
          <button className="nav-link" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={async () => { await signOut(); navigate('/login'); }}><LogOut aria-hidden />Log out</button>
        </nav>
        <div className="stack">
          {section === 'account' && (
            <Card title="Account">
              <ul className="list">
                <li className="list-item"><div className="grow"><div className="small strong">Email</div><div className="xs muted">{user?.email}</div></div><Link className="btn btn-sm btn-secondary" to={role === 'patient' ? '/app/profile' : '/doctor/profile'}>Edit profile</Link></li>
                <li className="list-item"><div className="grow"><div className="small strong">Privacy & security</div><div className="xs muted">Access, devices, password and one-time codes</div></div><Link className="btn btn-sm btn-secondary" to={role === 'patient' ? '/app/privacy' : '/doctor/security'}><LockKeyhole aria-hidden />Open</Link></li>
                {role === 'patient' && <li className="list-item"><div className="grow"><div className="small strong">Doctors & access</div><div className="xs muted">Grant, change or revoke access</div></div><Link className="btn btn-sm btn-secondary" to="/app/access"><ShieldCheck aria-hidden />Open</Link></li>}
                <li className="list-item"><div className="grow"><div className="small strong">Close account</div><div className="xs muted">Needs identity checks and a retention policy — available once a real backend exists.</div></div><Button size="sm" disabled>Unavailable in prototype</Button></li>
              </ul>
            </Card>
          )}
          {section === 'notifications' && role === 'patient' && (
            <Card title="Medicine reminders" pad>
              <div className="stack">
                <NotificationPrompt />
                <label className="check"><input type="checkbox" checked={prefs.medAlarms} onChange={(e) => setPref({ medAlarms: e.target.checked })} /><span><span className="strong">Remind me when a dose is due</span><br /><span className="xs muted">Opens a reminder with Taken, Skip and Snooze while {brand.name} is open, and a system notification if allowed</span></span></label>
                <label className="check"><input type="checkbox" checked={prefs.medAlarmSound} disabled={!prefs.medAlarms} onChange={(e) => setPref({ medAlarmSound: e.target.checked })} /><span><span className="strong">Play a sound</span></span></label>
                <div className="row-wrap">
                  <Button size="sm" icon={BellRing} onClick={() => testAlarm(prefs.medAlarmSound)}>Test reminder</Button>
                  <Link className="btn btn-sm btn-ghost" to="/app/medications">Set times for each medicine</Link>
                </div>
                <p className="xs subtle">A web page can only ring while it’s open. For reminders when the app is closed, add your schedule to your phone’s calendar from Medications → Phone & smartwatch.</p>
              </div>
            </Card>
          )}
          {section === 'notifications' && (
            <Card title="Notifications" pad>
              <div className="stack">
                {([['notifyRecords', 'New entries in my record', 'When a doctor adds or corrects something'], ['notifyAccess', 'Access changes', 'Requests, grants, revocations and expiry'], ['notifyReminders', 'Reminders', 'e.g. a doctor’s access ends within 24 hours']] as const).map(([k, l, d]) => (
                  <label key={k} className="check"><input type="checkbox" checked={prefs[k]} onChange={(e) => setPref({ [k]: e.target.checked })} /><span><span className="strong">{l}</span><br /><span className="xs muted">{d}</span></span></label>
                ))}
                <p className="xs subtle">Security alerts (new sign-ins, password changes) are always on. Push and SMS delivery need the mobile app and a messaging provider — not included in this prototype.</p>
              </div>
            </Card>
          )}
          {section === 'appearance' && (
            <Card title="Appearance" pad>
              <div className="segmented" role="group" aria-label="Theme">
                {(['system', 'light', 'dark'] as const).map((t) => <button key={t} aria-pressed={prefs.theme === t} onClick={() => setPref({ theme: t })}>{t[0].toUpperCase() + t.slice(1)}</button>)}
              </div>
            </Card>
          )}
          {section === 'language' && (
            <Card title="Language" pad>
              <div className="stack">
                <Field label="App language">{(p) => <Select {...p} value="en" onChange={() => undefined} options={[{ value: 'en', label: 'English' }]} />}</Field>
                <p className="xs subtle">Hindi, Telugu, Tamil and more are planned. Translating medical terms needs clinical review, so they aren’t in this prototype.</p>
              </div>
            </Card>
          )}
          {section === 'export' && role === 'patient' && <ExportPanel />}
          {section === 'help' && (
            <Card title="Help & support" pad>
              <div className="stack">
                <p className="small">Questions about your record or privacy? Email <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a> (placeholder address).</p>
                <p className="small muted">To report a wrong entry added by a doctor, ask them to correct it — corrections keep the original visible in the history.</p>
                {!isLive && <div className="alert alert-warn"><FlaskConical aria-hidden /><div><div className="alert-title">Demo tools</div>Reset the prototype to its original demo data. This clears everything created in this browser.</div></div>}
                {!isLive && <div><Button variant="danger-ghost" icon={RotateCcw} onClick={() => setResetOpen(true)}>Reset demo data</Button></div>}
              </div>
            </Card>
          )}
        </div>
      </div>
      <ConfirmDialog open={resetOpen} onClose={() => setResetOpen(false)} danger confirmLabel="Reset and sign out" title="Reset demo data?"
        body="All accounts, records, documents and logs created in this browser will be replaced with the original demo data."
        onConfirm={async () => { await resetDemoData(); await signOut(); navigate('/login'); }} />
    </>
  );
}

function ExportPanel() {
  const toast = useToast();
  const [scopes, setScopes] = useState<string[]>(['all']);
  const [format, setFormat] = useState<'html' | 'json'>('html');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  const [err, setErr] = useState<string>();
  const toggle = (k: string) => {
    if (k === 'all') return setScopes(['all']);
    const next = scopes.filter((s) => s !== 'all');
    setScopes(next.includes(k) ? next.filter((s) => s !== k) : [...next, k]);
  };
  const run = async () => {
    setBusy(true); setErr(undefined); setDone(undefined);
    try {
      const { blob, filename, count } = await exportService.build(scopes, format);
      downloadBlob(blob, filename);
      setDone(`${filename} · ${count} items`);
      toast('Export ready');
    } catch (e) { setErr(friendlyError(e, 'The export couldn’t be created. Please try again.')); } finally { setBusy(false); }
  };
  return (
    <Card title="Export my medical records" pad>
      <div className="stack">
        <p className="small muted">Download a copy of your record to keep or share. Exports are logged in your access log.</p>
        <div className="choice-grid">
          {EXPORT_SCOPES.map((s) => (
            <button key={s.key} className="choice" role="checkbox" aria-checked={scopes.includes(s.key)} onClick={() => toggle(s.key)}><span className="choice-title">{s.label}</span></button>
          ))}
        </div>
        <div className="xs subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>Format</div>
        <div className="grid-2">
          <button className="choice" aria-pressed={format === 'html'} onClick={() => setFormat('html')}><span className="choice-title"><FileText aria-hidden />Readable summary</span><span className="choice-sub">Opens in a browser; print it to save as PDF</span></button>
          <button className="choice" aria-pressed={format === 'json'} onClick={() => setFormat('json')}><span className="choice-title"><FileJson aria-hidden />Data file (JSON)</span><span className="choice-sub">Machine-readable, includes full version history</span></button>
        </div>
        <InlineError message={err} />
        {done && <div className="alert alert-ok"><CheckCircle2 aria-hidden /><div>Downloaded {done}</div></div>}
        <div><Button variant="primary" icon={Download} loading={busy} disabled={!scopes.length} onClick={run}>Export</Button></div>
        <p className="xs subtle">{isLive ? 'The file is built on this device from your record. It lists your documents; download each file from Reports.' : 'Prototype: the file is built in your browser. In production, exports would be prepared on a server (including original document files and a FHIR format) and delivered through a secure, expiring link.'}</p>
      </div>
    </Card>
  );
}
