import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HeartHandshake, MessageSquareWarning, Trash2, Undo2, UserCheck, Download } from 'lucide-react';
import type { Grievance } from '../../types';
import {
  CONSENT_DEFAULTS, CONSENT_PURPOSES, DELETION_DAYS, GRIEVANCE_CATEGORIES, friendlyError, privacyService, type Nominee,
} from '../../services';
import { useLive } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { useSession } from '../../state/SessionContext';
import { brand } from '../../config/brand';
import { fmtDate, fmtDateTime } from '../../lib/dates';
import { Badge, Button, Card, Field, InlineError, Input, Modal, Select, Textarea } from '../ui';
import { OtpDialog } from '../ui/Otp';

/** Rights under India's DPDP Act: consent, nominee, grievances and erasure. */
export function YourRights() {
  const { user } = useSession();
  return (
    <>
      <div className="section-title"><h2>Your data rights</h2><p className="small muted">Under India’s Digital Personal Data Protection Act. Read the <Link to="/legal/privacy" target="_blank">privacy notice</Link>.</p></div>
      <ConsentsCard />
      {user?.role === 'patient' && <NomineeCard />}
      <GrievancesCard />
      <Card title="Your data, to keep"><div className="list-item"><span className="type-icon sm"><Download aria-hidden /></span><div className="grow small">Download everything we hold about you — your record, documents and access log.</div><Link className="btn btn-sm btn-secondary" to={user?.role === 'patient' ? '/app/settings/export' : '/doctor/settings/account'}>Export</Link></div></Card>
      <DeleteAccountCard />
    </>
  );
}

