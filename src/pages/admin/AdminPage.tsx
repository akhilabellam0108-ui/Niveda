import { useState } from 'react';
import { BadgeCheck, ExternalLink, Inbox, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { DoctorApplication } from '../../types';
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

/** For the Niveda team: check doctors' registrations and verify or decline them. */
export function AdminPage() {
  useDocumentTitle(`Doctor verification · ${brand.name}`);
  const { user } = useSession();
  const [tab, setTab] = useState<Status>('pending');
  const list = useLive(() => adminService.applications(tab), [tab]);
  const pending = useLive(() => adminService.applications('pending'), []);

  return (
    <div className="admin-page">
      <header className="topbar">
        <BackButton fallback={user?.role === 'doctor' ? '/doctor' : user?.role === 'patient' ? '/app' : '/'} />
        <Brand to="/admin" size={28} />
        <Badge tone="violet" icon={ShieldCheck}>Niveda team</Badge>
      </header>
      <main className="content">
        <div className="page-head">
          <div>
            <h1>Doctor verification</h1>
            <p>Check each doctor on the medical register before approving: the name, registration number and council must all match. Patients trust that every doctor on Niveda is real.</p>
          </div>
        </div>
        <Tabs label="Applications" value={tab} onChange={setTab} tabs={[
          { value: 'pending', label: 'Waiting', count: pending.data?.length },
          { value: 'approved', label: 'Verified' },
          { value: 'declined', label: 'Needs changes' },
        ]} />
        <section className="card">
          {list.loading && !list.data ? <SkeletonList rows={3} card={false} /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? (
            <EmptyState icon={Inbox} title={tab === 'pending' ? 'No applications waiting' : 'Nothing here yet'} body={tab === 'pending' ? 'New doctor applications will appear here.' : undefined} />
          ) : list.data.map((a) => (
            <ApplicationCard key={a.id} a={a} onDone={() => { list.reload(); pending.reload(); }} />
          ))}
        </section>
      </main>
    </div>
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
