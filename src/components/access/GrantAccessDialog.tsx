import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, QrCode, Search, UserPlus, ShieldCheck, CheckCircle2, Building2 } from 'lucide-react';
import type { Doctor, GrantMethod, Hospital, PermissionKey } from '@shared/types';
import { DEFAULT_PERMISSIONS, permissionLabel } from '@shared/recordMeta';
import { addHours, fmtDateTime, nowISO } from '@shared/dates';
import { accessService, durationLabel, friendlyError, type OtpChallenge } from '../../services';
import { Avatar, Button, Field, InlineError, Input, Modal } from '../ui';
import { OtpInput, PrototypeCode } from '../ui/Otp';
import { DurationPicker, PermissionBadges, PermissionSelector } from './PermissionSelector';
import { QrScanner } from './Qr';

type DoctorResult = Doctor & { hospital?: Hospital };
type Step = 'method' | 'find' | 'permissions' | 'duration' | 'review' | 'verify' | 'done' | 'invited';

const METHODS: { key: GrantMethod; label: string; sub: string; icon: typeof QrCode }[] = [
  { key: 'qr', label: 'Scan QR code', sub: 'At the clinic, from the doctor’s screen', icon: QrCode },
  { key: 'code', label: 'Enter access code', sub: 'A short code your doctor gives you', icon: KeyRound },
  { key: 'directory', label: 'Find a doctor', sub: 'Search by name, specialty or hospital', icon: Search },
  { key: 'invite', label: 'Invite a doctor', sub: 'Your doctor isn’t on the app yet', icon: UserPlus },
];

const STEPS: [Step, string][] = [['find', 'Doctor'], ['permissions', 'What to share'], ['duration', 'How long'], ['review', 'Confirm']];

