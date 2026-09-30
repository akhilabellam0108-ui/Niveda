import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Siren } from 'lucide-react';
import {
  accessService, friendlyError, EMERGENCY_REASONS, EMERGENCY_HOURS, type EmergencyReason, type OtpChallenge,
} from '../../services';
import { useToast } from '../../state/ToastContext';
import { Button, Field, InlineError, Input, Modal, Select, Textarea } from '../ui';
import { OtpInput, PrototypeCode } from '../ui/Otp';

/**
 * Break-glass access for a patient who can't consent. Deliberately a few steps:
 * the doctor states why, confirms with a fresh code, and is told exactly who will
 * see what they did.
 */
export function EmergencyAccessPanel({ initialCode = '' }: { initialCode?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card card-pad emergency-panel">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="type-icon tone-danger"><Siren aria-hidden /></span>
        <div className="grow">
          <h2 style={{ fontSize: 'var(--t-md)' }}>Patient can’t give consent?</h2>
          <p className="small muted">In an emergency — unconscious, unable to communicate — you can open their allergies, medicines, conditions and surgeries for {EMERGENCY_HOURS} hours. The patient is told at once, and every use is reviewed by the Niveda team.</p>
        </div>
        <Button variant="danger" icon={Siren} onClick={() => setOpen(true)}>Emergency access</Button>
      </div>
      {open && <EmergencyDialog initialCode={initialCode} onClose={() => setOpen(false)} />}
    </section>
  );
}

function EmergencyDialog({ initialCode, onClose }: { initialCode: string; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState(initialCode);
  const [reason, setReason] = useState<EmergencyReason | ''>('');
  const [justification, setJustification] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge>();
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const ready = code.replace(/\W/g, '').length >= 6 && !!reason && justification.trim().length >= 20;

  const sendCode = async () => {
    setBusy(true); setErr(undefined);
    try { setChallenge(await accessService.requestEmergencyVerification()); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const confirm = async (value = otp) => {
    if (!challenge || !reason) return;
    setBusy(true); setErr(undefined);
    try {
      const r = await accessService.emergencyAccess({ patientCode: code, reason, justification, challengeId: challenge.id, code: value });
      toast(`Emergency access for ${EMERGENCY_HOURS} hours. The patient has been told.`);
      onClose();
      navigate(`/doctor/patients/${r.patientId}`);
    } catch (e) {
      setErr(friendlyError(e));
      setOtp('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title="Emergency access" size="md"
      description="Use this only when the patient can’t consent and you need their information to treat them now."
      footer={!challenge ? (
        <><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} disabled={!ready} onClick={sendCode}>Continue</Button></>
      ) : (
        <><Button onClick={() => { setChallenge(undefined); setOtp(''); }} disabled={busy}>Back</Button><Button variant="danger" icon={Siren} loading={busy} disabled={otp.length !== 6} onClick={() => confirm()}>Open emergency access</Button></>
      )}>
      <div className="stack">
        {!challenge ? (
          <>
            <Field label="Patient ID" required help="On their Niveda card, phone lock screen or QR code">{(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="NV-0000-0000" autoCapitalize="characters" />}</Field>
            <Field label="Why they can’t consent" required>{(p) => <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as EmergencyReason)} placeholder="Choose one" options={EMERGENCY_REASONS.map((r) => ({ value: r.value, label: r.label }))} />}</Field>
            <Field label="What’s happening" required help="The patient and the Niveda team will read this.">{(p) => <Textarea {...p} rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="e.g. Brought to A&E unconscious after a fall; need allergies and current medicines before treatment." />}</Field>
            <div className="alert alert-warn"><Siren aria-hidden /><div>You’ll see <strong>allergies, medicines, conditions and surgeries</strong> for <strong>{EMERGENCY_HOURS} hours</strong>. The patient is notified straight away and can end it. Misuse can lead to losing access to Niveda.</div></div>
          </>
        ) : (
          <>
            <p className="small muted">Confirm it’s you with the 6-digit code sent to {challenge.destination}.</p>
            <OtpInput value={otp} onChange={setOtp} onComplete={(c) => void confirm(c)} disabled={busy} />
            <PrototypeCode challenge={challenge} onUse={(c) => { setOtp(c); void confirm(c); }} />
          </>
        )}
        <InlineError message={err} />
      </div>
    </Modal>
  );
}
