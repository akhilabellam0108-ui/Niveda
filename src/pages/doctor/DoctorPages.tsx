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
import { EmergencyAccessPanel } from '../../components/access/EmergencyAccess';

import { t } from '../../i18n';
/* ---------------- Dashboard ---------------- */

export function DoctorHome() {
  useDocumentTitle(`${t('Dashboard')} · ${brand.name}`);
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
          <p className="small muted">{h < 12 ? t('Good morning') : h < 17 ? t('Good afternoon') : t('Good evening')},</p>
          <h1>{doctor.fullName}</h1>
          <div className="id-strip"><span>{doctor.specialization}</span><span><Building2 aria-hidden />{doctor.hospital?.name}</span><span><BadgeCheck aria-hidden />{t('Reg.')}{' '}<b>{doctor.registrationNumber}</b></span></div>
        </div>
      </section>

      <form className="card card-pad row" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); if (code.trim()) navigate(`/doctor/find?id=${encodeURIComponent(code.trim())}`); }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <label className="field-label" htmlFor="quick-id">{t('Quick search')}</label>
          <div className="input-wrap" style={{ marginTop: 6 }}><UserSearch aria-hidden /><Input id="quick-id" placeholder={t('Patient ID, e.g. NV-4821-7730')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
        </div>
        <div className="row" style={{ alignSelf: 'flex-end' }}>
          <Button type="submit" variant="primary" disabled={!code.trim()}>{t('Find')}</Button>
          <Button icon={ScanLine} onClick={() => navigate('/doctor/find?scan=1')}>{t('Scan QR')}</Button>
        </div>
      </form>

      <section className="card"><div className="stats-row">
        {[[t('Patients you can see'), access.data?.active.length], [t('Shared today'), today.length], [t('Awaiting patient'), access.data?.requests.length], [t('Entries you’ve added'), entries.data?.length]].map(([l, v]) => (
          <div key={l as string} className="stat"><span className="stat-value">{v ?? '–'}</span><span className="stat-label">{l}</span></div>
        ))}
      </div></section>

      <div className="dash-grid">
        <div className="stack">
          <Card title={t('Patients with active access')} action={<Link className="card-link" to="/doctor/patients">{t('All')}{' '}<ArrowRight aria-hidden /></Link>}>
            {access.error ? <ErrorState error={access.error} onRetry={access.reload} /> : !access.data ? <SkeletonList rows={3} card={false} /> : access.data.active.length === 0 ? (
              <EmptyState icon={Users} title={t('No patients have shared their record with you')} body={t('Ask your patient to grant access using your code, or look them up by patient ID to send a request.')} action={<Button icon={UserSearch} onClick={() => navigate('/doctor/find')}>{t('Find a patient')}</Button>} />
            ) : (
              <ul className="list">
                {access.data.active.map((g) => (
                  <li key={g.id}>
                    <button className="list-item clickable" onClick={() => navigate(`/doctor/patients/${g.patient.id}`)}>
                      <Avatar name={g.patient.fullName} size="sm" />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="strong" style={{ display: 'block' }}>{g.patient.fullName}</span>
                        <span className="xs muted">{t('{n} yrs', { n: ageFrom(g.patient.dateOfBirth) })} · {g.patient.bloodGroup ?? '—'} · {g.patient.patientCode}</span>
                      </span>
                      {now().getTime() - new Date(g.grantedAt).getTime() < 24 * 3600000 && <Badge tone="accent">{t('Today')}</Badge>}
                      <Badge tone={accessService.hoursLeft(g) < 24 ? 'warn' : 'ok'} dot>{timeLeft(g.expiresAt)}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('Your recent entries')}>
            {!entries.data ? <SkeletonList rows={3} card={false} /> : entries.data.length === 0 ? <EmptyState compact icon={FilePlus2} title={t('No entries yet')} body={t('Consultations and notes you add to patients’ records appear here.')} /> : (
              <ul className="list">
                {entries.data.map((r) => (
                  <li key={r.id} className="list-item">
                    <TypeIcon type={r.type} size="sm" />
                    <div className="grow" style={{ minWidth: 0 }}><div className="strong small truncate">{recordTitle(r)}</div><div className="xs muted">{t(RECORD_TYPES[r.type].label)} · {r.patientName} · {fmtDate(r.date)}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="stack">
          <Card title={t('Waiting for the patient')}>
            {!access.data ? <SkeletonList rows={1} card={false} /> : access.data.requests.length === 0 ? <EmptyState compact icon={Hourglass} title={t('No pending requests')} /> : (
              <ul className="list">
                {access.data.requests.map((r) => (
                  <li key={r.id} className="list-item">
                    <span className="type-icon sm tone-info"><Hourglass aria-hidden /></span>
                    <div className="grow"><div className="strong small">{r.patientName}</div><div className="xs muted">{r.patientCode} · {t('sent {time}', { time: relativeTime(r.createdAt) })} · {durationLabel(r.durationHours)}</div></div>
                    <Button size="sm" variant="ghost" onClick={() => accessService.cancelRequest(r.id)}>{t('Cancel')}</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('Your access code')}>
            <div className="card-body stack" style={{ alignItems: 'center', '--gap': '10px' } as React.CSSProperties}>
              <QrCode value={`niveda://doctor?code=${doctor.accessCode}`} size={132} label={t('QR for access code {accessCode}', { accessCode: doctor.accessCode })} />
              <div className="num strong" style={{ fontSize: 20, letterSpacing: '.1em' }}>{doctor.accessCode}</div>
              <p className="xs muted" style={{ textAlign: 'center' }}>{t('Patients scan this or type the code to grant you access. It doesn’t give you access by itself.')}</p>
            </div>
          </Card>
          <Card title={t('Recent activity')} action={<Link className="card-link" to="/doctor/activity">{t('All')}{' '}<ArrowRight aria-hidden /></Link>}>
            {!activity.data ? <SkeletonList rows={3} card={false} /> : activity.data.length === 0 ? <EmptyState compact icon={ScrollText} title={t('No activity yet')} /> : (
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
  useDocumentTitle(`${t('My patients')} · ${brand.name}`);
  const navigate = useNavigate();
  const access = useLive(() => accessService.listForDoctor(), []);
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const list = tab === 'active' ? access.data?.active : access.data?.past;
  return (
    <>
      <div className="page-head">
        <div><h1>{t('My patients')}</h1><p>{t('Patients who have shared their record with you. Access is time-limited and set by each patient.')}</p></div>
        <Button variant="primary" icon={UserSearch} onClick={() => navigate('/doctor/find')}>{t('Find a patient')}</Button>
      </div>
      <Tabs label={t('Patients')} value={tab} onChange={setTab} tabs={[{ value: 'active', label: t('Active access'), count: access.data?.active.length }, { value: 'past', label: t('Access ended'), count: access.data?.past.length }]} />
      {access.error ? <ErrorState error={access.error} onRetry={access.reload} /> : !list ? <SkeletonList rows={3} /> : list.length === 0 ? (
        <div className="card"><EmptyState icon={Users} title={tab === 'active' ? t('No active access') : t('Nothing here')} body={tab === 'active' ? t('When a patient grants you access, they’ll appear here.') : t('Patients whose access ended or was revoked appear here. You can’t see their records.')} /></div>
      ) : (
        <div className="grid-2">
          {list.map((g) => (
            <section key={g.id} className="card access-card">
              <div className="access-top">
                <Avatar name={tab === 'active' ? g.patient.fullName : maskName(g.patient.fullName)} />
                <div className="grow">
                  <div className="strong">{tab === 'active' ? g.patient.fullName : maskName(g.patient.fullName)}</div>
                  <div className="xs muted">{g.patient.patientCode}{tab === 'active' ? ` · ${t('{n} yrs', { n: ageFrom(g.patient.dateOfBirth) })} · ${g.patient.bloodGroup ?? '—'}` : ''}</div>
                </div>
                {tab === 'active' ? <Badge tone="ok" dot>{timeLeft(g.expiresAt)}</Badge> : <Badge tone={g.status === 'revoked' ? 'danger' : undefined}>{g.status === 'revoked' ? t('Revoked') : t('Expired')}</Badge>}
              </div>
              <PermissionBadges value={g.permissions} max={4} />
              {tab === 'active' ? (
                <div className="row"><Button variant="primary" onClick={() => navigate(`/doctor/patients/${g.patient.id}`)}>{t('Open record')}</Button><Button icon={FilePlus2} onClick={() => navigate(`/doctor/patients/${g.patient.id}/add`)}>{t('Add entry')}</Button></div>
              ) : (
                <div className="row"><Button icon={Send} onClick={() => navigate(`/doctor/find?id=${g.patient.patientCode}`)}>{t('Request access again')}</Button></div>
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
  useDocumentTitle(`${t('Find a patient')} · ${brand.name}`);
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
    try { await accessService.requestAccess(result.patientId, perms, hours, reason); setSent(true); toast(t('Request sent to the patient')); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head"><div><h1>{t('Find a patient')}</h1><p>{t('Use the patient ID or QR code the patient shows you. You’ll only see their record after they approve.')}</p></div></div>
      <section className="card card-pad stack">
        <form className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
          <Field label={t('Patient ID')} className="grow" help={t('Demo IDs: NV-4821-7730 (Meera Iyer), NV-9264-1183 (Fatima Khan)')}>
            {(p) => <Input {...p} placeholder="NV-0000-0000" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />}
          </Field>
          <Button type="submit" variant="primary" loading={busy && !result} disabled={code.trim().length < 6}>{t('Look up')}</Button>
          <Button icon={ScanLine} onClick={() => setScan((s) => !s)} aria-pressed={scan}>{t('Scan QR')}</Button>
        </form>
        {scan && <QrScanner onResult={(t) => { setScan(false); setCode(t.toUpperCase()); void lookup(t); }} />}
        <InlineError message={err} />
      </section>

      {result && (
        <section className="card card-pad stack">
          <div className="row">
            <Avatar name={result.maskedName} />
            <div className="grow"><div className="strong">{result.maskedName}</div><div className="xs muted num">{result.patientCode}</div></div>
            {result.status === 'active' ? <Badge tone="ok" dot>{t('You have access')}</Badge> : result.status === 'pending' ? <Badge tone="info" dot>{t('Request pending')}</Badge> : <Badge>{t('No access')}</Badge>}
          </div>
          {result.status === 'active' ? (
            <Button variant="primary" onClick={() => navigate(`/doctor/patients/${result.patientId}`)}>{t('Open record')}</Button>
          ) : result.status === 'pending' || sent ? (
            <div className="alert alert-info"><Hourglass aria-hidden /><div>{t('Waiting for the patient to approve. They’ll get a notification and must confirm with a one-time code. You’ll be notified when they respond.')}</div></div>
          ) : (
            <div className="stack">
              <div className="alert alert-accent"><KeyRound aria-hidden /><div>{t('The name is hidden until the patient approves. Ask them to check the request on their phone — or to grant access using your code.')}</div></div>
              <h2 style={{ fontSize: 'var(--t-md)' }}>{t('Request access')}</h2>
              <Field label={t('Reason (shown to the patient)')} required>{(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. Consultation today for chest pain')} />}</Field>
              <div className="grid-2" style={{ alignItems: 'start' }}>
                <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}><span className="field-label">{t('What you need')}</span><PermissionSelector value={perms} onChange={setPerms} /></div>
                <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}><span className="field-label">{t('For how long')}</span><DurationPicker hours={hours} onChange={setHours} /></div>
              </div>
              <div><Button variant="primary" icon={Send} loading={busy} disabled={!reason.trim() || !perms.length} onClick={request}>{t('Send request')}</Button></div>
            </div>
          )}
          {sent && <div className="alert alert-ok"><CheckCircle2 aria-hidden /><div>{t('Request sent.')}</div></div>}
        </section>
      )}
      {result?.status !== 'active' && <EmergencyAccessPanel initialCode={result?.patientCode ?? code} key={result?.patientCode ?? 'none'} />}
    </>
  );
}

/* ---------------- Activity ---------------- */

export function DoctorActivity() {
  useDocumentTitle(`${t('My activity')} · ${brand.name}`);
  const log = useLive(() => auditService.forDoctor(), []);
  return (
    <>
      <div className="page-head"><div><h1>{t('My activity')}</h1><p>{t('Everything you’ve viewed or added. Patients see the same entries in their access logs.')}</p></div></div>
      {log.error ? <ErrorState error={log.error} onRetry={log.reload} /> : !log.data ? <SkeletonList rows={5} /> : log.data.length === 0 ? (
        <div className="card"><EmptyState icon={ScrollText} title={t('No activity yet')} /></div>
      ) : groupByDay(log.data).map(([day, list]) => (
        <Card key={day} title={<span className="small">{day}</span>}><ul className="list">{list.map((a) => <li key={a.id}><AuditRow a={a} showPatient /></li>)}</ul></Card>
      ))}
    </>
  );
}

/* ---------------- Profile ---------------- */

export function DoctorProfile() {
  useDocumentTitle(`${t('Profile')} · ${brand.name}`);
  const { doctor } = useSession();
  const toast = useToast();
  const [phone, setPhone] = useState(doctor?.phone ?? '');
  const [quals, setQuals] = useState(doctor?.qualifications ?? '');
  const [busy, setBusy] = useState(false);
  if (!doctor) return null;
  return (
    <>
      <div className="page-head"><div><h1>{t('Profile')}</h1><p>{t('Your professional details as patients see them when granting access.')}</p></div></div>
      <section className="card card-pad row" style={{ '--gap': '18px', flexWrap: 'wrap' } as React.CSSProperties}>
        <Avatar name={doctor.fullName} size="xl" doctor />
        <div className="grow">
          <h2 className="display" style={{ fontSize: 26 }}>{doctor.fullName}</h2>
          <div className="small muted">{doctor.specialization} · {doctor.hospital?.name}, {doctor.hospital?.city}</div>
          <div className="row-wrap" style={{ marginTop: 8 }}><Badge tone="ok" icon={BadgeCheck}>{t('Registration verified')}</Badge><Badge>{t('{n} years in practice', { n: doctor.yearsOfPractice })}</Badge></div>
        </div>
      </section>
      <Card title={t('Professional details')} pad>
        <div className="stack">
          <dl className="kv">
            <dt>{t('Medical registration')}</dt><dd className="num">{doctor.registrationNumber}</dd>
            <dt>{t('Hospital')}</dt><dd>{doctor.hospital?.name}</dd>
            <dt>{t('Specialisation')}</dt><dd>{doctor.specialization}</dd>
            <dt>{t('Email')}</dt><dd><Mail size={13} aria-hidden style={{ verticalAlign: -2 }} /> {doctor.email}</dd>
          </dl>
          <p className="xs subtle">{t('Registration number, name and hospital are verified by your organisation and can’t be edited here.')}</p>
          <div className="form-grid">
            <Field label={t('Contact phone')}>{(p) => <div className="input-wrap"><Phone aria-hidden /><Input {...p} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>}</Field>
            <Field label={t('Qualifications')}>{(p) => <Input {...p} value={quals} onChange={(e) => setQuals(e.target.value)} />}</Field>
          </div>
          <div><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await doctorService.updateProfile({ phone, qualifications: quals }); toast(t('Profile saved')); } catch (e) { toast(friendlyError(e), 'error'); } finally { setBusy(false); } }}>{t('Save')}</Button></div>
        </div>
      </Card>
    </>
  );
}

