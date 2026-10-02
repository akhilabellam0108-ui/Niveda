import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FlaskConical, ShieldCheck } from 'lucide-react';
import type { OtpChallenge } from '../../services';
import { friendlyError } from '../../services';
import { Button, InlineError, Modal } from './index';

export function OtpInput({ value, onChange, onComplete, disabled, autoFocus = true }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { if (autoFocus) refs.current[0]?.focus(); }, [autoFocus]);
  const set = (i: number, ch: string) => {
    const chars = value.padEnd(6, ' ').split('');
    chars[i] = ch || ' ';
    const next = chars.join('').replace(/\s+$/, '');
    onChange(next);
    if (next.replace(/\s/g, '').length === 6 && !next.includes(' ')) onComplete?.(next);
  };
  return (
    <div className="otp" role="group" aria-label="6-digit code">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={1}
          aria-label={`Digit ${i + 1}`} disabled={disabled}
          value={value[i]?.trim() ?? ''}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '');
            if (d.length > 1) {
              const pasted = (value.slice(0, i) + d).slice(0, 6);
              onChange(pasted);
              refs.current[Math.min(5, pasted.length)]?.focus();
              if (pasted.length === 6) onComplete?.(pasted);
              return;
            }
            set(i, d);
            if (d && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !value[i]?.trim() && i > 0) refs.current[i - 1]?.focus();
            if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}

/**
 * Development helper: when the server runs with OTP_DEV_ECHO, it returns the code so it can be
 * filled in without an inbox. In a real deployment `devCode` is never sent and nothing is shown.
 */
export function PrototypeCode({ challenge, onUse }: { challenge: OtpChallenge; onUse?: (code: string) => void }) {
  if (!challenge.devCode) return null;
  const code = challenge.devCode;
  return (
    <div className="proto-code" role="note">
      <div className="row" style={{ '--gap': '10px' } as React.CSSProperties}>
        <FlaskConical size={16} aria-hidden />
        <div>
          <div className="xs strong">Development server — code shown here</div>
          <div className="xs">Code sent to {challenge.destination}: <code>{code}</code></div>
        </div>
      </div>
      {onUse && <Button size="sm" variant="ghost" onClick={() => onUse(code)}>Fill in</Button>}
    </div>
  );
}

interface OtpDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** Requests a new challenge (sends the "SMS"). */
  request: () => Promise<OtpChallenge>;
  /** Called with the code; should throw AppError on failure. */
  onVerify: (challenge: OtpChallenge, code: string) => Promise<void>;
  confirmLabel?: string;
  summary?: ReactNode;
}

/** Step-up verification before sensitive actions like granting access. */
export function OtpDialog({ open, onClose, title, description, request, onVerify, confirmLabel = 'Verify', summary }: OtpDialogProps) {
  const [challenge, setChallenge] = useState<OtpChallenge>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const send = async () => {
    setErr(undefined);
    setCode('');
    try {
      setChallenge(await request());
    } catch (e) {
      setErr(friendlyError(e));
    }
  };
  useEffect(() => {
    if (open) void send();
    else { setChallenge(undefined); setCode(''); setErr(undefined); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const verify = async (c = code) => {
    if (!challenge || c.length !== 6) return;
    setBusy(true);
    setErr(undefined);
    try {
      await onVerify(challenge, c);
    } catch (e) {
      setErr(friendlyError(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title} description={description} size="sm"
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon={ShieldCheck} onClick={() => verify()} loading={busy} disabled={code.length !== 6 || !challenge}>{confirmLabel}</Button>
      </>}>
      <div className="stack">
        {summary}
        <p className="small muted">Enter the 6-digit code we sent to {challenge?.destination ?? 'your phone'}.</p>
        <OtpInput value={code} onChange={setCode} onComplete={(v) => verify(v)} disabled={busy || !challenge} />
        {challenge && <PrototypeCode challenge={challenge} onUse={(c) => { setCode(c); void verify(c); }} />}
        <InlineError message={err} />
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={send} disabled={busy}>Send a new code</button>
      </div>
    </Modal>
  );
}