function ConsentsCard() {
  const toast = useToast();
  const consents = useLive(() => privacyService.consents(), []);
  const [busy, setBusy] = useState<string>();
  const granted = (p: keyof typeof CONSENT_DEFAULTS) => consents.data?.find((c) => c.purpose === p)?.granted ?? CONSENT_DEFAULTS[p];
  const changed = (p: string) => consents.data?.find((c) => c.purpose === p)?.at;
  const set = async (purpose: (typeof CONSENT_PURPOSES)[number]['purpose'], on: boolean) => {
    setBusy(purpose);
    try { await privacyService.setConsent(purpose, on); toast(on ? 'Consent given' : 'Consent withdrawn'); consents.reload(); } catch (e) { toast(friendlyError(e), 'error'); } finally { setBusy(undefined); }
  };
  return (
    <Card title="What you’ve agreed to">
      <ul className="list">
        {CONSENT_PURPOSES.map((c) => (
          <li key={c.purpose} className="list-item">
            <span className="type-icon sm"><HeartHandshake aria-hidden /></span>
            <div className="grow">
              <div className="strong small">{c.title} {c.required && <Badge>Required</Badge>}</div>
              <div className="xs muted">{c.body}{changed(c.purpose) ? ` · last changed ${fmtDate(changed(c.purpose)!)}` : ''}</div>
            </div>
            {c.required ? <Badge tone="ok">On</Badge> : (
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" aria-label={c.title} checked={granted(c.purpose)} disabled={!consents.data || busy === c.purpose} onChange={(e) => void set(c.purpose, e.target.checked)} />
                <span className="xs">{granted(c.purpose) ? 'On' : 'Off'}</span>
              </label>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NomineeCard() {
  const toast = useToast();
  const nominee = useLive(() => privacyService.nominee(), []);
  const [open, setOpen] = useState(false);
  const n = nominee.data;
  return (
    <Card title="Nominee" action={<Button size="sm" onClick={() => setOpen(true)}>{n ? 'Change' : 'Add nominee'}</Button>}>
      <div className="list-item">
        <span className="type-icon sm"><UserCheck aria-hidden /></span>
        <div className="grow small">
          {n ? <><span className="strong">{n.name}</span> <span className="muted">· {n.relationship} · {n.phone}</span></> : <span className="muted">Someone who can exercise your data rights if you die or can’t act yourself.</span>}
        </div>
        {n && <Button size="sm" variant="ghost" onClick={async () => { try { await privacyService.setNominee(null); toast('Nominee removed'); nominee.reload(); } catch (e) { toast(friendlyError(e), 'error'); } }}>Remove</Button>}
      </div>
      <NomineeDialog open={open} initial={n ?? undefined} onClose={() => setOpen(false)} onSaved={() => { nominee.reload(); toast('Nominee saved'); }} />
    </Card>
  );
}

function NomineeDialog({ open, initial, onClose, onSaved }: { open: boolean; initial?: Nominee; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Nominee>({ name: '', relationship: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) { setF(initial ?? { name: '', relationship: '', phone: '', email: '' }); setSeeded(true); }
  if (!open && seeded) setSeeded(false);
  const set = (k: keyof Nominee) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setErr(undefined);
    try { await privacyService.setNominee(f); onSaved(); onClose(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Your nominee" size="sm" description="They can ask us to correct, export or erase your data on your behalf, but only after showing proof (for example a death certificate or medical certificate)."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="stack">
        <Field label="Name" required>{(p) => <Input {...p} value={f.name} onChange={set('name')} />}</Field>
        <div className="form-grid">
          <Field label="Relationship" required>{(p) => <Input {...p} value={f.relationship} onChange={set('relationship')} />}</Field>
          <Field label="Phone" required>{(p) => <Input {...p} type="tel" value={f.phone} onChange={set('phone')} />}</Field>
        </div>
        <Field label="Email">{(p) => <Input {...p} type="email" value={f.email ?? ''} onChange={set('email')} />}</Field>
        <InlineError message={err} />
      </div>
    </Modal>
  );
}

const STATUS_TONE: Record<Grievance['status'], 'warn' | 'info' | 'ok'> = { open: 'warn', in_progress: 'info', resolved: 'ok' };
const STATUS_LABEL: Record<Grievance['status'], string> = { open: 'Open', in_progress: 'In progress', resolved: 'Answered' };

function GrievancesCard() {
  const toast = useToast();
  const list = useLive(() => privacyService.grievances(), []);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Grievance['category']>('access');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const submit = async () => {
    setBusy(true); setErr(undefined);
    try {
      const g = await privacyService.fileGrievance(category, text);
      toast(`Received — reference ${g.reference}`);
      setText(''); setOpen(false); list.reload();
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Card title="Grievances" action={<Button size="sm" icon={MessageSquareWarning} onClick={() => setOpen(true)}>Raise a grievance</Button>}>
      <div className="list-item"><div className="grow xs muted">{brand.grievanceOfficer.name} · <a href={`mailto:${brand.grievanceOfficer.email}`}>{brand.grievanceOfficer.email}</a> · we answer within 90 days at most, usually within a week.</div></div>
      <ul className="list">
        {(list.data ?? []).map((g) => (
          <li key={g.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <div className="grow stack" style={{ '--gap': '4px' } as React.CSSProperties}>
              <div className="small"><span className="strong num">{g.reference}</span> <Badge tone={STATUS_TONE[g.status]}>{STATUS_LABEL[g.status]}</Badge></div>
              <div className="xs muted">{GRIEVANCE_CATEGORIES.find((c) => c.value === g.category)?.label} · raised {fmtDateTime(g.createdAt)}{g.status !== 'resolved' ? ` · answer by ${fmtDate(g.respondBy)}` : ''}</div>
              {g.response && <div className="small brief-note">{g.response}</div>}
            </div>
          </li>
        ))}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Raise a grievance" size="sm"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Send</Button></>}>
        <div className="stack">
          <Field label="What is it about?">{(p) => <Select {...p} value={category} onChange={(e) => setCategory(e.target.value as Grievance['category'])} options={GRIEVANCE_CATEGORIES} />}</Field>
          <Field label="Tell us what happened" required>{(p) => <Textarea {...p} rows={5} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
          <p className="xs muted">You’ll get a reference number. If you’re not satisfied with our answer, you can complain to the Data Protection Board of India.</p>
          <InlineError message={err} />
        </div>
      </Modal>
    </Card>
  );
}

function DeleteAccountCard() {
  const toast = useToast();
  const req = useLive(() => privacyService.deletionRequest(), []);
  const [confirm, setConfirm] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [reason, setReason] = useState('');
  const pending = req.data;
  return (
    <Card title="Delete my account" className="danger-zone">
      {pending ? (
        <div className="list-item" style={{ alignItems: 'flex-start' }}>
          <span className="type-icon sm tone-danger"><Trash2 aria-hidden /></span>
          <div className="grow small"><span className="strong">Your account will be erased on {fmtDate(pending.eraseAfter)}.</span><br /><span className="muted">Doctors’ access was ended. You can still use {brand.name} and cancel until then.</span></div>
          <Button size="sm" icon={Undo2} onClick={async () => { try { await privacyService.cancelDeletion(); toast('Deletion cancelled'); req.reload(); } catch (e) { toast(friendlyError(e), 'error'); } }}>Cancel deletion</Button>
        </div>
      ) : (
        <div className="list-item">
          <span className="type-icon sm tone-danger"><Trash2 aria-hidden /></span>
          <div className="grow small muted">Erases your account, record, documents, consents and logs {DELETION_DAYS} days after you ask. Download your data first if you want to keep it.</div>
          <Button size="sm" variant="danger-ghost" onClick={() => setConfirm(true)}>Delete account</Button>
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Delete your account?" size="sm"
        footer={<><Button onClick={() => setConfirm(false)}>Keep my account</Button><Button variant="danger" onClick={() => { setConfirm(false); setCodeOpen(true); }}>Continue</Button></>}>
        <div className="stack">
          <p className="small">Everything is erased {DELETION_DAYS} days from now and can’t be recovered after that. Doctors lose access straight away. Entries doctors added for you are erased too — ask them for copies if you need them.</p>
          <Field label="Why are you leaving? (optional)">{(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </div>
      </Modal>
      <OtpDialog open={codeOpen} onClose={() => setCodeOpen(false)} title="Confirm it’s you" confirmLabel="Delete my account"
        request={() => privacyService.requestDeletionCode()}
        onVerify={async (_c, code) => { await privacyService.requestDeletion(code, reason); setCodeOpen(false); toast(`Your account will be erased in ${DELETION_DAYS} days`); req.reload(); }} />
    </Card>
  );
}
