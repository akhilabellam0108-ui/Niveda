import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck, Clock3, ScrollText, FlaskConical, Stethoscope, UserRound, Mail, ChevronRight, ArrowLeftRight } from 'lucide-react';
import { brand } from '../../config/brand';
import { authService, friendlyError, isLive, type OtpChallenge } from '../../services';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../mock/seed';
import { useSession } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { useDocumentTitle } from '../../state/hooks';
import { Button, Field, InlineError, Input } from '../../components/ui';
import { Brand } from '../../components/ui/Logo';
import { homeFor } from '../../lib/home';
import { BackButton } from '../../components/ui/BackButton';
import { OtpInput, PrototypeCode } from '../../components/ui/Otp';
import { toISODate } from '../../lib/dates';

export function AuthLayout({ children, back = true }: { children: ReactNode; back?: boolean }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <Brand />
        <div style={{ position: 'relative' }}>
          <h2>One record for your whole life — and you hold the key.</h2>
          <div className="auth-points">
            <div><Clock3 aria-hidden />Every visit, test and prescription in one timeline</div>
            <div><ShieldCheck aria-hidden />Doctors see only what you share, only for as long as you allow</div>
            <div><ScrollText aria-hidden />Every view and every change is logged for you to see</div>
          </div>
        </div>
        {!isLive && <p className="xs" style={{ position: 'relative' }}>Prototype build · fictional demo data only</p>}
        <TimelineArt />
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          {back && <BackButton fallback="/" className="auth-back" />}
          <div className="mobile-only"><Brand /></div>
          {children}
        </div>
      </main>
    </div>
  );
}

function TimelineArt() {
  return (
    <svg className="aside-art" viewBox="0 0 460 420" aria-hidden>
      <path d="M40 380 C 140 360, 160 250, 240 230 S 360 120, 440 40" fill="none" stroke="#2c6e62" strokeWidth="2" strokeDasharray="4 8" />
      {[[40, 380], [150, 320], [240, 230], [330, 150], [440, 40]].map(([x, y], i) => (
        <g key={i}><circle cx={x} cy={y} r={i === 4 ? 12 : 7} fill={i === 4 ? '#7fd3bf' : '#1c4c44'} stroke="#7fd3bf" strokeWidth="2" /></g>
      ))}
    </svg>
  );
}

export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrap">
      <Input {...props} type={show ? 'text' : 'password'} style={{ paddingRight: 44 }} />
      <button type="button" className="btn btn-ghost btn-sm btn-icon input-action" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)}>
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

/* ---------------- Login ---------------- */

export type LoginRole = 'patient' | 'doctor';

const ROLE_COPY: Record<LoginRole, { icon: typeof UserRound; title: string; sub: string; heading: string; lede: string }> = {
  patient: { icon: UserRound, title: 'I’m a patient', sub: 'See your health record, medicines, reminders and who can see your record.', heading: 'Log in as a patient', lede: `Log in to your ${brand.name} record.` },
  doctor: { icon: Stethoscope, title: 'I’m a doctor', sub: 'See patients who have shared their record with you, and add to it.', heading: 'Log in as a doctor', lede: 'Log in to your clinician workspace.' },
};

/** Step 1 of logging in: who is it — a patient or a doctor? */
function RolePicker({ onPick }: { onPick: (r: LoginRole) => void }) {
  const { notice } = useSession();
  return (
    <AuthLayout>
      <div>
        <h1>Who’s logging in?</h1>
        <p className="lede">Choose one to continue.</p>
      </div>
      {notice && <div className="alert alert-warn" role="alert"><Clock3 aria-hidden /><div>{notice}</div></div>}
      <ul className="stack role-list" style={{ '--gap': '12px' } as React.CSSProperties}>
        {(['patient', 'doctor'] as const).map((r) => {
          const c = ROLE_COPY[r];
          return (
            <li key={r}><button type="button" className="role-card" onClick={() => onPick(r)}>
              <span className="role-card-icon" aria-hidden><c.icon /></span>
              <span className="grow">
                <span className="role-card-title">{c.title}</span>
                <span className="role-card-sub">{c.sub}</span>
              </span>
              <ChevronRight className="role-card-go" aria-hidden />
            </button></li>
          );
        })}
      </ul>
      <p className="small muted" style={{ textAlign: 'center' }}>
        New here? <Link to="/signup">Create a patient account</Link> · <Link to="/signup/doctor">Join as a doctor</Link>
      </p>
    </AuthLayout>
  );
}