export function GrantAccessDialog({ open, onClose, onGranted }: { open: boolean; onClose: () => void; onGranted?: () => void }) {
  const [step, setStep] = useState<Step>('method');
  const [method, setMethod] = useState<GrantMethod>('code');
  const [doctor, setDoctor] = useState<DoctorResult>();
  const [perms, setPerms] = useState<PermissionKey[]>(DEFAULT_PERMISSIONS);
  const [hours, setHours] = useState(24);
  const [challenge, setChallenge] = useState<OtpChallenge>();
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    if (open) { setStep('method'); setDoctor(undefined); setPerms(DEFAULT_PERMISSIONS); setHours(24); setErr(undefined); setOtp(''); setChallenge(undefined); }
  }, [open]);

  const go = (s: Step) => { setErr(undefined); setStep(s); };

  const sendCode = async () => {
    setErr(undefined);
    setOtp('');
    try { setChallenge(await accessService.requestVerification('grant_access')); } catch (e) { setErr(friendlyError(e)); }
  };

  const verify = async (code = otp) => {
    if (!doctor || !challenge || code.length !== 6) return;
    setBusy(true);
    setErr(undefined);
    try {
      await accessService.grantAccess({ doctorId: doctor.id, permissions: perms, hours, method, challengeId: challenge.id, code });
      go('done');
      onGranted?.();
    } catch (e) {
      setErr(friendlyError(e, 'Access could not be granted. Please try again.'));
      setOtp('');
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = STEPS.findIndex(([s]) => s === step);
  const title = step === 'done' ? 'Access granted' : step === 'invited' ? 'Invitation recorded' : step === 'verify' ? 'Verify it’s you' : 'Grant doctor access';

  const footer = (() => {
    switch (step) {
      case 'permissions': return <><Button icon={ArrowLeft} variant="ghost" onClick={() => go('find')} style={{ marginRight: 'auto' }}>Back</Button><Button variant="primary" disabled={!perms.length} onClick={() => go('duration')}>Continue</Button></>;
      case 'duration': return <><Button icon={ArrowLeft} variant="ghost" onClick={() => go('permissions')} style={{ marginRight: 'auto' }}>Back</Button><Button variant="primary" onClick={() => go('review')}>Continue</Button></>;
      case 'review': return <><Button icon={ArrowLeft} variant="ghost" onClick={() => go('duration')} style={{ marginRight: 'auto' }}>Back</Button><Button variant="primary" icon={ShieldCheck} onClick={() => { go('verify'); void sendCode(); }}>Verify and grant</Button></>;
      case 'verify': return <><Button variant="ghost" onClick={() => go('review')} disabled={busy} style={{ marginRight: 'auto' }}>Back</Button><Button variant="primary" loading={busy} disabled={otp.length !== 6 || !challenge} onClick={() => verify()}>Grant access</Button></>;
      case 'done': case 'invited': return <Button variant="primary" onClick={onClose}>Done</Button>;
      default: return undefined;
    }
  })();

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title} size="md" footer={footer}
      description={step === 'method' ? 'Choose how to find your doctor. You decide what they see and for how long.' : undefined}>
      <div className="stack">
        {stepIndex >= 0 && (
          <div className="stepper" aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`}>
            {STEPS.map(([s, l], i) => (
              <span key={s} className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
                {i > 0 && <span className="sep" />}
                <span className={`st ${i < stepIndex ? 'done' : i === stepIndex ? 'on' : ''}`}><i>{i + 1}</i>{l}</span>
              </span>
            ))}
          </div>
        )}

        {step === 'method' && (
          <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            {METHODS.map((m) => (
              <button key={m.key} className="choice" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }} onClick={() => { setMethod(m.key); go('find'); }}>
                <span className="type-icon tone-accent"><m.icon aria-hidden /></span>
                <span><span className="choice-title">{m.label}</span><span className="choice-sub">{m.sub}</span></span>
              </button>
            ))}
          </div>
        )}

        {step === 'find' && (
          <>
            <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => go('method')} style={{ alignSelf: 'flex-start' }}>Other ways</Button>
            {method === 'invite' ? <InviteForm onInvited={() => go('invited')} /> : (
              <FindDoctor method={method} selected={doctor} onSelect={(d) => { setDoctor(d); go('permissions'); }} />
            )}
          </>
        )}

        {doctor && ['permissions', 'duration', 'review'].includes(step) && <DoctorSummary doctor={doctor} />}

        {step === 'permissions' && (
          <>
            <p className="small muted">Choose what {doctor?.fullName} can see. They can add new entries only to the parts you share.</p>
            <PermissionSelector value={perms} onChange={setPerms} />
          </>
        )}

        {step === 'duration' && <DurationPicker hours={hours} onChange={setHours} />}

        {step === 'review' && doctor && (
          <div className="inset stack" style={{ '--gap': '12px' } as React.CSSProperties}>
            <div><div className="xs subtle strong">CAN SEE AND ADD TO</div><div style={{ marginTop: 6 }}><PermissionBadges value={perms} /></div></div>
            <div className="grid-2">
              <div><div className="xs subtle strong">FOR</div><div className="strong">{durationLabel(hours)}</div></div>
              <div><div className="xs subtle strong">ENDS</div><div className="strong">{fmtDateTime(addHours(nowISO(), hours))}</div></div>
            </div>
            <p className="xs muted">Every time they open your record or add to it, it’s logged in your access log. You can revoke access at any time.</p>
          </div>
        )}

        {step === 'verify' && (
          <>
            <p className="small muted">For your security, confirm with the 6-digit code sent to {challenge?.destination ?? 'your phone'}.</p>
            <OtpInput value={otp} onChange={setOtp} onComplete={(c) => verify(c)} disabled={busy || !challenge} />
            {challenge && <PrototypeCode challenge={challenge} onUse={(c) => { setOtp(c); void verify(c); }} />}
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={sendCode} disabled={busy}>Send a new code</button>
          </>
        )}

        {step === 'done' && doctor && (
          <div className="success-hero" style={{ padding: '8px 0' }}>
            <div className="ok-icon"><CheckCircle2 aria-hidden /></div>
            <h3>{doctor.fullName} can now see your record</h3>
            <p className="small muted">Access to {perms.map((p) => permissionLabel(p).toLowerCase()).join(', ')} ends {fmtDateTime(addHours(nowISO(), hours))}.</p>
          </div>
        )}

        {step === 'invited' && (
          <div className="success-hero" style={{ padding: '8px 0' }}>
            <div className="ok-icon"><CheckCircle2 aria-hidden /></div>
            <h3>Invitation sent</h3>
            <p className="small muted">If you entered an email address, your doctor has been sent an invitation. Once their registration is verified and they join, you can grant them access here.</p>
          </div>
        )}

        <InlineError message={err} />
      </div>
    </Modal>
  );
}

function DoctorSummary({ doctor }: { doctor: DoctorResult }) {
  return (
    <div className="row inset" style={{ padding: 12 }}>
      <Avatar name={doctor.fullName} doctor />
      <div className="grow">
        <div className="strong">{doctor.fullName}</div>
        <div className="xs muted">{doctor.specialization} · <Building2 size={11} style={{ verticalAlign: -1 }} aria-hidden /> {doctor.hospital?.name}</div>
        <div className="xs subtle">Reg. {doctor.registrationNumber}</div>
      </div>
    </div>
  );
}

function FindDoctor({ method, onSelect, selected }: { method: GrantMethod; onSelect: (d: DoctorResult) => void; selected?: DoctorResult }) {
  const [code, setCode] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DoctorResult[]>([]);
  const [found, setFound] = useState<DoctorResult | undefined>(selected);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    if (method !== 'directory') return;
    const t = setTimeout(() => { accessService.searchDoctors(q).then(setResults).catch(() => setResults([])); }, 180);
    return () => clearTimeout(t);
  }, [q, method]);

  const lookup = useCallback(async (c: string) => {
    setBusy(true);
    setErr(undefined);
    try { setFound(await accessService.findDoctorByCode(c)); } catch (e) { setErr(friendlyError(e)); setFound(undefined); } finally { setBusy(false); }
  }, []);

  const onScan = useCallback((text: string) => {
    const c = text.replace(/^.*[?&]code=/, '').trim();
    setCode(c);
    void lookup(c);
  }, [lookup]);

  if (method === 'directory') {
    return (
      <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
        <div className="input-wrap"><Search aria-hidden /><Input autoFocus placeholder="e.g. Priya, cardiologist, Lakeview" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search doctors" /></div>
        {q.length >= 2 && results.length === 0 && <p className="small subtle">No doctors match “{q}”.</p>}
        <ul className="list card">
          {results.map((d) => (
            <li key={d.id}>
              <button className="list-item clickable" onClick={() => onSelect(d)}>
                <Avatar name={d.fullName} doctor size="sm" />
                <span className="grow"><span className="strong">{d.fullName}</span><span className="xs muted" style={{ display: 'block' }}>{d.specialization} · {d.hospital?.name}</span></span>
              </button>
            </li>
          ))}
        </ul>
        {q.length < 2 && <p className="xs subtle">Only verified doctors appear in search. You still choose exactly what they can see.</p>}
      </div>
    );
  }

  return (
    <div className="stack">
      {method === 'qr' && <QrScanner onResult={onScan} />}
      <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); void lookup(code); }}>
        <Field label={method === 'qr' ? 'Or type the code under the QR' : 'Doctor access code'} className="grow" help={method === 'code' ? 'Try PS-4821 (Dr. Priya Sharma, demo)' : undefined}>
          {(p) => <Input {...p} autoFocus={method === 'code'} placeholder="e.g. PS-4821" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />}
        </Field>
        <Button type="submit" loading={busy} disabled={code.trim().length < 4}>Find</Button>
      </form>
      <InlineError message={err} />
      {found && (
        <div className="card card-pad stack" style={{ '--gap': '12px' } as React.CSSProperties}>
          <DoctorSummary doctor={found} />
          <Button variant="primary" onClick={() => onSelect(found)}>This is my doctor</Button>
        </div>
      )}
    </div>
  );
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr(undefined);
      try { await accessService.inviteDoctor(name, contact); onInvited(); } catch (x) { setErr(friendlyError(x)); } finally { setBusy(false); }
    }}>
      <Field label="Doctor’s name" required>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. …" />}</Field>
      <Field label="Email or phone" required>{(p) => <Input {...p} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="doctor@clinic.com" />}</Field>
      <p className="xs subtle">Inviting doesn’t share anything. You grant access separately once they join.</p>
      <InlineError message={err} />
      <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !contact.trim()}>Send invitation</Button>
    </form>
  );
}
