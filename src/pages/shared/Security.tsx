import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LockKeyhole, ShieldCheck, Eye, Clock3, ScrollText, Smartphone, Laptop, Monitor, KeyRound, LogOut, Fingerprint, Info, ShieldOff, MessageSquare } from 'lucide-react';
import { isLive, type OtpChallenge } from '../../services';
import { OtpInput, PrototypeCode } from '../../components/ui/Otp';
import { YourRights } from '../../components/privacy/YourRights';
import { accessService, auditService, authService, friendlyError } from '../../services';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useSession } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { brand } from '../../config/brand';
import { fmtDateTime, relativeTime, timeLeft } from '../../lib/dates';
import { Avatar, Badge, Button, Card, ConfirmDialog, Field, InlineError, Input, Modal, SkeletonList } from '../../components/ui';
import { PermissionBadges } from '../../components/access/PermissionSelector';
import { ACTION_LABEL } from '../patient/Activity';

import { t } from '../../i18n';
import { T } from '../../i18n/T';
/** Sessions, sign-in history and password — shared by patients and doctors. */
export function SecuritySection() {
  const toast = useToast();
  const sessions = useLive(() => authService.listSessions(), []);
  const signIns = useLive(() => auditService.signIns(), []);
  const phone = useLive(() => authService.phoneStatus(), []);
  const [pwOpen, setPwOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const deviceIcon = (d: string) => (/Android|iOS|Pixel|iPhone/.test(d) ? Smartphone : /laptop|Windows|macOS/i.test(d) ? Laptop : Monitor);
  return (
    <>
      <Card title={t('Signed-in devices')} action={(sessions.data?.length ?? 0) > 1 ? <Button size="sm" variant="danger-ghost" icon={LogOut} onClick={() => setConfirmAll(true)}>{t('Sign out others')}</Button> : undefined}>
        {!sessions.data ? <SkeletonList rows={2} card={false} /> : (
          <ul className="list">
            {sessions.data.map((s) => {
              const Icon = deviceIcon(s.device);
              return (
                <li key={s.id} className="list-item">
                  <span className="type-icon sm"><Icon aria-hidden /></span>
                  <div className="grow"><div className="strong small">{s.device === 'Unknown device' || s.device === 'Test runner' ? t(s.device) : s.device} {s.current && <Badge tone="ok">{t('This device')}</Badge>}</div><div className="xs muted">{s.location === 'This device' || s.location === 'Unknown location' ? t(s.location) : s.location} · {t('active {time}', { time: relativeTime(s.lastActiveAt) })}</div></div>
                  {!s.current && <Button size="sm" variant="ghost" onClick={async () => { try { await authService.revokeSession(s.id); toast(t('Device signed out')); } catch (e) { toast(friendlyError(e), 'error'); } }}>{t('Sign out')}</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title={t('Password & verification')}>
        <ul className="list">
          <li className="list-item"><span className="type-icon sm"><KeyRound aria-hidden /></span><div className="grow"><div className="strong small">{t('Password')}</div><div className="xs muted">{t('Use a unique password you don’t use elsewhere.')}</div></div><Button size="sm" onClick={() => setPwOpen(true)}>{t('Change')}</Button></li>
          <li className="list-item"><span className="type-icon sm tone-ok"><Fingerprint aria-hidden /></span><div className="grow"><div className="strong small">{t('One-time codes')}</div><div className="xs muted">{t('Required to sign in, grant access, approve requests and share more.')}</div></div><Badge tone="ok">{t('On')}</Badge></li>
          {phone.data?.smsEnabled && (
            <li className="list-item"><span className="type-icon sm"><MessageSquare aria-hidden /></span>
              <div className="grow"><div className="strong small">{t('Codes by text message')}</div>
                <div className="xs muted">{phone.data.verified ? t('Codes are texted to {phone}.', { phone: phone.data.phone }) : t('Verify your mobile number to get codes by SMS instead of email.')}</div></div>
              <Button size="sm" onClick={() => setPhoneOpen(true)}>{phone.data.verified ? t('Change number') : t('Verify phone')}</Button></li>
          )}
        </ul>
      </Card>
      <Card title={t('Recent sign-ins')}>
        {!signIns.data ? <SkeletonList rows={3} card={false} /> : (
          <ul className="list">
            {signIns.data.slice(0, 8).map((a) => (
              <li key={a.id} className="list-item">
                <div className="grow small">{ACTION_LABEL[a.action]}<span className="muted"> · {a.target?.label}</span></div>
                <span className="xs subtle nowrap">{fmtDateTime(a.timestamp)}</span>
              </li>
            ))}
            {signIns.data.length === 0 && <li className="list-item small subtle">{t('No sign-ins recorded yet.')}</li>}
          </ul>
        )}
      </Card>
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
      <VerifyPhone open={phoneOpen} initial={phone.data?.phone ?? ''} onClose={() => setPhoneOpen(false)} />
      <ConfirmDialog open={confirmAll} onClose={() => setConfirmAll(false)} danger confirmLabel={t('Sign out other devices')} title={t('Sign out everywhere else?')}
        body={t('Every other device will need to sign in again with your password and a one-time code.')}
        onConfirm={async () => { const n = await authService.revokeOtherSessions(); toast(n === 1 ? t('Signed out 1 device') : t('Signed out {n} devices', { n })); }} />
    </>
  );
}

function VerifyPhone({ open, initial, onClose }: { open: boolean; initial: string; onClose: () => void }) {
  const toast = useToast();
  const [number, setNumber] = useState(initial);
  const [challenge, setChallenge] = useState<OtpChallenge>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const close = () => { setChallenge(undefined); setCode(''); setErr(undefined); onClose(); };
  const send = async () => {
    setBusy(true); setErr(undefined);
    try { setChallenge(await authService.startPhoneVerification(number || initial)); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const confirm = async (c = code) => {
    setBusy(true); setErr(undefined);
    try { await authService.confirmPhone(c); toast(t('Phone verified — codes will now come by SMS')); close(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={close} title={t('Codes by text message')} size="sm"
      footer={<><Button onClick={close}>{t('Cancel')}</Button>{challenge
        ? <Button variant="primary" loading={busy} onClick={() => confirm()}>{t('Verify')}</Button>
        : <Button variant="primary" loading={busy} onClick={send}>{t('Send code')}</Button>}</>}>
      <div className="stack">
        {!challenge ? (
          <Field label={t('Mobile number')} help={t('Indian numbers can be typed without +91.')}>{(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" value={number || initial} onChange={(e) => setNumber(e.target.value)} />}</Field>
        ) : (
          <>
            <p className="small muted">{t('Enter the 6-digit code we texted to {destination}.', { destination: challenge.destination })}</p>
            <OtpInput value={code} onChange={setCode} onComplete={(c) => void confirm(c)} disabled={busy} />
            {!isLive && <PrototypeCode challenge={challenge} onUse={(c) => { setCode(c); void confirm(c); }} />}
          </>
        )}
        <InlineError message={err} />
      </div>
    </Modal>
  );
}

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const submit = async () => {
    if (next.length < 8 || !/\d/.test(next) || !/[A-Za-z]/.test(next)) return setErr(t('Use at least 8 characters with letters and numbers.'));
    if (next !== confirm) return setErr(t('New passwords don’t match.'));
    setBusy(true);
    setErr(undefined);
    try { await authService.changePassword(cur, next); toast(t('Password changed')); setCur(''); setNext(''); setConfirm(''); onClose(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('Change password')} size="sm"
      footer={<><Button onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" loading={busy} onClick={submit}>{t('Change password')}</Button></>}>
      <div className="stack">
        <Field label={t('Current password')}>{(p) => <Input {...p} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
        <Field label={t('New password')}>{(p) => <Input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <Field label={t('Confirm new password')}>{(p) => <Input {...p} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
        <InlineError message={err} />
      </div>
    </Modal>
  );
}

export function PrivacyPage() {
  useDocumentTitle(`${t('Privacy & security')} · ${brand.name}`);
  const { user } = useSession();
  const toast = useToast();
  const access = useLive(() => accessService.listForPatient(), [user?.id]);
  const [revokeId, setRevokeId] = useState<string>();
  const revokeTarget = access.data?.active.find((g) => g.id === revokeId);
  return (
    <>
      <div className="page-head"><div><h1>{t('Privacy & security')}</h1><p>{t('How your record is protected, who can see it right now, and the devices signed in to your account.')}</p></div></div>

      <section className="card card-pad">
        <h2 style={{ fontSize: 'var(--t-md)', marginBottom: 14 }}>{t('How your privacy works')}</h2>
        <div className="grid-3">
          {[
            [LockKeyhole, t('Private by default'), t('Nobody — including doctors — can see your record unless you grant access.')],
            [ShieldCheck, t('You choose what and how long'), t('Pick which parts to share and for how long. Access ends automatically; revoke it anytime.')],
            [Eye, t('Every view is logged'), t('Each time a doctor opens, adds to or corrects your record, it’s recorded in your access log.')],
          ].map(([Icon, t, b]) => {
            const I = Icon as typeof LockKeyhole;
            return <div key={t as string} className="stack" style={{ '--gap': '6px' } as React.CSSProperties}><span className="type-icon tone-accent"><I aria-hidden /></span><div className="strong small">{t as string}</div><div className="small muted">{b as string}</div></div>;
          })}
        </div>
      </section>

      <Card title={t('Who can see your record now')} action={<Link className="card-link" to="/app/access">{t('Manage')}</Link>}>
        {!access.data ? <SkeletonList rows={2} card={false} /> : access.data.active.length === 0 ? (
          <div className="list-item"><span className="type-icon sm tone-ok"><LockKeyhole aria-hidden /></span><span className="small">{t('Only you. No doctor has access right now.')}</span></div>
        ) : (
          <ul className="list">
            {access.data.active.map((g) => (
              <li key={g.id} className="list-item" style={{ alignItems: 'flex-start', paddingTop: 14, paddingBottom: 14 }}>
                <Avatar name={g.doctor.fullName} doctor size="sm" />
                <div className="grow stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <div><span className="strong small">{g.doctor.fullName}</span> <span className="xs muted">· {g.hospital?.name} · <Clock3 size={11} aria-hidden style={{ verticalAlign: -1 }} /> {timeLeft(g.expiresAt)}</span></div>
                  <PermissionBadges value={g.permissions} max={4} />
                </div>
                <Button size="sm" variant="danger-ghost" icon={ShieldOff} onClick={() => setRevokeId(g.id)}>{t('Revoke')}</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="alert alert-accent"><ScrollText aria-hidden /><div><T text="See every view and change in your {log}." log={<Link to="/app/activity">{t('access log')}</Link>} /></div></div>

      <SecuritySection />

      <YourRights />

      {!isLive && <div className="alert alert-warn"><Info aria-hidden /><div><div className="alert-title">{t('About this demo')}</div>{t('Sessions, one-time codes and encryption are simulated here. The live version uses Supabase: real sign-in, access rules enforced by the database, and encryption at rest and in transit.')}</div></div>}

      <ConfirmDialog open={!!revokeTarget} onClose={() => setRevokeId(undefined)} danger confirmLabel={t('Revoke access')} title={t('Revoke {fullName}’s access?', { fullName: revokeTarget?.doctor.fullName })}
        body={t('They immediately lose access. Entries they already added stay in your record.')}
        onConfirm={async () => { await accessService.revoke(revokeId!); toast(t('Access revoked')); }} />
    </>
  );
}
