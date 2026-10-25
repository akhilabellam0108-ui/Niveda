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

import { t } from '../../i18n';
import { T } from '../../i18n/T';
/** Rights under India's DPDP Act: consent, nominee, grievances and erasure. */
export function YourRights() {
  const { user, managing, patient } = useSession();
  return (
    <>
      <div className="section-title"><h2>{t('Your data rights')}</h2><p className="small muted"><T text="Under India’s Digital Personal Data Protection Act. Read the {notice}." notice={<Link to="/legal/privacy" target="_blank">{t('privacy notice')}</Link>} /></p></div>
      {managing && patient && (
        <div className="alert alert-info"><UserCheck aria-hidden /><div>{t('Consents and complaints here are for your own account. A nominee and account deletion can only be changed from your own record — switch back to it to change them. Guardians for {name} are managed in Family & guardians.', { name: patient.fullName })} <Link to="/app/family">{t('Family & guardians')}</Link></div></div>
      )}
      <ConsentsCard />
      {user?.role === 'patient' && !managing && <NomineeCard />}
      <GrievancesCard />
      <Card title={t('Your data, to keep')}><div className="list-item"><span className="type-icon sm"><Download aria-hidden /></span><div className="grow small">{t('Download everything we hold about you — your record, documents and access log.')}</div><Link className="btn btn-sm btn-secondary" to={user?.role === 'patient' ? '/app/settings/export' : '/doctor/settings/account'}>{t('Export')}</Link></div></Card>
      {!managing && <DeleteAccountCard />}
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
    try { await privacyService.setConsent(purpose, on); toast(on ? t('Consent given') : t('Consent withdrawn')); consents.reload(); } catch (e) { toast(friendlyError(e), 'error'); } finally { setBusy(undefined); }
  };
  return (
    <Card title={t('What you’ve agreed to')}>
      <ul className="list">
        {CONSENT_PURPOSES.map((c) => (
          <li key={c.purpose} className="list-item">
            <span className="type-icon sm"><HeartHandshake aria-hidden /></span>
            <div className="grow">
              <div className="strong small">{c.title} {c.required && <Badge>{t('Required')}</Badge>}</div>
              <div className="xs muted">{c.body}{changed(c.purpose) ? ` · ${t('last changed {date}', { date: fmtDate(changed(c.purpose)!) })}` : ''}</div>
            </div>
            {c.required ? <Badge tone="ok">{t('On')}</Badge> : (
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" aria-label={c.title} checked={granted(c.purpose)} disabled={!consents.data || busy === c.purpose} onChange={(e) => void set(c.purpose, e.target.checked)} />
                <span className="xs">{granted(c.purpose) ? t('On') : t('Off')}</span>
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
    <Card title={t('Nominee')} action={<Button size="sm" onClick={() => setOpen(true)}>{n ? t('Change') : t('Add nominee')}</Button>}>
      <div className="list-item">
        <span className="type-icon sm"><UserCheck aria-hidden /></span>
        <div className="grow small">
          {n ? <><span className="strong">{n.name}</span> <span className="muted">· {n.relationship} · {n.phone}</span></> : <span className="muted">{t('Someone who can exercise your data rights if you die or can’t act yourself.')}</span>}
        </div>
        {n && <Button size="sm" variant="ghost" onClick={async () => { try { await privacyService.setNominee(null); toast(t('Nominee removed')); nominee.reload(); } catch (e) { toast(friendlyError(e), 'error'); } }}>{t('Remove')}</Button>}
      </div>
      <NomineeDialog open={open} initial={n ?? undefined} onClose={() => setOpen(false)} onSaved={() => { nominee.reload(); toast(t('Nominee saved')); }} />
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
    <Modal open={open} onClose={onClose} title={t('Your nominee')} size="sm" description={t('They can ask us to correct, export or erase your data on your behalf, but only after showing proof (for example a death certificate or medical certificate).')}
      footer={<><Button onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" loading={busy} onClick={save}>{t('Save')}</Button></>}>
      <div className="stack">
        <Field label={t('Name')} required>{(p) => <Input {...p} value={f.name} onChange={set('name')} />}</Field>
        <div className="form-grid">
          <Field label={t('Relationship')} required>{(p) => <Input {...p} value={f.relationship} onChange={set('relationship')} />}</Field>
          <Field label={t('Phone')} required>{(p) => <Input {...p} type="tel" value={f.phone} onChange={set('phone')} />}</Field>
        </div>
        <Field label={t('Email')}>{(p) => <Input {...p} type="email" value={f.email ?? ''} onChange={set('email')} />}</Field>
        <InlineError message={err} />
      </div>
    </Modal>
  );
}

const STATUS_TONE: Record<Grievance['status'], 'warn' | 'info' | 'ok'> = { open: 'warn', in_progress: 'info', resolved: 'ok' };
const STATUS_LABEL: Record<Grievance['status'], string> = { open: 'Open', in_progress: t('In progress'), resolved: 'Answered' };

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
      toast(t('Received — reference {reference}', { reference: g.reference }));
      setText(''); setOpen(false); list.reload();
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Card title={t('Grievances')} action={<Button size="sm" icon={MessageSquareWarning} onClick={() => setOpen(true)}>{t('Raise a grievance')}</Button>}>
      <div className="list-item"><div className="grow xs muted">{brand.grievanceOfficer.name} · <a href={`mailto:${brand.grievanceOfficer.email}`}>{brand.grievanceOfficer.email}</a> · {t('we answer within 90 days at most, usually within a week.')}</div></div>
      <ul className="list">
        {(list.data ?? []).map((g) => (
          <li key={g.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <div className="grow stack" style={{ '--gap': '4px' } as React.CSSProperties}>
              <div className="small"><span className="strong num">{g.reference}</span> <Badge tone={STATUS_TONE[g.status]}>{STATUS_LABEL[g.status]}</Badge></div>
              <div className="xs muted">{GRIEVANCE_CATEGORIES.find((c) => c.value === g.category)?.label} · {t('raised {date}', { date: fmtDateTime(g.createdAt) })}{g.status !== 'resolved' ? ` · ${t('answer by {date}', { date: fmtDate(g.respondBy) })}` : ''}</div>
              {g.response && <div className="small brief-note">{g.response}</div>}
            </div>
          </li>
        ))}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title={t('Raise a grievance')} size="sm"
        footer={<><Button onClick={() => setOpen(false)}>{t('Cancel')}</Button><Button variant="primary" loading={busy} onClick={submit}>{t('Send')}</Button></>}>
        <div className="stack">
          <Field label={t('What is it about?')}>{(p) => <Select {...p} value={category} onChange={(e) => setCategory(e.target.value as Grievance['category'])} options={GRIEVANCE_CATEGORIES} />}</Field>
          <Field label={t('Tell us what happened')} required>{(p) => <Textarea {...p} rows={5} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
          <p className="xs muted">{t('You’ll get a reference number. If you’re not satisfied with our answer, you can complain to the Data Protection Board of India.')}</p>
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
    <Card title={t('Delete my account')} className="danger-zone">
      {pending ? (
        <div className="list-item" style={{ alignItems: 'flex-start' }}>
          <span className="type-icon sm tone-danger"><Trash2 aria-hidden /></span>
          <div className="grow small"><span className="strong">{t('Your account will be erased on {date}.', { date: fmtDate(pending.eraseAfter) })}</span><br /><span className="muted">{t('Doctors’ access was ended. You can still use {app} and cancel until then.', { app: brand.name })}</span></div>
          <Button size="sm" icon={Undo2} onClick={async () => { try { await privacyService.cancelDeletion(); toast(t('Deletion cancelled')); req.reload(); } catch (e) { toast(friendlyError(e), 'error'); } }}>{t('Cancel deletion')}</Button>
        </div>
      ) : (
        <div className="list-item">
          <span className="type-icon sm tone-danger"><Trash2 aria-hidden /></span>
          <div className="grow small muted">{t('Erases your account, record, documents, consents and logs {n} days after you ask. Download your data first if you want to keep it.', { n: DELETION_DAYS })}</div>
          <Button size="sm" variant="danger-ghost" onClick={() => setConfirm(true)}>{t('Delete account')}</Button>
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('Delete your account?')} size="sm"
        footer={<><Button onClick={() => setConfirm(false)}>{t('Keep my account')}</Button><Button variant="danger" onClick={() => { setConfirm(false); setCodeOpen(true); }}>{t('Continue')}</Button></>}>
        <div className="stack">
          <p className="small">{t('Everything is erased {n} days from now and can’t be recovered after that. Doctors lose access straight away. Entries doctors added for you are erased too — ask them for copies if you need them.', { n: DELETION_DAYS })}</p>
          <Field label={t('Why are you leaving? (optional)')}>{(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </div>
      </Modal>
      <OtpDialog open={codeOpen} onClose={() => setCodeOpen(false)} title={t('Confirm it’s you')} confirmLabel={t('Delete my account')}
        request={() => privacyService.requestDeletionCode()}
        onVerify={async (_c, code) => { await privacyService.requestDeletion(code, reason); setCodeOpen(false); toast(t('Your account will be erased in {DELETION_DAYS} days', { DELETION_DAYS })); req.reload(); }} />
    </Card>
  );
}
