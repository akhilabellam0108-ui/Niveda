import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { UserSearch, Users, ArrowRight, Hourglass, FilePlus2, ScrollText, ScanLine, Send, CheckCircle2, Building2, BadgeCheck, Phone, Mail, KeyRound } from 'lucide-react';
import type { PermissionKey } from '../../types';
import { accessService, auditService, doctorService, durationLabel, friendlyError, maskName } from '../../services';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useSession } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { brand } from '../../config/brand';
import { ageFrom, fmtDate, relativeTime, timeLeft, now } from '../../lib/dates';
import { DEFAULT_PERMISSIONS, RECORD_TYPES, recordTitle } from '../../lib/recordMeta';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, InlineError, Input, SkeletonList, Tabs, Textarea } from '../../components/ui';
import { DurationPicker, PermissionBadges, PermissionSelector } from '../../components/access/PermissionSelector';
import { QrCode, QrScanner } from '../../components/access/Qr';
import { TypeIcon } from '../../components/records/RecordCard';
import { AuditRow, groupByDay } from '../patient/Activity';

/* ---------------- Dashboard ---------------- */

export function DoctorHome() {
  useDocumentTitle(`Dashboard · ${brand.name}`);
  const { doctor } = useSession();
  const navigate = useNavigate();
  const access = useLive(() => accessService.listForDoctor(), []);
  const entries = useLive(() => doctorService.myRecentEntries(), []);
  const activity = useLive(() => auditService.forDoctor(), []);
  const [code, setCode] = useState('');
  if (!doctor) return null;
  const h = now().getHours();
  const today = access.data?.active.filter((g) => now().getTime() - new Date(g.grantedAt).getTime() < 24 * 3600000) ?? [];

  return (
    <>
      <section className="hello">
        <div>
          <p className="small muted">{h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'},</p>
          <h1>{doctor.fullName}</h1>
          <div className="id-strip"><span>{doctor.specialization}</span><span><Building2 aria-hidden />{doctor.hospital?.name}</span><span><BadgeCheck aria-hidden />Reg. <b>{doctor.registrationNumber}</b></span></div>
        </div>
      </section>

      <form className="card card-pad row" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); if (code.trim()) navigate(`/doctor/find?id=${encodeURIComponent(code.trim())}`); }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <label className="field-label" htmlFor="quick-id">Quick search</label>
          <div className="input-wrap" style={{ marginTop: 6 }}><UserSearch aria-hidden /><Input id="quick-id" placeholder="Patient ID, e.g. NV-4821-7730" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
        </div>
        <div className="row" style={{ alignSelf: 'flex-end' }}>
          <Button type="submit" variant="primary" disabled={!code.trim()}>Find</Button>
          <Button icon={ScanLine} onClick={() => navigate('/doctor/find?scan=1')}>Scan QR</Button>
        </div>
      </form>

      <section className="card"><div className="stats-row">
        {[['Patients you can see', access.data?.active.length], ['Shared today', today.length], ['Awaiting patient', access.data?.requests.length], ['Entries you’ve added', entries.data?.length]].map(([l, v]) => (
          <div key={l as string} className="stat"><span className="stat-value">{v ?? '–'}</span><span className="stat-label">{l}</span></div>
        ))}
      </div></section>

      <div className="dash-grid">
        <div className="stack">
          <Card title="Patients with active access" action={<Link className="card-link" to="/doctor/patients">All <ArrowRight aria-hidden /></Link>}>
            {access.error ? <ErrorState error={access.error} onRetry={access.reload} /> : !access.data ? <SkeletonList rows={3} card={false} /> : access.data.active.length === 0 ? (
              <EmptyState icon={Users} title="No patients have shared their record with you" body="Ask your patient to grant access using your code, or look them up by patient ID to send a request." action={<Button icon={UserSearch} onClick={() => navigate('/doctor/find')}>Find a patient</Button>} />
            ) : (
              <ul className="list">
                {access.data.active.map((g) => (
                  <li key={g.id}>
                    <button className="list-item clickable" onClick={() => navigate(`/doctor/patients/${g.patient.id}`)}>
                      <Avatar name={g.patient.fullName} size="sm" />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="strong" style={{ display: 'block' }}>{g.patient.fullName}</span>
                        <span className="xs muted">{ageFrom(g.patient.dateOfBirth)} yrs · {g.patient.bloodGroup ?? '—'} · {g.patient.patientCode}</span>
                      </span>
                      {now().getTime() - new Date(g.grantedAt).getTime() < 24 * 3600000 && <Badge tone="accent">Today</Badge>}
                      <Badge tone={accessService.hoursLeft(g) < 24 ? 'warn' : 'ok'} dot>{timeLeft(g.expiresAt)}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Your recent entries">
            {!entries.data ? <SkeletonList rows={3} card={false} /> : entries.data.length === 0 ? <EmptyState compact icon={FilePlus2} title="No entries yet" body="Consultations and notes you add to patients’ records appear here." /> : (
              <ul className="list">
                {entries.data.map((r) => (
                  <li key={r.id} className="list-item">
                    <TypeIcon type={r.type} size="sm" />
                    <div className="grow" style={{ minWidth: 0 }}><div className="strong small truncate">{recordTitle(r)}</div><div className="xs muted">{RECORD_TYPES[r.type].label} · {r.patientName} · {fmtDate(r.date)}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="stack">
          <Card title="Waiting for the patient">
            {!access.data ? <SkeletonList rows={1} card={false} /> : access.data.requests.length === 0 ? <EmptyState compact icon={Hourglass} title="No pending requests" /> : (
              <ul className="list">
                {access.data.requests.map((r) => (
                  <li key={r.id} className="list-item">
                    <span className="type-icon sm tone-info"><Hourglass aria-hidden /></span>
                    <div className="grow"><div className="strong small">{r.patientName}</div><div className="xs muted">{r.patientCode} · sent {relativeTime(r.createdAt)} · {durationLabel(r.durationHours)}</div></div>
                    <Button size="sm" variant="ghost" onClick={() => accessService.cancelRequest(r.id)}>Cancel</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Your access code">
            <div className="card-body stack" style={{ alignItems: 'center', '--gap': '10px' } as React.CSSProperties}>
              <QrCode value={`niveda://doctor?code=${doctor.accessCode}`} size={132} label={`QR for access code ${doctor.accessCode}`} />
              <div className="num strong" style={{ fontSize: 20, letterSpacing: '.1em' }}>{doctor.accessCode}</div>
              <p className="xs muted" style={{ textAlign: 'center' }}>Patients scan this or type the code to grant you access. It doesn’t give you access by itself.</p>
            </div>
          </Card>
          <Card title="Recent activity" action={<Link className="card-link" to="/doctor/activity">All <ArrowRight aria-hidden /></Link>}>
            {!activity.data ? <SkeletonList rows={3} card={false} /> : activity.data.length === 0 ? <EmptyState compact icon={ScrollText} title="No activity yet" /> : (
              <ul className="list">{activity.data.slice(0, 5).map((a) => <li key={a.id}><AuditRow a={a} showPatient /></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/* ---------------- My patients ---------------- */

export function DoctorPatients() {
  useDocumentTitle(`My patients · ${brand.name}`);
  const navigate = useNavigate();
  const access = useLive(() => accessService.listForDoctor(), []);
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const list = tab === 'active' ? access.data?.active : access.data?.past;
  return (
    <>
      <div className="page-head">
        <div><h1>My patients</h1><p>Patients who have shared their record with you. Access is time-limited and set by each patient.</p></div>
        <Button variant="primary" icon={UserSearch} onClick={() => navigate('/doctor/find')}>Find a patient</Button>
      </div>
      <Tabs label="Patients" value={tab} onChange={setTab} tabs={[{ value: 'active', label: 'Active access', count: access.data?.active.length }, { value: 'past', label: 'Access ended', count: access.data?.past.length }]} />
      {access.error ? <ErrorState error={access.error} onRetry={access.reload} /> : !list ? <SkeletonList rows={3} /> : list.length === 0 ? (
        <div className="card"><EmptyState icon={Users} title={tab === 'active' ? 'No active access' : 'Nothing here'} body={tab === 'active' ? 'When a patient grants you access, they’ll appear here.' : 'Patients whose access ended or was revoked appear here. You can’t see their records.'} /></div>
      ) : (
        <div className="grid-2">
          {list.map((g) => (
            <section key={g.id} className="card access-card">
              <div className="access-top">
                <Avatar name={tab === 'active' ? g.patient.fullName : maskName(g.patient.fullName)} />
                <div className="grow">
                  <div className="strong">{tab === 'active' ? g.patient.fullName : maskName(g.patient.fullName)}</div>
                  <div className="xs muted">{g.patient.patientCode}{tab === 'active' ? ` · ${ageFrom(g.patient.dateOfBirth)} yrs · ${g.patient.bloodGroup ?? '—'}` : ''}</div>
                </div>
                {tab === 'active' ? <Badge tone="ok" dot>{timeLeft(g.expiresAt)}</Badge> : <Badge tone={g.status === 'revoked' ? 'danger' : undefined}>{g.status === 'revoked' ? 'Revoked' : 'Expired'}</Badge>}
              </div>
              <PermissionBadges value={g.permissions} max={4} />
              {tab === 'active' ? (
                <div className="row"><Button variant="primary" onClick={() => navigate(`/doctor/patients/${g.patient.id}`)}>Open record</Button><Button icon={FilePlus2} onClick={() => navigate(`/doctor/patients/${g.patient.id}/add`)}>Add entry</Button></div>
              ) : (
                <div className="row"><Button icon={Send} onClick={() => navigate(`/doctor/find?id=${g.patient.patientCode}`)}>Request access again</Button></div>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- Find a patient ---------------- */

export function FindPatient() {
  useDocumentTitle(`Find a patient · ${brand.name}`);
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('id') ?? '');
  const [scan, setScan] = useState(params.get('scan') === '1');
  const [result, setResult] = useState<Awaited<ReturnType<typeof accessService.lookupPatient>>>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [perms, setPerms] = useState<PermissionKey[]>(DEFAULT_PERMISSIONS);
  const [hours, setHours] = useState(24);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);

  const lookup = async (c = code) => {
    setBusy(true); setErr(undefined); setResult(undefined); setSent(false);
    try { setResult(await accessService.lookupPatient(c)); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  useEffect(() => { const id = params.get('id'); if (id) void lookup(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const request = async () => {
    if (!result) return;
    setBusy(true); setErr(undefined);
    try { await accessService.requestAccess(result.patientId, perms, hours, reason); setSent(true); toast('Request sent to the patient'); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Find a patient</h1><p>Use the patient ID or QR code the patient shows you. You’ll only see their record after they approve.</p></div></div>
      <section className="card card-pad stack">
        <form className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
          <Field label="Patient ID" className="grow" help="Demo IDs: NV-4821-7730 (Meera Iyer), NV-9264-1183 (Fatima Khan)">
            {(p) => <Input {...p} placeholder="NV-0000-0000" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />}
          </Field>
          <Button type="submit" variant="primary" loading={busy && !result} disabled={code.trim().length < 6}>Look up</Button>
          <Button icon={ScanLine} onClick={() => setScan((s) => !s)} aria-pressed={scan}>Scan QR</Button>
        </form>
        {scan && <QrScanner onResult={(t) => { setScan(false); setCode(t.toUpperCase()); void lookup(t); }} />}
        <InlineError message={err} />
      </section>

      {result && (
        <section className="card card-pad stack">
          <div className="row">
            <Avatar name={result.maskedName} />
            <div className="grow"><div className="strong">{result.maskedName}</div><div className="xs muted num">{result.patientCode}</div></div>
            {result.status === 'active' ? <Badge tone="ok" dot>You have access</Badge> : result.status === 'pending' ? <Badge tone="info" dot>Request pending</Badge> : <Badge>No access</Badge>}
          </div>
          {result.status === 'active' ? (
            <Button variant="primary" onClick={() => navigate(`/doctor/patients/${result.patientId}`)}>Open record</Button>
          ) : result.status === 'pending' || sent ? (
            <div className="alert alert-info"><Hourglass aria-hidden /><div>Waiting for the patient to approve. They’ll get a notification and must confirm with a one-time code. You’ll be notified when they respond.</div></div>
          ) : (
            <div className="stack">
              <div className="alert alert-accent"><KeyRound aria-hidden /><div>The name is hidden until the patient approves. Ask them to check the request on their phone — or to grant access using your code.</div></div>
              <h2 style={{ fontSize: 'var(--t-md)' }}>Request access</h2>
              <Field label="Reason (shown to the patient)" required>{(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Consultation today for chest pain" />}</Field>
              <div className="grid-2" style={{ alignItems: 'start' }}>
                <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}><span className="field-label">What you need</span><PermissionSelector value={perms} onChange={setPerms} /></div>
                <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}><span className="field-label">For how long</span><DurationPicker hours={hours} onChange={setHours} /></div>
              </div>
              <div><Button variant="primary" icon={Send} loading={busy} disabled={!reason.trim() || !perms.length} onClick={request}>Send request</Button></div>
            </div>
          )}
          {sent && <div className="alert alert-ok"><CheckCircle2 aria-hidden /><div>Request sent.</div></div>}
        </section>
      )}
    </>
  );
}

/* ---------------- Activity ---------------- */

export function DoctorActivity() {
  useDocumentTitle(`My activity · ${brand.name}`);
  const log = useLive(() => auditService.forDoctor(), []);
  return (
    <>
      <div className="page-head"><div><h1>My activity</h1><p>Everything you’ve viewed or added. Patients see the same entries in their access logs.</p></div></div>
      {log.error ? <ErrorState error={log.error} onRetry={log.reload} /> : !log.data ? <SkeletonList rows={5} /> : log.data.length === 0 ? (
        <div className="card"><EmptyState icon={ScrollText} title="No activity yet" /></div>
      ) : groupByDay(log.data).map(([day, list]) => (
        <Card key={day} title={<span className="small">{day}</span>}><ul className="list">{list.map((a) => <li key={a.id}><AuditRow a={a} showPatient /></li>)}</ul></Card>
      ))}
    </>
  );
}

/* ---------------- Profile ---------------- */

export function DoctorProfile() {
  useDocumentTitle(`Profile · ${brand.name}`);
  const { doctor } = useSession();
  const toast = useToast();
  const [phone, setPhone] = useState(doctor?.phone ?? '');
  const [quals, setQuals] = useState(doctor?.qualifications ?? '');
  const [busy, setBusy] = useState(false);
  if (!doctor) return null;
  return (
    <>
      <div className="page-head"><div><h1>Profile</h1><p>Your professional details as patients see them when granting access.</p></div></div>
      <section className="card card-pad row" style={{ '--gap': '18px', flexWrap: 'wrap' } as React.CSSProperties}>
        <Avatar name={doctor.fullName} size="xl" doctor />
        <div className="grow">
          <h2 className="display" style={{ fontSize: 26 }}>{doctor.fullName}</h2>
          <div className="small muted">{doctor.specialization} · {doctor.hospital?.name}, {doctor.hospital?.city}</div>
          <div className="row-wrap" style={{ marginTop: 8 }}><Badge tone="ok" icon={BadgeCheck}>Registration verified</Badge><Badge>{doctor.yearsOfPractice} years in practice</Badge></div>
        </div>
      </section>
      <Card title="Professional details" pad>
        <div className="stack">
          <dl className="kv">
            <dt>Medical registration</dt><dd className="num">{doctor.registrationNumber}</dd>
            <dt>Hospital</dt><dd>{doctor.hospital?.name}</dd>
            <dt>Specialisation</dt><dd>{doctor.specialization}</dd>
            <dt>Email</dt><dd><Mail size={13} aria-hidden style={{ verticalAlign: -2 }} /> {doctor.email}</dd>
          </dl>
          <p className="xs subtle">Registration number, name and hospital are verified by your organisation and can’t be edited here.</p>
          <div className="form-grid">
            <Field label="Contact phone">{(p) => <div className="input-wrap"><Phone aria-hidden /><Input {...p} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>}</Field>
            <Field label="Qualifications">{(p) => <Input {...p} value={quals} onChange={(e) => setQuals(e.target.value)} />}</Field>
          </div>
          <div><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await doctorService.updateProfile({ phone, qualifications: quals }); toast('Profile saved'); } catch (e) { toast(friendlyError(e), 'error'); } finally { setBusy(false); } }}>Save</Button></div>
        </div>
      </Card>
    </>
  );
}

