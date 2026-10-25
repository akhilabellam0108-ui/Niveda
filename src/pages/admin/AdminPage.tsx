import { useState } from 'react';
import { BadgeCheck, ExternalLink, Inbox, MessageSquareWarning, ShieldCheck, Siren, TriangleAlert } from 'lucide-react';
import type { DoctorApplication, EmergencyAccessReview, Grievance } from '../../types';
import { brand } from '../../config/brand';
import { adminService, friendlyError, GRIEVANCE_CATEGORIES, privacyService, REGISTER_CHECK_URL } from '../../services';
import { useSession } from '../../state/SessionContext';
import { useDocumentTitle, useLive } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, SkeletonList, Tabs, Textarea } from '../../components/ui';
import { Brand } from '../../components/ui/Logo';
import { BackButton } from '../../components/ui/BackButton';
import { fmtDate, fmtDateTime } from '../../lib/dates';

import { t } from '../../i18n';
import { T } from '../../i18n/T';
type Status = 'pending' | 'approved' | 'declined';

/** For the Niveda team: verify doctors, and review every use of emergency access. */
export function AdminPage() {
  useDocumentTitle(`${t('Niveda team')} · ${brand.name}`);
  const { user } = useSession();
  const [section, setSection] = useState<'doctors' | 'emergency' | 'grievances'>('doctors');
  const pendingApps = useLive(() => adminService.applications('pending'), []);
  const pendingEmergencies = useLive(() => adminService.emergencyAccesses('pending'), []);
  const openGrievances = useLive(() => privacyService.adminGrievances('open'), []);

  return (
    <div className="admin-page">
      <header className="topbar">
        <BackButton fallback={user?.role === 'doctor' ? '/doctor' : user?.role === 'patient' ? '/app' : '/'} />
        <Brand to="/admin" size={28} />
        <Badge tone="violet" icon={ShieldCheck}>{t('Niveda team')}</Badge>
      </header>
      <main className="content">
        <Tabs label={t('Team work')} value={section} onChange={setSection} tabs={[
          { value: 'doctors', label: t('Doctor verification'), count: pendingApps.data?.length },
          { value: 'emergency', label: t('Emergency access'), count: pendingEmergencies.data?.length },
          { value: 'grievances', label: t('Grievances'), count: openGrievances.data?.length },
        ]} />
        {section === 'doctors' ? <DoctorVerification onChange={pendingApps.reload} />
          : section === 'emergency' ? <EmergencyReviews onChange={pendingEmergencies.reload} />
          : <Grievances onChange={openGrievances.reload} />}
      </main>
    </div>
  );
}

function DoctorVerification({ onChange }: { onChange: () => void }) {
  const [tab, setTab] = useState<Status>('pending');
  const list = useLive(() => adminService.applications(tab), [tab]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Doctor verification')}</h1>
          <p>{t('Check each doctor on the medical register before approving: the name, registration number and council must all match. Patients trust that every doctor on Niveda is real.')}</p>
        </div>
      </div>
      <Tabs label={t('Applications')} value={tab} onChange={setTab} tabs={[
        { value: 'pending', label: t('Waiting') },
        { value: 'approved', label: t('Verified') },
        { value: 'declined', label: t('Needs changes') },
      ]} />
      <section className="card">
        {list.loading && !list.data ? <SkeletonList rows={3} card={false} /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? (
          <EmptyState icon={Inbox} title={tab === 'pending' ? t('No applications waiting') : t('Nothing here yet')} body={tab === 'pending' ? t('New doctor applications will appear here.') : undefined} />
        ) : list.data.map((a) => (
          <ApplicationCard key={a.id} a={a} onDone={() => { list.reload(); onChange(); }} />
        ))}
      </section>
    </>
  );
}

function EmergencyReviews({ onChange }: { onChange: () => void }) {
  const [tab, setTab] = useState<'pending' | 'appropriate' | 'concern'>('pending');
  const list = useLive(() => adminService.emergencyAccesses(tab), [tab]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Emergency access')}</h1>
          <p>{t('Every time a doctor opens a record without the patient’s consent. Check the reason makes sense — for example with the hospital — and mark it appropriate, or raise a concern (which ends the access at once).')}</p>
        </div>
      </div>
      <Tabs label={t('Emergency access')} value={tab} onChange={setTab} tabs={[
        { value: 'pending', label: t('To review') },
        { value: 'appropriate', label: t('Appropriate') },
        { value: 'concern', label: t('Concerns') },
      ]} />
      <section className="card">
        {list.loading && !list.data ? <SkeletonList rows={3} card={false} /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? (
          <EmptyState icon={Siren} title={tab === 'pending' ? t('Nothing to review') : t('Nothing here yet')} body={tab === 'pending' ? t('Uses of emergency access will appear here.') : undefined} />
        ) : list.data.map((e) => (
          <EmergencyCard key={e.id} e={e} onDone={() => { list.reload(); onChange(); }} />
        ))}
      </section>
    </>
  );
}