export function LoginPage() {
  useDocumentTitle(`Log in · ${brand.name}`);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const role: LoginRole | undefined = params.get('as') === 'doctor' ? 'doctor' : params.get('as') === 'patient' ? 'patient' : undefined;
  const { notice, clearNotice } = useSession();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  if (!role) return <RolePicker onPick={(r) => setParams({ as: r })} />;
  const copy = ROLE_COPY[role];
  const other: LoginRole = role === 'doctor' ? 'patient' : 'doctor';

  const submit = async (e?: React.FormEvent, creds?: { id: string; pw: string }) => {
    e?.preventDefault();
    const c = creds ?? { id, pw };
    if (!c.id.trim() || !c.pw) { setErr(isLive ? 'Enter your email and password.' : 'Enter your email or phone and password.'); return; }
    setBusy(true);
    setErr(undefined);
    try {
      const challenge = await authService.startLogin(c.id, c.pw);
      clearNotice();
      navigate('/verify', { state: { flow: 'login', challenge, as: role } });
    } catch (x) {
      setErr(friendlyError(x));
    } finally {
      setBusy(false);
    }
  };

  const demos = role === 'patient' ? (['patient'] as const) : (['doctor', 'doctor2'] as const);

  return (
    <AuthLayout>
      <div>
        <span className={`role-chip role-chip-${role}`}><copy.icon aria-hidden />{role === 'doctor' ? 'Doctor' : 'Patient'}</span>
        <h1>{copy.heading}</h1>
        <p className="lede">{copy.lede}</p>
      </div>
      {notice && <div className="alert alert-warn" role="alert"><Clock3 aria-hidden /><div>{notice}</div></div>}
      <form className="stack" onSubmit={submit} noValidate>
        <Field label={isLive ? 'Email' : 'Email or phone number'}>{(p) => <Input {...p} type={isLive ? 'email' : 'text'} autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} placeholder={role === 'doctor' ? 'you@hospital.com' : 'you@example.com'} />}</Field>
        <Field label="Password">{(p) => <PasswordInput {...p} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
        <div className="spread small"><span /><Link to="/forgot-password">Forgot password?</Link></div>
        <InlineError message={err} />
        <Button type="submit" variant="primary" size="lg" block loading={busy}>Log in</Button>
      </form>
      <p className="small muted" style={{ textAlign: 'center' }}>
        {role === 'patient'
          ? <>New here? <Link to="/signup">Create an account</Link></>
          : <>Not on {brand.name} yet? <Link to="/signup/doctor">Apply to join as a doctor</Link></>}
      </p>
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => { setErr(undefined); setParams({ as: other }); }}>
        <ArrowLeftRight aria-hidden />I’m {other === 'doctor' ? 'a doctor' : 'a patient'} instead
      </button>
      {!isLive && <div className="demo-box">
        <div className="row xs strong" style={{ color: 'var(--warn)' }}><FlaskConical size={14} aria-hidden />Demo {role} account{demos.length > 1 ? 's' : ''} (password {DEMO_PASSWORD})</div>
        {demos.map((k) => (
          <button key={k} type="button" className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} disabled={busy}
            onClick={() => { setId(DEMO_ACCOUNTS[k].email); setPw(DEMO_PASSWORD); void submit(undefined, { id: DEMO_ACCOUNTS[k].email, pw: DEMO_PASSWORD }); }}>
            <copy.icon aria-hidden />Continue as {DEMO_ACCOUNTS[k].label}
          </button>
        ))}
        <p className="xs subtle">Tip: open a second browser tab to be the patient in one and the doctor in the other — changes appear live.</p>
      </div>}
    </AuthLayout>
  );
}

