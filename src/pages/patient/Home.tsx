import { Link, useNavigate } from 'react-router-dom';
import {
  FilePlus2, Upload, Pill, TriangleAlert, ShieldCheck, Clock3, Siren, Droplet, CalendarDays, IdCard, ArrowRight, CalendarClock, Activity, Inbox,
} from 'lucide-react';
import { accessService, medicationService, patientService, recordService } from '../../services';
import { DoseList, useClock } from '../../components/medications/Doses';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useSession } from '../../state/SessionContext';
import { ageFrom, fmtDate, fmtMonthYear, timeLeft, now } from '../../lib/dates';
import { RECORD_TYPES, recordTitle, isSevereAllergy, opt } from '../../lib/recordMeta';
import { brand } from '../../config/brand';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Skeleton, SkeletonList } from '../../components/ui';
import { buildTimeline } from '../../components/records/Timeline';
import { RecordCard, TypeIcon } from '../../components/records/RecordCard';
import { usePatientUI } from '../../components/layout/PatientShell';

import { t } from '../../i18n';
import { T } from '../../i18n/T';
function greeting() {
  const h = now().getHours();
  return h < 12 ? t('Good morning') : h < 17 ? t('Good afternoon') : t('Good evening');
}

export function PatientHome() {
  useDocumentTitle(`${t('Home')} · ${brand.name}`);
  const { patient } = useSession();
  const ui = usePatientUI();
  const navigate = useNavigate();
  const summary = useLive(() => patientService.summary(), []);
  const records = useLive(() => recordService.list(), []);
  const access = useLive(() => accessService.listForPatient(), []);
  const tick = useClock(60000);
  const doses = useLive(() => medicationService.today(), [tick]);
  if (!patient) return null;
  const s = summary.data;
  const age = ageFrom(patient.dateOfBirth);

  const recent = records.data ? buildTimeline(records.data).filter((e) => e.kind === 'record').slice(0, 5) : [];

  return (
    <>
      <section className="hello">
        <div className="row" style={{ '--gap': '18px' } as React.CSSProperties}>
          <Avatar name={patient.fullName} src={patient.photoDataUrl} size="lg" />
          <div>
            <p className="small muted">{greeting()},</p>
            <h1>{patient.fullName}</h1>
            <div className="id-strip">
              {age !== undefined && <span><CalendarDays aria-hidden /><T text="{n} years" n={<b>{age}</b>} /></span>}
              <span><Droplet aria-hidden />{t('Blood group')}{' '}<b>{patient.bloodGroup ?? '—'}</b></span>
              <span><IdCard aria-hidden />{t('ID')} <b className="num">{patient.patientCode}</b></span>
            </div>
          </div>
        </div>
        <Button variant="danger-ghost" icon={Siren} onClick={() => navigate('/app/emergency')}>{t('Emergency info')}</Button>
      </section>

      {s && s.allergies.length > 0 && (
        <div className={`alert ${s.allergies.some(isSevereAllergy) ? 'alert-danger' : 'alert-warn'}`} role="note">
          <TriangleAlert aria-hidden />
          <div className="grow">
            <div className="alert-title">{t('Allergies')}</div>
            <div className="allergy-strip" style={{ marginTop: 6 }}>
              {s.allergies.map((a) => (
                <button key={a.id} className={`allergy-pill ${isSevereAllergy(a) ? 'severe' : ''}`} style={{ cursor: 'pointer' }} onClick={() => ui.openRecord(a.id)}>
                  {String(a.data.allergen)} <span className="reaction">· {opt(a.data.severity)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <section aria-label={t('Quick actions')} className="quick-actions">
        <button className="qa" onClick={() => ui.addRecord()}><FilePlus2 aria-hidden />{t('Add medical record')}</button>
        <button className="qa" onClick={() => ui.upload()}><Upload aria-hidden />{t('Upload report')}</button>
        <button className="qa" onClick={() => ui.addRecord('medication')}><Pill aria-hidden />{t('Add medication')}</button>
        <button className="qa" onClick={() => ui.addRecord('allergy')}><TriangleAlert aria-hidden />{t('Add allergy')}</button>
        <button className="qa" onClick={() => ui.grantAccess()}><ShieldCheck aria-hidden />{t('Grant doctor access')}</button>
        <button className="qa" onClick={() => navigate('/app/timeline')}><Clock3 aria-hidden />{t('View timeline')}</button>
      </section>

      <section className="card" aria-label={t('Record at a glance')}>
        {summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : (
          <div className="stats-row">
            {[
              [t('Entries in your record'), s?.counts.records],
              [t('Years of history'), s?.counts.years],
              [t('Doctors who contributed'), s?.counts.doctors],
              [t('Documents'), s?.counts.documents],
            ].map(([l, v]) => (
              <div key={l as string} className="stat"><span className="stat-value">{v ?? <Skeleton w={40} h={26} />}</span><span className="stat-label">{l}</span></div>
            ))}
          </div>
        )}
      </section>

      {access.data && access.data.requests.length > 0 && (
        <div className="alert alert-accent">
          <Inbox aria-hidden />
          <div className="grow">
            <div className="alert-title">{t('{name} is asking to see your records', { name: access.data.requests[0].doctor.fullName })}</div>
            <div className="muted">{access.data.requests[0].hospital?.name} · {access.data.requests[0].reason}</div>
          </div>
          <Button size="sm" variant="primary" onClick={() => navigate('/app/access?tab=requests')}>{t('Review')}</Button>
        </div>
      )}

      <div className="dash-grid">
        <Card title={t('Recent activity')} action={<Link className="card-link" to="/app/timeline">{t('Full timeline')}{' '}<ArrowRight aria-hidden /></Link>}>
          {records.error ? <ErrorState error={records.error} title={t('Unable to load medical records')} onRetry={records.reload} /> : !records.data ? <SkeletonList card={false} /> : recent.length === 0 ? (
            <EmptyState icon={Clock3} title={t('Your timeline starts here')} body={t('Add a past visit, test or vaccination — or grant a doctor access so they can add to your record.')} action={<Button variant="primary" icon={FilePlus2} onClick={() => ui.addRecord()}>{t('Add medical record')}</Button>} />
          ) : (
            <div className="stack" style={{ padding: 20, '--gap': '18px' } as React.CSSProperties}>
              {recent.map((e, i) => {
                const month = fmtMonthYear(e.date);
                const showMonth = i === 0 || fmtMonthYear(recent[i - 1].date) !== month;
                return (
                  <div key={e.record.id} className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                    {showMonth && <div className="xs subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{month}</div>}
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <TypeIcon type={e.record.type} size="sm" />
                      <div className="grow">
                        <RecordCard record={e.record} onOpen={ui.openRecord} showDate>
                          {e.kind === 'record' && e.children.length > 0 && (
                            <div className="row-wrap">{e.children.map((c) => <Badge key={c.id}>{c.type === 'medication' ? t('Prescription') : c.type === 'lab_test' ? t('Lab order') : t(RECORD_TYPES[c.type].label)}: {recordTitle(c)}</Badge>)}</div>
                          )}
                        </RecordCard>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="stack">
          <Card title={t('Today’s medicines')} action={<Link className="card-link" to="/app/medications">{t('Reminders')}{' '}<ArrowRight aria-hidden /></Link>}>
            {!doses.data ? <SkeletonList rows={2} card={false} /> : <DoseList doses={doses.data} compact />}
          </Card>
          <Card title={t('Doctors with access')} action={<Link className="card-link" to="/app/access">{t('Manage')}{' '}<ArrowRight aria-hidden /></Link>}>
            {!access.data ? <SkeletonList rows={2} card={false} /> : access.data.active.length === 0 ? (
              <EmptyState compact icon={ShieldCheck} title={t('No one has access')} body={t('Your record is private. Grant access when you visit a doctor.')} action={<Button icon={ShieldCheck} onClick={ui.grantAccess}>{t('Grant access')}</Button>} />
            ) : (
              <ul className="list">
                {access.data.active.map((g) => (
                  <li key={g.id} className="list-item">
                    <Avatar name={g.doctor.fullName} doctor size="sm" />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="strong truncate">{g.doctor.fullName}</div>
                      <div className="xs muted truncate">{g.hospital?.name}</div>
                    </div>
                    <Badge tone={accessService.hoursLeft(g) < 24 ? 'warn' : 'ok'} dot>{timeLeft(g.expiresAt)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('Current medications')} action={<Link className="card-link" to="/app/medications">{t('All')}{' '}<ArrowRight aria-hidden /></Link>}>
            {!s ? <SkeletonList rows={2} card={false} /> : s.activeMedications.length === 0 ? (
              <EmptyState compact icon={Pill} title={t('No current medications')} body={t('Add a medicine to keep your treatment history up to date.')} action={<Button icon={Pill} onClick={() => ui.addRecord('medication')}>{t('Add medication')}</Button>} />
            ) : (
              <ul className="list">
                {s.activeMedications.map((m) => (
                  <li key={m.id}>
                    <button className="list-item clickable" onClick={() => ui.openRecord(m.id)}>
                      <TypeIcon type="medication" size="sm" />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="strong truncate" style={{ display: 'block' }}>{String(m.data.name)} <span className="muted" style={{ fontWeight: 400 }}>{String(m.data.dosage)}</span></span>
                        <span className="xs muted">{opt(m.data.frequency)}{m.data.endDate ? ` · ${t('until {value}', { value: fmtDate(String(m.data.endDate)) })}` : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('Health summary')}>
            {!s ? <SkeletonList rows={2} card={false} /> : (
              <ul className="list">
                <li className="list-item">
                  <span className="type-icon sm tone-violet"><Activity aria-hidden /></span>
                  <div className="grow"><div className="xs subtle">{t('Ongoing conditions')}</div><div className="small strong">{s.conditions.length ? s.conditions.map((c) => String(c.data.condition)).join(', ') : t('None recorded')}</div></div>
                </li>
                <li className="list-item">
                  <span className="type-icon sm tone-accent"><CalendarClock aria-hidden /></span>
                  <div className="grow"><div className="xs subtle">{t('Next follow-up')}</div><div className="small strong">{s.nextFollowUp ? `${fmtDate(s.nextFollowUp.date)} · ${s.nextFollowUp.label}` : t('Nothing scheduled')}</div></div>
                </li>
                <li className="list-item">
                  <span className="type-icon sm"><Clock3 aria-hidden /></span>
                  <div className="grow"><div className="xs subtle">{t('Last visit')}</div><div className="small strong">{s.lastVisit ? `${fmtDate(s.lastVisit.date)} · ${s.lastVisit.createdBy.role === 'doctor' ? s.lastVisit.createdBy.name : String(s.lastVisit.data.doctor ?? 'Visit')}` : t('None yet')}</div></div>
                </li>
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