function EmergencyCard({ e, onDone }: { e: EmergencyAccessReview; onDone: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<'appropriate' | 'concern' | null>(null);
  const [note, setNote] = useState('');
  const decide = async (outcome: 'appropriate' | 'concern') => {
    await adminService.reviewEmergency(e.id, outcome, note || undefined);
    toast(outcome === 'appropriate' ? t('Marked as appropriate') : t('Concern recorded; the access has ended'));
    setNote('');
    onDone();
  };
  return (
    <article className="app-card" aria-label={t('Emergency access by {name}', { name: e.doctor.name })}>
      <div className="app-card-head">
        <div>
          <div className="strong">{e.doctor.name}{' '}{t('→ patient')}{' '}{e.patient.maskedName} <span className="muted num">({e.patient.code})</span></div>
          <div className="xs muted">{fmtDateTime(e.createdAt)} · {e.doctor.hospital ?? t('No hospital')} · {t('Reg. {number}', { number: e.doctor.registrationNumber })} · {e.doctor.email}</div>
        </div>
        <Badge tone={e.reviewStatus === 'concern' ? 'danger' : e.reviewStatus === 'appropriate' ? 'ok' : 'warn'} dot>
          {e.reviewStatus === 'concern' ? t('Concern') : e.reviewStatus === 'appropriate' ? t('Appropriate') : t('To review')}
        </Badge>
      </div>
      <dl className="kv">
        <dt>{t('Reason')}</dt><dd>{e.reason}</dd>
        <dt>{t('Doctor wrote')}</dt><dd>“{e.justification}”</dd>
        <dt>{t('Ended')}</dt><dd>{e.endedEarly ? t('Ended early, {value}', { value: fmtDateTime(e.endedAt) }) : new Date(e.endedAt) > new Date() ? t('Still active') : fmtDateTime(e.endedAt)}</dd>
        <dt>{t('This doctor')}</dt><dd>{t('Emergency access used {n} times in the last 30 days', { n: e.doctorUsesLast30Days })}</dd>
        {e.reviewNote && <><dt>{t('Note')}</dt><dd>{e.reviewNote}</dd></>}
      </dl>
      {e.reviewStatus === 'pending' && (
        <div className="app-card-actions">
          <span className="grow" />
          <Button size="sm" icon={TriangleAlert} onClick={() => setConfirm('concern')}>{t('Raise a concern')}</Button>
          <Button size="sm" variant="primary" icon={BadgeCheck} onClick={() => decide('appropriate')}>{t('Appropriate')}</Button>
        </div>
      )}
      <ConfirmDialog open={confirm === 'concern'} onClose={() => setConfirm(null)} onConfirm={() => decide('concern')}
        title={t('Raise a concern')} confirmLabel={t('Record concern')} danger disabled={!note.trim()}
        body={t('This ends the doctor’s access now if it’s still running, and keeps your note on file.')}>
        <Field label={t('What’s the concern')} required>{(p) => <Textarea {...p} rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder={t('e.g. The hospital has no record of this patient being admitted.')} />}</Field>
      </ConfirmDialog>
    </article>
  );
}

function ApplicationCard({ a, onDone }: { a: DoctorApplication; onDone: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<'approve' | 'decline' | null>(null);
  const [note, setNote] = useState('');

  const decide = async (decision: 'approve' | 'decline') => {
    await adminService.review(a.id, decision, decision === 'decline' ? note : undefined);
    toast(decision === 'approve' ? t('{fullName} is verified', { fullName: a.fullName }) : t('The doctor has been asked to make changes'));
    setNote('');
    onDone();
  };

  return (
    <article className="app-card" aria-label={a.fullName}>
      <div className="app-card-head">
        <div>
          <div className="strong">{a.fullName}</div>
          <div className="xs muted">{a.email} · {a.phone} · {t('submitted {date}', { date: fmtDateTime(a.submittedAt) })}</div>
        </div>
        <Badge tone={a.status === 'approved' ? 'ok' : a.status === 'declined' ? 'danger' : 'warn'} dot>
          {a.status === 'approved' ? t('Verified') : a.status === 'declined' ? t('Needs changes') : t('Waiting')}
        </Badge>
      </div>
      <dl className="kv">
        <dt>{t('Registration')}</dt><dd><strong>{a.registrationNumber}</strong> · {a.medicalCouncil}{a.registrationYear ? ` · ${a.registrationYear}` : ''}</dd>
        <dt>{t('Practice')}</dt><dd>{a.specialization} · {a.qualifications} · {t('{n} years', { n: a.yearsOfPractice })}</dd>
        <dt>{t('Works at')}</dt><dd>{a.hospitalName}, {a.hospitalCity}</dd>
        {a.reviewNote && <><dt>{t('Note')}</dt><dd>{a.reviewNote}</dd></>}
        {a.accessCode && <><dt>{t('Access code')}</dt><dd><code>{a.accessCode}</code></dd></>}
      </dl>
      {a.status === 'pending' && (
        <div className="app-card-actions">
          <a className="btn btn-secondary btn-sm" href={REGISTER_CHECK_URL} target="_blank" rel="noreferrer"><ExternalLink aria-hidden />{t('Check the medical register')}</a>
          <span className="grow" />
          <Button size="sm" icon={TriangleAlert} onClick={() => setConfirm('decline')}>{t('Ask for changes')}</Button>
          <Button size="sm" variant="primary" icon={BadgeCheck} onClick={() => setConfirm('approve')}>{t('Verify doctor')}</Button>
        </div>
      )}
      <ConfirmDialog open={confirm === 'approve'} onClose={() => setConfirm(null)} onConfirm={() => decide('approve')}
        title={t('Verify {fullName}?', { fullName: a.fullName })} confirmLabel={t('Verify doctor')}
        body={<T text="Only verify once you’ve found {number} on the register under {name} ({council}). They’ll get an access code and patients will be able to share records with them." number={<strong>{a.registrationNumber}</strong>} name={<strong>{a.fullName}</strong>} council={a.medicalCouncil} />} />
      <ConfirmDialog open={confirm === 'decline'} onClose={() => setConfirm(null)} onConfirm={() => decide('decline')}
        title={t('Ask for changes')} confirmLabel={t('Send to the doctor')} disabled={!note.trim()}
        body={t('The doctor sees this note and can correct their application.')}>
        <Field label={t('What needs fixing')} required>{(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. The registration number doesn’t match the name on the Karnataka Medical Council register.')} />}</Field>
      </ConfirmDialog>
    </article>
  );
}

/** DPDP Act s.13: every grievance answered within 90 days. Overdue ones float to the top. */
function Grievances({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<Grievance['status']>('open');
  const list = useLive(() => privacyService.adminGrievances(tab), [tab]);
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const respond = async (g: Grievance, status: 'in_progress' | 'resolved') => {
    try { await privacyService.adminRespond(g.id, status, answer[g.id] ?? ''); toast(status === 'resolved' ? t('Answer sent') : t('Marked in progress')); list.reload(); onChange(); } catch (e) { toast(friendlyError(e), 'error'); }
  };
  return (
    <>
      <div className="page-head"><div><h1>{t('Grievances')}</h1><p>{t('Privacy complaints from patients and doctors. The law allows 90 days; aim for 7. The person sees your answer.')}</p></div></div>
      <Tabs label={t('Grievances')} value={tab} onChange={setTab} tabs={[{ value: 'open', label: t('Open') }, { value: 'in_progress', label: t('In progress') }, { value: 'resolved', label: t('Answered') }]} />
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data ? <SkeletonList rows={3} /> : list.data.length === 0 ? (
        <EmptyState icon={MessageSquareWarning} title={t('Nothing here')} />
      ) : (
        <div className="stack">
          {list.data.map((g) => {
            const overdue = g.status !== 'resolved' && new Date(g.respondBy) < new Date(Date.now() + 7 * 864e5);
            return (
              <section key={g.id} className="card card-pad stack">
                <div className="spread"><span className="strong num">{g.reference}</span>{overdue && <Badge tone="danger">{t('Due {date}', { date: fmtDate(g.respondBy) })}</Badge>}</div>
                <div className="xs muted">{GRIEVANCE_CATEGORIES.find((c) => c.value === g.category)?.label} · {fmtDateTime(g.createdAt)}</div>
                <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{g.description}</p>
                {g.status === 'resolved' ? <div className="small brief-note">{g.response}</div> : (
                  <>
                    <Field label={t('Answer')}>{(p) => <Textarea {...p} rows={3} value={answer[g.id] ?? g.response ?? ''} onChange={(e) => setAnswer({ ...answer, [g.id]: e.target.value })} />}</Field>
                    <div className="row">{g.status === 'open' && <Button onClick={() => respond(g, 'in_progress')}>{t('Mark in progress')}</Button>}<Button variant="primary" onClick={() => respond(g, 'resolved')}>{t('Send answer')}</Button></div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
