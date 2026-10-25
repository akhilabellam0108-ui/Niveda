import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Baby, Copy, HeartHandshake, KeyRound, LogOut, Plus, UserPlus, UsersRound, FolderOpen, Check, X } from 'lucide-react';
import type { GuardianRelationship, Patient } from '../../types';
import { DELIVERY_TYPES, HANDOVER_DAYS, RELATIONSHIPS, familyService, relationshipLabel, validateChild, type ManagedProfile, type NewChildInput } from '../../services';
import { friendlyError } from '../../services/core';
import { useSession } from '../../state/SessionContext';
import { useDocumentTitle, useLive } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { ageLabel } from '../../lib/immunization';
import { fmtDate, todayISO } from '../../lib/dates';
import { BLOOD_GROUPS } from '../auth/Onboarding';
import { useSwitchProfile } from '../../components/family/ProfileSwitcher';
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, InlineError, Input, Modal, Select, SkeletonList, Textarea } from '../../components/ui';

import { t } from '../../i18n';
import { T } from '../../i18n/T';

const relOptions = RELATIONSHIPS.map((r) => ({ value: r.value, label: r.label }));

export function FamilyPage() {
  useDocumentTitle(t('Family'));
  const { family, managing, refresh } = useSession();
  const live = useLive(() => familyService.overview(), []);
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get('add') === '1');
  const [inviteFor, setInviteFor] = useState<ManagedProfile | null>(null);
  const [handoverFor, setHandoverFor] = useState<ManagedProfile | null>(null);
  const [leaving, setLeaving] = useState<ManagedProfile | null>(null);
  const [answering, setAnswering] = useState<{ id: string; childName: string } | null>(null);
  const switchTo = useSwitchProfile();
  const toast = useToast();
  useEffect(() => { if (params.get('add') === '1') { setAdding(true); setParams((p) => { const n = new URLSearchParams(p); n.delete('add'); return n; }, { replace: true }); } }, [params, setParams]);

  const o = live.data ?? family;
  const today = todayISO();
  const reload = async () => { live.reload(); await refresh(); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Family')}</h1>
          <p>{t('Keep your children’s health records from birth — vaccines, visits, medicines. When a child turns 18, you hand the record over and it becomes theirs.')}</p>
        </div>
        <div className="actions">
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)} disabled={managing}>{t('Add a child')}</Button>
        </div>
      </div>
      {managing && <div className="alert alert-info"><Baby aria-hidden /><div>{t('Switch back to your own record to add a child or change who manages a record.')}</div></div>}

      {live.error && !o ? <ErrorState error={live.error} onRetry={live.reload} /> : !o ? <SkeletonList rows={2} /> : (
        <>
          {o.invitations.length > 0 && (
            <Card title={t('Invitations')} pad>
              <div className="stack">
                {o.invitations.map((i) => (
                  <div key={i.id} className="list-item" style={{ alignItems: 'center' }}>
                    <span className="type-icon tone-accent" aria-hidden><HeartHandshake /></span>
                    <div className="grow small">
                      <T text="{from} asked you to help manage {child}’s health record as their {relationship}." from={<b>{i.from}</b>} child={<b>{i.childName}</b>} relationship={relationshipLabel(i.relationship).toLowerCase()} />
                      <div className="xs muted">{t('Born {date}', { date: fmtDate(i.childDob) })}</div>
                    </div>
                    <Button size="sm" variant="primary" icon={Check} onClick={() => setAnswering({ id: i.id, childName: i.childName })}>{t('Review')}</Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <section className="stack">
            <h2>{t('Children’s records you keep')}</h2>
            {o.managed.filter((m) => m.kind === 'guardian').length === 0 ? (
              <EmptyState icon={Baby} title={t('No children’s records yet')}
                body={t('Add a child to start their record from birth. They don’t need an account: you keep the record until they turn 18.')}
                action={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)} disabled={managing}>{t('Add a child')}</Button>} />
            ) : o.managed.filter((m) => m.kind === 'guardian').map((m) => (
              <ChildCard key={m.patient.id} m={m} today={today} active={o.activeId === m.patient.id}
                onOpen={() => void switchTo(m.patient.id)} onInvite={() => setInviteFor(m)} onHandover={() => setHandoverFor(m)} onLeave={() => setLeaving(m)} />
            ))}
          </section>

          {o.managed.some((m) => m.kind === 'carer') && (
            <section className="stack">
              <h2>{t('Records you help with')}</h2>
              {o.managed.filter((m) => m.kind === 'carer').map((m) => (
                <div key={m.patient.id} className="card list-item" style={{ alignItems: 'center' }}>
                  <Avatar name={m.patient.fullName} src={m.patient.photoDataUrl} />
                  <div className="grow"><div className="strong">{m.patient.fullName}</div><div className="xs muted">{t('They asked you to keep helping with their record.')}</div></div>
                  <Button size="sm" icon={FolderOpen} onClick={() => void switchTo(m.patient.id)}>{t('Open record')}</Button>
                  <Button size="sm" variant="ghost" icon={LogOut} onClick={() => setLeaving(m)}>{t('Stop helping')}</Button>
                </div>
              ))}
            </section>
          )}

          {!managing && (o.carers.length > 0 || o.formerGuardians.length > 0) && (
            <Card title={t('People who can manage your record')} pad>
              <div className="stack">
                {o.carers.map((c) => (
                  <div key={c.guardianshipId} className="list-item" style={{ alignItems: 'center' }}>
                    <Avatar name={c.name} size="sm" />
                    <div className="grow"><div className="strong small">{c.name}</div><div className="xs muted">{relationshipLabel(c.relationship)} · {t('Can see and add to your record')}</div></div>
                    <Button size="sm" variant="ghost" icon={X} onClick={async () => { try { await familyService.removeCarer(c.guardianshipId); toast(t('{name} no longer has access', { name: c.name })); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } }}>{t('Remove')}</Button>
                  </div>
                ))}
                {o.formerGuardians.length > 0 && (
                  <>
                    <p className="small muted">{t('Your record is yours now. The parents or guardians who kept it no longer have access. You can let one of them keep helping — for example with appointments — and stop it any time.')}</p>
                    {o.formerGuardians.map((g) => (
                      <div key={g.guardianshipId} className="list-item" style={{ alignItems: 'center' }}>
                        <Avatar name={g.name} size="sm" />
                        <div className="grow"><div className="strong small">{g.name}</div><div className="xs muted">{relationshipLabel(g.relationship)} · {t('No access')}</div></div>
                        <Button size="sm" icon={HeartHandshake} onClick={async () => { try { await familyService.keepHelping(g.id); toast(t('{name} can help manage your record', { name: g.name })); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } }}>{t('Let them keep helping')}</Button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </Card>
          )}
        </>
      )}

      <AddChildDialog open={adding} onClose={() => setAdding(false)} onAdded={async (child) => { setAdding(false); await reload(); toast(t('{name}’s record is ready', { name: child.fullName })); }} onOpen={(id) => void switchTo(id)} />
      <InviteGuardianDialog m={inviteFor} onClose={() => setInviteFor(null)} onDone={async () => { setInviteFor(null); toast(t('Invitation sent')); await reload(); }} />
      <HandoverDialog m={handoverFor} onClose={() => { setHandoverFor(null); void reload(); }} />
      <InvitationDialog inv={answering} onClose={() => setAnswering(null)} onDone={async (accepted) => { setAnswering(null); toast(accepted ? t('You can now open this record') : t('Invitation declined')); await reload(); }} />
      <ConfirmDialog open={!!leaving} onClose={() => setLeaving(null)} danger confirmLabel={t('Stop managing')}
        title={leaving ? t('Stop managing {name}’s record?', { name: leaving.patient.fullName }) : ''}
        body={t('You won’t be able to open the record any more. Everything you added stays in it with your name.')}
        onConfirm={async () => { await familyService.leave(leaving!.patient.id); await reload(); }} />
    </>
  );
}

function ChildCard({ m, today, active, onOpen, onInvite, onHandover, onLeave }: { m: ManagedProfile; today: string; active: boolean; onOpen: () => void; onInvite: () => void; onHandover: () => void; onLeave: () => void }) {
  const p = m.patient;
  return (
    <div className="card" style={{ padding: 'var(--s5)' }}>
      <div className="row" style={{ alignItems: 'center', gap: 'var(--s4)', flexWrap: 'wrap' }}>
        <Avatar name={p.fullName} src={p.photoDataUrl} size="lg" />
        <div className="grow" style={{ minWidth: 180 }}>
          <div className="strong" style={{ fontSize: 'var(--t-lg)' }}>{p.fullName}</div>
          <div className="small muted">{ageLabel(p.dateOfBirth, today)} · {t('Born {date}', { date: fmtDate(p.dateOfBirth) })} · <span className="num">{p.patientCode}</span></div>
        </div>
        {active ? <Badge tone="accent">{t('Open now')}</Badge> : <Button variant="primary" icon={FolderOpen} onClick={onOpen}>{t('Open record')}</Button>}
      </div>
      <div className="stack" style={{ '--gap': '6px', marginTop: 'var(--s4)' } as React.CSSProperties}>
        <div className="xs subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t('Parents and guardians')}</div>
        {m.guardians.map((g) => (
          <div key={g.guardianshipId} className="small">
            <UsersRound size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />
            <b>{g.isYou ? t('You') : g.name}</b> · {relationshipLabel(g.relationship)}
            {g.status === 'invited' && <> · <Badge tone="warn">{t('Invited')}</Badge></>}
          </div>
        ))}
      </div>
      {m.canHandOver && (
        <div className="alert alert-accent" style={{ marginTop: 'var(--s4)' }}>
          <KeyRound aria-hidden />
          <div className="grow">
            <div className="alert-title">{t('{name} has turned 18', { name: p.fullName })}</div>
            {m.handover
              ? t('A handover code is waiting to be used (until {date}). If it was lost, make a new one.', { date: fmtDate(m.handover.expiresAt) })
              : t('Hand the record over so it becomes theirs. Your access ends when they take it over.')}
          </div>
          <Button size="sm" variant="primary" onClick={onHandover}>{m.handover ? t('Make a new code') : t('Hand over')}</Button>
        </div>
      )}
      <div className="row" style={{ marginTop: 'var(--s4)', gap: 'var(--s2)', flexWrap: 'wrap' }}>
        <Button size="sm" icon={UserPlus} onClick={onInvite}>{t('Invite another parent or guardian')}</Button>
        <Button size="sm" variant="ghost" icon={LogOut} onClick={onLeave}>{t('Stop managing')}</Button>
      </div>
    </div>
  );
}

const EMPTY: NewChildInput = { fullName: '', dateOfBirth: '', sex: '', bloodGroup: '', relationship: '' as GuardianRelationship, declared: false, birthDetails: {} };

function AddChildDialog({ open, onClose, onAdded, onOpen }: { open: boolean; onClose: () => void; onAdded: (p: Patient) => void; onOpen: (id: string) => void }) {
  const [f, setF] = useState<NewChildInput>(EMPTY);
  const [birth, setBirth] = useState({ place: '', weightKg: '', lengthCm: '', headCm: '', gestationWeeks: '', delivery: '', notes: '' });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Patient | null>(null);
  useEffect(() => { if (open) { setF(EMPTY); setBirth({ place: '', weightKg: '', lengthCm: '', headCm: '', gestationWeeks: '', delivery: '', notes: '' }); setErr(undefined); setDone(null); } }, [open]);
  const set = <K extends keyof NewChildInput>(k: K, v: NewChildInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
  const save = async () => {
    const input: NewChildInput = { ...f, birthDetails: { place: birth.place, delivery: birth.delivery, notes: birth.notes, weightKg: num(birth.weightKg), lengthCm: num(birth.lengthCm), headCm: num(birth.headCm), gestationWeeks: num(birth.gestationWeeks) } };
    const problem = validateChild(input);
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr(undefined);
    try {
      const child = await familyService.createChild(input);
      setDone(child);
      onAdded(child);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <Modal open={open} onClose={onClose} title={t('{name}’s record is ready', { name: done.fullName })} size="sm"
        footer={<><Button onClick={onClose}>{t('Later')}</Button><Button variant="primary" icon={FolderOpen} onClick={() => onOpen(done.id)}>{t('Open {name}’s record', { name: done.fullName.split(' ')[0] })}</Button></>}>
        <p className="muted">{t('Open the record to add vaccines already given, visits and medicines. Share it with a doctor the same way as your own — only doctors you approve can see it.')}</p>
      </Modal>
    );
  }
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={t('Add a child')} description={t('A child doesn’t need an account. You keep the record until they turn 18.')}
      footer={<><Button onClick={onClose} disabled={busy}>{t('Cancel')}</Button><Button variant="primary" onClick={save} loading={busy}>{t('Create record')}</Button></>}>
      <div className="stack">
        <Field label={t('Child’s full name')} required>{(p) => <Input {...p} value={f.fullName} onChange={(e) => set('fullName', e.target.value)} autoComplete="off" />}</Field>
        <div className="form-grid">
          <Field label={t('Date of birth')} required>{(p) => <Input {...p} type="date" max={todayISO()} value={f.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />}</Field>
          <Field label={t('You are their')} required>{(p) => <Select {...p} value={f.relationship} onChange={(e) => set('relationship', e.target.value as GuardianRelationship)} placeholder={t('Select…')} options={relOptions} />}</Field>
          <Field label={t('Sex')}>{(p) => <Select {...p} value={f.sex ?? ''} onChange={(e) => set('sex', e.target.value as Patient['sex'])} placeholder={t('Prefer not to say')} options={[{ value: 'female', label: t('Female') }, { value: 'male', label: t('Male') }, { value: 'other', label: t('Other') }]} />}</Field>
          <Field label={t('Blood group')}>{(p) => <Select {...p} value={f.bloodGroup ?? ''} onChange={(e) => set('bloodGroup', e.target.value)} placeholder={t('Not sure')} options={BLOOD_GROUPS} />}</Field>
        </div>
        <details className="card" style={{ padding: 'var(--s4)' }}>
          <summary className="strong small" style={{ cursor: 'pointer' }}>{t('Birth details (optional)')}</summary>
          <div className="stack" style={{ marginTop: 'var(--s3)' }}>
            <Field label={t('Place of birth')}>{(p) => <Input {...p} value={birth.place} onChange={(e) => setBirth({ ...birth, place: e.target.value })} placeholder={t('Hospital or town')} />}</Field>
            <div className="form-grid">
              <Field label={t('Birth weight (kg)')}>{(p) => <Input {...p} inputMode="decimal" value={birth.weightKg} onChange={(e) => setBirth({ ...birth, weightKg: e.target.value })} placeholder="3.2" />}</Field>
              <Field label={t('Length (cm)')}>{(p) => <Input {...p} inputMode="decimal" value={birth.lengthCm} onChange={(e) => setBirth({ ...birth, lengthCm: e.target.value })} placeholder="50" />}</Field>
              <Field label={t('Head circumference (cm)')}>{(p) => <Input {...p} inputMode="decimal" value={birth.headCm} onChange={(e) => setBirth({ ...birth, headCm: e.target.value })} placeholder="34" />}</Field>
              <Field label={t('Weeks of pregnancy at birth')}>{(p) => <Input {...p} inputMode="numeric" value={birth.gestationWeeks} onChange={(e) => setBirth({ ...birth, gestationWeeks: e.target.value })} placeholder="39" />}</Field>
            </div>
            <Field label={t('Delivery')}>{(p) => <Select {...p} value={birth.delivery} onChange={(e) => setBirth({ ...birth, delivery: e.target.value })} placeholder={t('Select…')} options={DELIVERY_TYPES} />}</Field>
            <Field label={t('Notes')}>{(p) => <Textarea {...p} rows={2} value={birth.notes} onChange={(e) => setBirth({ ...birth, notes: e.target.value })} placeholder={t('e.g. needed phototherapy for jaundice')} />}</Field>
          </div>
        </details>
        <label className="check">
          <input type="checkbox" checked={f.declared} onChange={(e) => set('declared', e.target.checked)} />
          <span className="small">{t('I am this child’s parent or legal guardian. I agree to keep their health record in Niveda on their behalf until they turn 18, under the privacy notice.')}</span>
        </label>
        {err && <InlineError message={err} />}
      </div>
    </Modal>
  );
}

function InviteGuardianDialog({ m, onClose, onDone }: { m: ManagedProfile | null; onClose: () => void; onDone: () => void }) {
  const [contact, setContact] = useState('');
  const [rel, setRel] = useState<GuardianRelationship | ''>('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { setContact(''); setRel(''); setErr(undefined); }, [m]);
  const send = async () => {
    setBusy(true); setErr(undefined);
    try { await familyService.inviteGuardian(m!.patient.id, contact, rel as GuardianRelationship); onDone(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!m} onClose={() => !busy && onClose()} title={m ? t('Invite someone to help manage {name}’s record', { name: m.patient.fullName }) : ''}
      description={t('They need their own Niveda account. They’ll be asked to confirm they are the child’s parent or guardian, and everything they do is logged with their name.')}
      footer={<><Button onClick={onClose} disabled={busy}>{t('Cancel')}</Button><Button variant="primary" icon={UserPlus} onClick={send} loading={busy} disabled={!contact.trim() || !rel}>{t('Send invitation')}</Button></>}>
      <div className="stack">
        <Field label={t('Their email or mobile number')} required>{(p) => <Input {...p} value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="off" />}</Field>
        <Field label={t('They are the child’s')} required>{(p) => <Select {...p} value={rel} onChange={(e) => setRel(e.target.value as GuardianRelationship)} placeholder={t('Select…')} options={relOptions} />}</Field>
        {err && <InlineError message={err} />}
      </div>
    </Modal>
  );
}

function InvitationDialog({ inv, onClose, onDone }: { inv: { id: string; childName: string } | null; onClose: () => void; onDone: (accepted: boolean) => void }) {
  const [declared, setDeclared] = useState(false);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  useEffect(() => { setDeclared(false); setErr(undefined); }, [inv]);
  const answer = async (accept: boolean) => {
    setBusy(accept ? 'yes' : 'no'); setErr(undefined);
    try { await familyService.respondToInvitation(inv!.id, accept, declared); onDone(accept); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(null); }
  };
  return (
    <Modal open={!!inv} onClose={() => !busy && onClose()} title={inv ? t('Help manage {name}’s record?', { name: inv.childName }) : ''} size="sm"
      footer={<><Button onClick={() => answer(false)} loading={busy === 'no'} disabled={!!busy}>{t('Decline')}</Button><Button variant="primary" onClick={() => answer(true)} loading={busy === 'yes'} disabled={!declared || !!busy}>{t('Accept')}</Button></>}>
      <div className="stack">
        <p className="muted small">{t('You’ll be able to see and add to the record, share it with doctors and get its reminders. Everything you do is logged with your name.')}</p>
        <label className="check"><input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} /><span className="small">{t('I am this child’s parent or legal guardian.')}</span></label>
        {err && <InlineError message={err} />}
      </div>
    </Modal>
  );
}

function HandoverDialog({ m, onClose }: { m: ManagedProfile | null; onClose: () => void }) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { setCode(null); setErr(undefined); }, [m]);
  if (!m) return null;
  const name = m.patient.fullName;
  const make = async () => {
    setBusy(true); setErr(undefined);
    try { setCode(await familyService.startHandover(m.patient.id)); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={() => !busy && onClose()} title={t('Hand over {name}’s record', { name })}
      footer={code ? <Button variant="primary" onClick={onClose}>{t('Done')}</Button> : <><Button onClick={onClose} disabled={busy}>{t('Cancel')}</Button><Button variant="primary" icon={KeyRound} onClick={make} loading={busy}>{t('Make a handover code')}</Button></>}>
      {!code ? (
        <div className="stack">
          <p className="muted">{t('{name} is an adult now, so the record should be theirs. A handover code lets them take it over with their own account.', { name })}</p>
          <ol className="small stack" style={{ '--gap': '6px', paddingLeft: 18 } as React.CSSProperties}>
            <li>{t('You give {name} the code (it works for {days} days, once).', { name, days: HANDOVER_DAYS })}</li>
            <li>{t('They sign up with their own email and phone, the same date of birth, and the code.')}</li>
            <li>{t('Every entry since birth becomes theirs. Your access — and every other guardian’s — ends. They can ask you to keep helping.')}</li>
          </ol>
          {err && <InlineError message={err} />}
        </div>
      ) : (
        <div className="stack" style={{ textAlign: 'center' }}>
          <p className="muted small">{t('Give this code to {name}. It is shown only once.', { name })}</p>
          <div className="num" style={{ fontSize: 'var(--t-2xl)', fontWeight: 700, letterSpacing: '.06em', userSelect: 'all' }}>{code.code}</div>
          <div><Button size="sm" icon={Copy} onClick={() => { void navigator.clipboard?.writeText(code.code).then(() => toast(t('Code copied'))); }}>{t('Copy code')}</Button></div>
          <p className="xs subtle">{t('Works until {date}. Making a new code cancels this one.', { date: fmtDate(code.expiresAt) })}</p>
        </div>
      )}
    </Modal>
  );
}
