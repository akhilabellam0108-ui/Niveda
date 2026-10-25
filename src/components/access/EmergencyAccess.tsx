import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Siren } from 'lucide-react';
import {
  accessService, friendlyError, EMERGENCY_REASONS, EMERGENCY_HOURS, type EmergencyReason, type OtpChallenge,
} from '../../services';
import { useToast } from '../../state/ToastContext';
import { Button, Field, InlineError, Input, Modal, Select, Textarea } from '../ui';
import { OtpInput, PrototypeCode } from '../ui/Otp';

import { t } from '../../i18n';
import { T } from '../../i18n/T';
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
          <h2 style={{ fontSize: 'var(--t-md)' }}>{t('Patient can’t give consent?')}</h2>
          <p className="small muted">{t('In an emergency — unconscious, unable to communicate — you can open their allergies, medicines, conditions and surgeries for {n} hours. The patient is told at once, and every use is reviewed by the Niveda team.', { n: EMERGENCY_HOURS })}</p>
        </div>
        <Button variant="danger" icon={Siren} onClick={() => setOpen(true)}>{t('Emergency access')}</Button>
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
      toast(t('Emergency access for {EMERGENCY_HOURS} hours. The patient has been told.', { EMERGENCY_HOURS }));
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
    <Modal open onClose={() => !busy && onClose()} title={t('Emergency access')} size="md"
      description={t('Use this only when the patient can’t consent and you need their information to treat them now.')}
      footer={!challenge ? (
        <><Button onClick={onClose} disabled={busy}>{t('Cancel')}</Button><Button variant="danger" loading={busy} disabled={!ready} onClick={sendCode}>{t('Continue')}</Button></>
      ) : (
        <><Button onClick={() => { setChallenge(undefined); setOtp(''); }} disabled={busy}>{t('Back')}</Button><Button variant="danger" icon={Siren} loading={busy} disabled={otp.length !== 6} onClick={() => confirm()}>{t('Open emergency access')}</Button></>
      )}>
      <div className="stack">
        {!challenge ? (
          <>
            <Field label={t('Patient ID')} required help={t('On their Niveda card, phone lock screen or QR code')}>{(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('NV-0000-0000')} autoCapitalize="characters" />}</Field>
            <Field label={t('Why they can’t consent')} required>{(p) => <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as EmergencyReason)} placeholder={t('Choose one')} options={EMERGENCY_REASONS.map((r) => ({ value: r.value, label: t(r.label) }))} />}</Field>
            <Field label={t('What’s happening')} required help={t('The patient and the Niveda team will read this.')}>{(p) => <Textarea {...p} rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder={t('e.g. Brought to A&E unconscious after a fall; need allergies and current medicines before treatment.')} />}</Field>
            <div className="alert alert-warn"><Siren aria-hidden /><div><T text="You’ll see {what} for {time}. The patient is notified straight away and can end it. Misuse can lead to losing access to Niveda." what={<strong>{t('allergies, medicines, conditions and surgeries')}</strong>} time={<strong>{t('{n} hours', { n: EMERGENCY_HOURS })}</strong>} /></div></div>
          </>
        ) : (
          <>
            <p className="small muted">{t('Confirm it’s you with the 6-digit code sent to {destination}.', { destination: challenge.destination })}</p>
            <OtpInput value={otp} onChange={setOtp} onComplete={(c) => void confirm(c)} disabled={busy} />
            <PrototypeCode challenge={challenge} onUse={(c) => { setOtp(c); void confirm(c); }} />
          </>
        )}
        <InlineError message={err} />
      </div>
    </Modal>
  );
}
