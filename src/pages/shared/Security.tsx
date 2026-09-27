import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LockKeyhole, ShieldCheck, Eye, Clock3, ScrollText, Smartphone, Laptop, Monitor, KeyRound, LogOut, Fingerprint, Info, ShieldOff } from 'lucide-react';
import { accessService, auditService, authService, friendlyError } from '../../services';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useSession } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { brand } from '../../config/brand';
import { fmtDateTime, relativeTime, timeLeft } from '../../lib/dates';
import { Avatar, Badge, Button, Card, ConfirmDialog, Field, InlineError, Input, Modal, SkeletonList } from '../../components/ui';
import { PermissionBadges } from '../../components/access/PermissionSelector';
import { ACTION_LABEL } from '../patient/Activity';

/** Sessions, sign-in history and password — shared by patients and doctors. */
export function SecuritySection() {
  const toast = useToast();
  const sessions = useLive(() => authService.listSessions(), []);
  const signIns = useLive(() => auditService.signIns(), []);
  const [pwOpen, setPwOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const deviceIcon = (d: string) => (/Android|iOS|Pixel|iPhone/.test(d) ? Smartphone : /laptop|Windows|macOS/i.test(d) ? Laptop : Monitor);
  return (
    <>
      <Card title="Signed-in devices" action={(sessions.data?.length ?? 0) > 1 ? <Button size="sm" variant="danger-ghost" icon={LogOut} onClick={() => setConfirmAll(true)}>Sign out others</Button> : undefined}>
        {!sessions.data ? <SkeletonList rows={2} card={false} /> : (
          <ul className="list">
            {sessions.data.map((s) => {
              const Icon = deviceIcon(s.device);
              return (
                <li key={s.id} className="list-item">
                  <span className="type-icon sm"><Icon aria-hidden /></span>
                  <div className="grow"><div className="strong small">{s.device} {s.current && <Badge tone="ok">This device</Badge>}</div><div className="xs muted">{s.location} · active {relativeTime(s.lastActiveAt)}</div></div>
                  {!s.current && <Button size="sm" variant="ghost" onClick={async () => { try { await authService.revokeSession(s.id); toast('Device signed out'); } catch (e) { toast(friendlyError(e), 'error'); } }}>Sign out</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Password & verification">
        <ul className="list">
          <li className="list-item"><span className="type-icon sm"><KeyRound aria-hidden /></span><div className="grow"><div className="strong small">Password</div><div className="xs muted">Use a unique password you don’t use elsewhere.</div></div><Button size="sm" onClick={() => setPwOpen(true)}>Change</Button></li>
          <li className="list-item"><span className="type-icon sm tone-ok"><Fingerprint aria-hidden /></span><div className="grow"><div className="strong small">One-time codes</div><div className="xs muted">Required to sign in, grant access, approve requests and share more.</div></div><Badge tone="ok">On</Badge></li>
        </ul>
      </Card>
      <Card title="Recent sign-ins">
        {!signIns.data ? <SkeletonList rows={3} card={false} /> : (
          <ul className="list">
            {signIns.data.slice(0, 8).map((a) => (
              <li key={a.id} className="list-item">
                <div className="grow small">{ACTION_LABEL[a.action]}<span className="muted"> · {a.target?.label}</span></div>
                <span className="xs subtle nowrap">{fmtDateTime(a.timestamp)}</span>
              </li>
            ))}
            {signIns.data.length === 0 && <li className="list-item small subtle">No sign-ins recorded yet.</li>}
          </ul>
        )}
      </Card>
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
      <ConfirmDialog open={confirmAll} onClose={() => setConfirmAll(false)} danger confirmLabel="Sign out other devices" title="Sign out everywhere else?"
        body="Every other device will need to sign in again with your password and a one-time code."
        onConfirm={async () => { const n = await authService.revokeOtherSessions(); toast(`Signed out ${n} device${n === 1 ? '' : 's'}`); }} />
    </>
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
    if (next.length < 8 || !/\d/.test(next) || !/[A-Za-z]/.test(next)) return setErr('Use at least 8 characters with letters and numbers.');
    if (next !== confirm) return setErr('New passwords don’t match.');
    setBusy(true);
    setErr(undefined);
    try { await authService.changePassword(cur, next); toast('Password changed'); setCur(''); setNext(''); setConfirm(''); onClose(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Change password" size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Change password</Button></>}>
      <div className="stack">
        <Field label="Current password">{(p) => <Input {...p} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />}</Field>
        <Field label="New password">{(p) => <Input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}</Field>
        <Field label="Confirm new password">{(p) => <Input {...p} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
        <InlineError message={err} />
      </div>
    </Modal>
  );
}

export function PrivacyPage() {
  useDocumentTitle(`Privacy & security · ${brand.name}`);
  const { user } = useSession();
  const toast = useToast();
  const access = useLive(() => accessService.listForPatient(), [user?.id]);
  const [revokeId, setRevokeId] = useState<string>();
  const revokeTarget = access.data?.active.find((g) => g.id === revokeId);
  return (
    <>
      <div className="page-head"><div><h1>Privacy & security</h1><p>How your record is protected, who can see it right now, and the devices signed in to your account.</p></div></div>

      <section className="card card-pad">
        <h2 style={{ fontSize: 'var(--t-md)', marginBottom: 14 }}>How your privacy works</h2>
        <div className="grid-3">
          {[
            [LockKeyhole, 'Private by default', 'Nobody — including doctors — can see your record unless you grant access.'],
            [ShieldCheck, 'You choose what and how long', 'Pick which parts to share and for how long. Access ends automatically; revoke it anytime.'],
            [Eye, 'Every view is logged', 'Each time a doctor opens, adds to or corrects your record, it’s recorded in your access log.'],
          ].map(([Icon, t, b]) => {
            const I = Icon as typeof LockKeyhole;
            return <div key={t as string} className="stack" style={{ '--gap': '6px' } as React.CSSProperties}><span className="type-icon tone-accent"><I aria-hidden /></span><div className="strong small">{t as string}</div><div className="small muted">{b as string}</div></div>;
          })}
        </div>
      </section>

      <Card title="Who can see your record now" action={<Link className="card-link" to="/app/access">Manage</Link>}>
        {!access.data ? <SkeletonList rows={2} card={false} /> : access.data.active.length === 0 ? (
          <div className="list-item"><span className="type-icon sm tone-ok"><LockKeyhole aria-hidden /></span><span className="small">Only you. No doctor has access right now.</span></div>
        ) : (
          <ul className="list">
            {access.data.active.map((g) => (
              <li key={g.id} className="list-item" style={{ alignItems: 'flex-start', paddingTop: 14, paddingBottom: 14 }}>
                <Avatar name={g.doctor.fullName} doctor size="sm" />
                <div className="grow stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <div><span className="strong small">{g.doctor.fullName}</span> <span className="xs muted">· {g.hospital?.name} · <Clock3 size={11} aria-hidden style={{ verticalAlign: -1 }} /> {timeLeft(g.expiresAt)}</span></div>
                  <PermissionBadges value={g.permissions} max={4} />
                </div>
                <Button size="sm" variant="danger-ghost" icon={ShieldOff} onClick={() => setRevokeId(g.id)}>Revoke</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="alert alert-accent"><ScrollText aria-hidden /><div>See every view and change in your <Link to="/app/activity">access log</Link>.</div></div>

      <SecuritySection />

      <div className="alert alert-warn"><Info aria-hidden /><div><div className="alert-title">About this prototype</div>Sessions, one-time codes and encryption are simulated here. A production version needs a real identity provider, server-side access checks, encryption at rest and in transit, and audited infrastructure.</div></div>

      <ConfirmDialog open={!!revokeTarget} onClose={() => setRevokeId(undefined)} danger confirmLabel="Revoke access" title={`Revoke ${revokeTarget?.doctor.fullName}’s access?`}
        body="They immediately lose access. Entries they already added stay in your record."
        onConfirm={async () => { await accessService.revoke(revokeId!); toast('Access revoked'); }} />
    </>
  );
}