/* ---------------- Sign up ---------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function SignupPage() {
  useDocumentTitle(`Create account · ${brand.name}`);
  const navigate = useNavigate();
  const [f, setF] = useState({ fullName: '', dateOfBirth: '', email: '', phone: '', password: '', confirm: '' });
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const validate = () => {
    const v: Record<string, string> = {};
    if (f.fullName.trim().length < 2) v.fullName = 'Enter your full name';
    if (!f.dateOfBirth) v.dateOfBirth = 'Enter your date of birth';
    else if (f.dateOfBirth > toISODate(new Date()) || f.dateOfBirth < '1900-01-01') v.dateOfBirth = 'Check your date of birth';
    if (!EMAIL_RE.test(f.email.trim())) v.email = 'Enter a valid email address';
    if (f.phone.replace(/\D/g, '').length < 10) v.phone = 'Enter a 10-digit mobile number';
    if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) v.password = 'Use at least 8 characters with letters and numbers';
    if (f.confirm !== f.password) v.confirm = 'Passwords don’t match';
    if (!agree) v.agree = 'Please accept to continue';
    setErrors(v);
    return !Object.keys(v).length;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setErr(undefined);
    try {
      const challenge = await authService.startSignUp({ fullName: f.fullName, dateOfBirth: f.dateOfBirth, email: f.email, phone: f.phone, password: f.password });
      navigate('/verify', { state: { flow: 'signup', challenge } });
    } catch (x) {
      setErr(friendlyError(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div>
        <h1>Create your record</h1>
        <p className="lede">After this you’ll set up your record: blood group, emergency contact, allergies, conditions, medicines, past surgeries and your medical documents. Every step must be answered — keep a report or prescription handy if you have one.</p>
      </div>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Full name" required error={errors.fullName}>{(p) => <Input {...p} autoComplete="name" value={f.fullName} onChange={set('fullName')} />}</Field>
        <Field label="Date of birth" required error={errors.dateOfBirth}>{(p) => <Input {...p} type="date" autoComplete="bday" value={f.dateOfBirth} onChange={set('dateOfBirth')} />}</Field>
        <div className="form-grid">
          <Field label="Email" required error={errors.email}>{(p) => <Input {...p} type="email" autoComplete="email" value={f.email} onChange={set('email')} />}</Field>
          <Field label="Mobile number" required error={errors.phone}>{(p) => <Input {...p} type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} placeholder="+91" />}</Field>
          <Field label="Password" required error={errors.password} help="8+ characters, letters and numbers">{(p) => <PasswordInput {...p} autoComplete="new-password" value={f.password} onChange={set('password')} />}</Field>
          <Field label="Confirm password" required error={errors.confirm}>{(p) => <PasswordInput {...p} autoComplete="new-password" value={f.confirm} onChange={set('confirm')} />}</Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} aria-invalid={!!errors.agree} />
          <span>I agree to the <Link to="/legal/terms" target="_blank">Terms</Link> and <Link to="/legal/privacy" target="_blank">Privacy notice</Link>. I understand my record is shared only with doctors I approve.</span>
        </label>
        {errors.agree && <span className="field-error">{errors.agree}</span>}
        <InlineError message={err} />
        <Button type="submit" variant="primary" size="lg" block loading={busy}>Continue</Button>
      </form>
      <p className="small muted" style={{ textAlign: 'center' }}>Already have an account? <Link to="/login">Log in</Link></p>
      <p className="small muted" style={{ textAlign: 'center' }}>Are you a doctor? <Link to="/signup/doctor">Apply to join as a doctor</Link></p>
    </AuthLayout>
  );
}

/* ---------------- OTP verification ---------------- */

