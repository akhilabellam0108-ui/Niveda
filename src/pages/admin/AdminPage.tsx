import { useState } from 'react';
import { BadgeCheck, ExternalLink, Inbox, ShieldCheck, Siren, TriangleAlert } from 'lucide-react';
import type { DoctorApplication, EmergencyAccessReview } from '../../types';
import { brand } from '../../config/brand';
import { adminService, REGISTER_CHECK_URL } from '../../services';
import { useSession } from '../../state/SessionContext';
import { useDocumentTitle, useLive } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, SkeletonList, Tabs, Textarea } from '../../components/ui';
import { Brand } from '../../components/ui/Logo';
import { BackButton } from '../../components/ui/BackButton';
import { fmtDateTime } from '../../lib/dates';

type Status = 'pending' | 'approved' | 'declined';

/** For the Niveda team: verify doctors, and review every use of emergency access. */
export function AdminPage() {
  useDocumentTitle(`Niveda team · ${brand.name}`);
  const { user } = useSession();
  const [section, setSection] = useState<'doctors' | 'emergency'>('doctors');
  const pendingApps = useLive(() => adminService.applications('pending'), []);
  const pendingEmergencies = useLive(() => adminService.emergencyAccesses('pending'), []);

  return (
    <div className="admin-page">
      <header className="topbar">
        <BackButton fallback={user?.role === 'doctor' ? '/doctor' : user?.role === 'patient' ? '/app' : '/'} />
        <Brand to="/admin" size={28} />
        <Badge tone="violet" icon={ShieldCheck}>Niveda team</Badge>
      </header>
      <main className="content">
        <Tabs label="Team work" value={section} onChange={setSection} tabs={[
          { value: 'doctors', label: 'Doctor verification', count: pendingApps.data?.length },
          { value: 'emergency', label: 'Emergency access', count: pendingEmergencies.data?.length },
        ]} />
        {section === 'doctors'
          ? <DoctorVerification onChange={pendingApps.reload} />
          : <EmergencyReviews onChange={pendingEmergencies.reload} />}
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
          <h1>Doctor verification</h1>
          <p>Check each doctor on the medical register before approving: the name, registration number and council must all match. Patients trust that every doctor on Niveda is real.</p>
        </div>
      </div>
      <Tabs label="Applications" value={tab} onChange={setTab} tabs={[
        { value: 'pending', label: 'Waiting' },
        { value: 'approved', label: 'Verified' },
        { value: 'declined', label: 'Needs changes' },
      ]} />
      <section className="card">
        {list.loading && !list.data ? <SkeletonList rows={3} card={false} /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? (
          <EmptyState icon={Inbox} title={tab === 'pending' ? 'No applications waiting' : 'Nothing here yet'} body={tab === 'pending' ? 'New doctor applications will appear here.' : undefined} />
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
          <h1>Emergency access</h1>
          <p>Every time a doctor opens a record without the patient’s consent. Check the reason makes sense — for example with the hospital — and mark it appropriate, or raise a concern (which ends the access at once).</p>
        </div>
      </div>
      <Tabs label="Emergency access" value={tab} onChange={setTab} tabs={[
        { value: 'pending', label: 'To review' },
        { value: 'appropriate', label: 'Appropriate' },
        { value: 'concern', label: 'Concerns' },
      ]} />
      <section className="card">
        {list.loading && !list.data ? <SkeletonList rows={3} card={false} /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? (
          <EmptyState icon={Siren} title={tab === 'pending' ? 'Nothing to review' : 'Nothing here yet'} body={tab === 'pending' ? 'Uses of emergency access will appear here.' : undefined} />
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
    toast(outcome === 'appropriate' ? 'Marked as appropriate' : 'Concern recorded; the access has ended');
    setNote('');
    onDone();
  };
  return (
    <article className="app-card" aria-label={`Emergency access by ${e.doctor.name}`}>
      <div className="app-card-head">
        <div>
          <div className="strong">{e.doctor.name} → patient {e.patient.maskedName} <span className="muted num">({e.patient.code})</span></div>
          <div className="xs muted">{fmtDateTime(e.createdAt)} · {e.doctor.hospital ?? 'No hospital'} · Reg. {e.doctor.registrationNumber} · {e.doctor.email}</div>
        </div>
        <Badge tone={e.reviewStatus === 'concern' ? 'danger' : e.reviewStatus === 'appropriate' ? 'ok' : 'warn'} dot>
          {e.reviewStatus === 'concern' ? 'Concern' : e.reviewStatus === 'appropriate' ? 'Appropriate' : 'To review'}
        </Badge>
      </div>
      <dl className="kv">
        <dt>Reason</dt><dd>{e.reason}</dd>
        <dt>Doctor wrote</dt><dd>“{e.justification}”</dd>
        <dt>Ended</dt><dd>{e.endedEarly ? `Ended early, ${fmtDateTime(e.endedAt)}` : new Date(e.endedAt) > new Date() ? 'Still active' : fmtDateTime(e.endedAt)}</dd>
        <dt>This doctor</dt><dd>{e.doctorUsesLast30Days} emergency access{e.doctorUsesLast30Days === 1 ? '' : 'es'} in the last 30 days</dd>
        {e.reviewNote && <><dt>Note</dt><dd>{e.reviewNote}</dd></>}
      </dl>
      {e.reviewStatus === 'pending' && (
        <div className="app-card-actions">
          <span className="grow" />
          <Button size="sm" icon={TriangleAlert} onClick={() => setConfirm('concern')}>Raise a concern</Button>
          <Button size="sm" variant="primary" icon={BadgeCheck} onClick={() => decide('appropriate')}>Appropriate</Button>
        </div>
      )}
      <ConfirmDialog open={confirm === 'concern'} onClose={() => setConfirm(null)} onConfirm={() => decide('concern')}
        title="Raise a concern" confirmLabel="Record concern" danger disabled={!note.trim()}
        body="This ends the doctor’s access now if it’s still running, and keeps your note on file.">
        <Field label="What’s the concern" required>{(p) => <Textarea {...p} rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. The hospital has no record of this patient being admitted." />}</Field>
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
    toast(decision === 'approve' ? `${a.fullName} is verified` : 'The doctor has been asked to make changes');
    setNote('');
    onDone();
  };

  return (
    <article className="app-card" aria-label={a.fullName}>
      <div className="app-card-head">
        <div>
          <div className="strong">{a.fullName}</div>
          <div className="xs muted">{a.email} · {a.phone} · submitted {fmtDateTime(a.submittedAt)}</div>
        </div>
        <Badge tone={a.status === 'approved' ? 'ok' : a.status === 'declined' ? 'danger' : 'warn'} dot>
          {a.status === 'approved' ? 'Verified' : a.status === 'declined' ? 'Needs changes' : 'Waiting'}
        </Badge>
      </div>
      <dl className="kv">
        <dt>Registration</dt><dd><strong>{a.registrationNumber}</strong> · {a.medicalCouncil}{a.registrationYear ? ` · ${a.registrationYear}` : ''}</dd>
        <dt>Practice</dt><dd>{a.specialization} · {a.qualifications} · {a.yearsOfPractice} years</dd>
        <dt>Works at</dt><dd>{a.hospitalName}, {a.hospitalCity}</dd>
        {a.reviewNote && <><dt>Note</dt><dd>{a.reviewNote}</dd></>}
        {a.accessCode && <><dt>Access code</dt><dd><code>{a.accessCode}</code></dd></>}
      </dl>
      {a.status === 'pending' && (
        <div className="app-card-actions">
          <a className="btn btn-secondary btn-sm" href={REGISTER_CHECK_URL} target="_blank" rel="noreferrer"><ExternalLink aria-hidden />Check the medical register</a>
          <span className="grow" />
          <Button size="sm" icon={TriangleAlert} onClick={() => setConfirm('decline')}>Ask for changes</Button>
          <Button size="sm" variant="primary" icon={BadgeCheck} onClick={() => setConfirm('approve')}>Verify doctor</Button>
        </div>
      )}
      <ConfirmDialog open={confirm === 'approve'} onClose={() => setConfirm(null)} onConfirm={() => decide('approve')}
        title={`Verify ${a.fullName}?`} confirmLabel="Verify doctor"
        body={<>Only verify once you’ve found <strong>{a.registrationNumber}</strong> on the register under <strong>{a.fullName}</strong> ({a.medicalCouncil}). They’ll get an access code and patients will be able to share records with them.</>} />
      <ConfirmDialog open={confirm === 'decline'} onClose={() => setConfirm(null)} onConfirm={() => decide('decline')}
        title="Ask for changes" confirmLabel="Send to the doctor" disabled={!note.trim()}
        body="The doctor sees this note and can correct their application.">
        <Field label="What needs fixing" required>{(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The registration number doesn’t match the name on the Karnataka Medical Council register." />}</Field>
      </ConfirmDialog>
    </article>
  );
}
