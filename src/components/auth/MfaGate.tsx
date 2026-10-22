import { useCallback, useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { isLive, friendlyError } from '../../services';
import { mfaState, startEnrolment, verifyMfaCode, type MfaState } from '../../services/remote/mfa';
import { useSession } from '../../state/SessionContext';
import { AuthLayout } from '../../pages/auth/AuthPages';
import { Button, InlineError } from '../ui';
import { OtpInput } from '../ui/Otp';
import { LogoMark } from '../ui/Logo';

/**
 * Doctors and the Niveda team must confirm each sign-in with an authenticator app
 * (when switched on for the project). The database enforces it — without the
 * second step it shows no patient data and refuses doctor and admin actions —
 * so this screen is how people get through, not the protection itself.
 */
export function MfaGate() {
  const [state, setState] = useState<MfaState | 'loading'>(isLive ? 'loading' : { required: false, enrolled: false, verified: true });
  const load = useCallback(() => { void mfaState().then(setState).catch(() => setState({ required: false, enrolled: false, verified: true })); }, []);
  useEffect(() => { if (isLive) load(); }, [load]);

  if (state === 'loading') return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }} aria-busy="true" aria-label="Loading"><LogoMark size={44} /></div>;
  if (!state.required || state.verified) return <Outlet />;
  return state.enrolled && state.factorId ? <MfaChallenge factorId={state.factorId} onDone={load} /> : <MfaSetup onDone={load} />;
}

function SignOutLink() {
  const { signOut } = useSession();
  const navigate = useNavigate();
  return <Button variant="ghost" size="sm" icon={LogOut} style={{ alignSelf: 'center' }} onClick={async () => { await signOut(); navigate('/login'); }}>Log out</Button>;
}

function MfaSetup({ onDone }: { onDone: () => void }) {
  const { refresh } = useSession();
  const [enrol, setEnrol] = useState<{ factorId: string; qr: string; secret: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  useEffect(() => { void startEnrolment().then(setEnrol).catch((e) => setErr(friendlyError(e))); }, []);

  const verify = async (c = code) => {
    if (!enrol) return;
    setBusy(true); setErr(undefined);
    try { await verifyMfaCode(enrol.factorId, c); await refresh(); onDone(); } catch (e) { setErr(friendlyError(e)); setCode(''); } finally { setBusy(false); }
  };

  return (
    <AuthLayout back={false}>
      <div>
        <div className="type-icon tone-accent" style={{ marginBottom: 16 }}><ShieldCheck aria-hidden /></div>
        <h1>Turn on two-step sign-in</h1>
        <p className="lede">Because you can see patients’ records, each sign-in needs a code from an authenticator app on your phone as well as your password.</p>
      </div>
      <ol className="stack small" style={{ '--gap': '8px', paddingLeft: 18, margin: 0 } as React.CSSProperties}>
        <li>Install an authenticator app: <b>Google Authenticator</b>, <b>Microsoft Authenticator</b> or similar.</li>
        <li>In the app, tap <b>+</b> and scan this code.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      {enrol ? (
        <div className="stack" style={{ '--gap': '8px', alignItems: 'center' } as React.CSSProperties}>
          <img src={enrol.qr} alt="QR code to add Niveda to your authenticator app" width={180} height={180} style={{ background: '#fff', padding: 8, borderRadius: 12 }} />
          <details className="xs muted" style={{ textAlign: 'center' }}>
            <summary style={{ cursor: 'pointer' }}><KeyRound size={12} aria-hidden /> Can’t scan? Type this key instead</summary>
            <code style={{ wordBreak: 'break-all', userSelect: 'all' }}>{enrol.secret}</code>
          </details>
        </div>
      ) : !err && <p className="small muted" aria-busy="true">Preparing your code…</p>}
      <OtpInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} disabled={busy || !enrol} autoFocus={false} />
      <InlineError message={err} />
      <Button variant="primary" size="lg" block loading={busy} disabled={code.length !== 6 || !enrol} onClick={() => void verify()}>Turn on and continue</Button>
      <SignOutLink />
    </AuthLayout>
  );
}

function MfaChallenge({ factorId, onDone }: { factorId: string; onDone: () => void }) {
  const { refresh } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const verify = async (c = code) => {
    setBusy(true); setErr(undefined);
    try { await verifyMfaCode(factorId, c); await refresh(); onDone(); } catch (e) { setErr(friendlyError(e)); setCode(''); } finally { setBusy(false); }
  };
  return (
    <AuthLayout back={false}>
      <div>
        <div className="type-icon tone-accent" style={{ marginBottom: 16 }}><Smartphone aria-hidden /></div>
        <h1>Confirm it’s you</h1>
        <p className="lede">Open your authenticator app and enter the 6-digit code for Niveda.</p>
      </div>
      <OtpInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} disabled={busy} />
      <InlineError message={err} />
      <Button variant="primary" size="lg" block loading={busy} disabled={code.length !== 6} onClick={() => void verify()}>Continue</Button>
      <p className="xs subtle" style={{ textAlign: 'center' }}>Lost your phone? Contact the Niveda team to reset two-step sign-in.</p>
      <SignOutLink />
    </AuthLayout>
  );
}