export function VerifyPage() {
  useDocumentTitle(`Verify · ${brand.name}`);
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useSession();
  const toast = useToast();
  const state = location.state as { flow: 'login' | 'signup'; challenge: OtpChallenge; as?: LoginRole } | null;
  const [challenge, setChallenge] = useState(state?.challenge);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  if (!state || !authService.hasPending(state.flow)) {
    return (
      <AuthLayout>
        <h1>Let’s start again</h1>
        <p className="muted">Your verification step timed out. For your security, please start again.</p>
        <Button variant="primary" onClick={() => navigate('/login')}>Back to log in</Button>
      </AuthLayout>
    );
  }

  const verify = async (c = code) => {
    if (!challenge || c.length !== 6) return;
    setBusy(true);
    setErr(undefined);
    try {
      const user = state.flow === 'signup' ? await authService.completeSignUp(challenge.id, c) : await authService.completeLogin(challenge.id, c);
      await refresh();
      // Picked "patient" but this is a doctor's account (or the other way round): open the right side and say so.
      const isDoctorSide = user.role === 'doctor' || user.role === 'applicant';
      if (state.as && (state.as === 'doctor') !== isDoctorSide) {
        toast(isDoctorSide ? 'This is a doctor’s account, so we opened the doctor side.' : 'This is a patient’s account, so we opened the patient side.');
      }
      navigate(homeFor(user), { replace: true });
    } catch (x) {
      setErr(friendlyError(x));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div>
        <div className="type-icon tone-accent" style={{ marginBottom: 16 }}><Mail aria-hidden /></div>
        <h1>Enter your code</h1>
        <p className="lede">We sent a 6-digit code to {challenge?.destination}. {isLive ? 'Check your inbox (and spam folder).' : 'It expires in 5 minutes.'}</p>
      </div>
      <OtpInput value={code} onChange={setCode} onComplete={(c) => verify(c)} disabled={busy} />
      {challenge && <PrototypeCode challenge={challenge} onUse={(c) => { setCode(c); void verify(c); }} />}
      <InlineError message={err} />
      <Button variant="primary" size="lg" block loading={busy} disabled={code.length !== 6} onClick={() => verify()}>Verify</Button>
      <div className="spread small">
        <Link to={state.flow === 'signup' ? '/signup' : state.as ? `/login?as=${state.as}` : '/login'}>Back</Link>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { try { setChallenge(authService.resendCode(state.flow)); setCode(''); setErr(undefined); } catch (x) { setErr(friendlyError(x)); } }}>Send a new code</button>
      </div>
      {!isLive && <p className="xs subtle">In the real app this code arrives by email. Here it’s shown on screen because this is the demo.</p>}
    </AuthLayout>
  );
}

/* ---------------- Forgot password ---------------- */

export function ForgotPasswordPage() {
  useDocumentTitle(`Reset password · ${brand.name}`);
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>();
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState(false);

  return (
    <AuthLayout>
      <div>
        <h1>Reset your password</h1>
        <p className="lede">{done ? 'Your password was changed and other devices were signed out.' : isLive ? 'We’ll email a code to the address on your account.' : 'We’ll send a code to the phone number on your account.'}</p>
      </div>
      {done ? <Button variant="primary" onClick={() => navigate('/login')}>Log in</Button> : challenge === undefined ? (
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(undefined);
          try { setChallenge(await authService.startPasswordReset(id)); } catch (x) { setErr(friendlyError(x)); } finally { setBusy(false); }
        }}>
          <Field label={isLive ? 'Email' : 'Email or phone number'}>{(p) => <Input {...p} type={isLive ? 'email' : 'text'} value={id} onChange={(e) => setId(e.target.value)} />}</Field>
          <InlineError message={err} />
          <Button type="submit" variant="primary" block loading={busy} disabled={!id.trim()}>Send code</Button>
        </form>
      ) : challenge === null ? (
        <div className="alert alert-info"><Mail aria-hidden /><div>If an account exists for <b>{id}</b>, a code has been sent. (Prototype: no account matched.)</div></div>
      ) : (
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 8 || !/\d/.test(pw) || !/[A-Za-z]/.test(pw)) { setErr('Use at least 8 characters with letters and numbers.'); return; }
          setBusy(true);
          setErr(undefined);
          try { await authService.completePasswordReset(challenge.id, code, pw); setDone(true); } catch (x) { setErr(friendlyError(x)); } finally { setBusy(false); }
        }}>
          <p className="small muted">Enter the code sent to {challenge.destination}.</p>
          <OtpInput value={code} onChange={setCode} />
          <PrototypeCode challenge={challenge} onUse={setCode} />
          <Field label="New password" help="8+ characters, letters and numbers">{(p) => <PasswordInput {...p} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
          <InlineError message={err} />
          <Button type="submit" variant="primary" block loading={busy} disabled={code.length !== 6}>Set new password</Button>
        </form>
      )}
      <p className="small" style={{ textAlign: 'center' }}><Link to="/login">Back to log in</Link></p>
    </AuthLayout>
  );
}
