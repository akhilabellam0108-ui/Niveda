import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, PencilLine, Printer, Siren, TriangleAlert, Activity, Pill, UserRound, QrCode as QrIcon, Info } from 'lucide-react';
import { patientService, friendlyError } from '../../services';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useSession } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { brand } from '../../config/brand';
import { ageFrom, fmtDate, todayISO } from '../../lib/dates';
import { isSevereAllergy, opt } from '../../lib/recordMeta';
import { Button, ErrorState, Field, InlineError, Input, Modal, Select, Skeleton, Textarea } from '../../components/ui';
import { QrCode } from '../../components/access/Qr';
import { BLOOD_GROUPS } from '../auth/Onboarding';

import { t } from '../../i18n';
import { ageLabel, isAdult } from '../../lib/immunization';
import { T } from '../../i18n/T';
export function EmergencyPage() {
  useDocumentTitle(`${t('Emergency')} · ${brand.name}`);
  const { patient } = useSession();
  const toast = useToast();
  const em = useLive(() => patientService.emergencyProfile(), []);
  const [editing, setEditing] = useState(false);
  if (!patient) return null;
  const e = em.data;

  const qrText = e ? [
    `EMERGENCY MEDICAL INFO — ${patient.fullName}`,
    `DOB ${fmtDate(patient.dateOfBirth)} · Blood ${patient.bloodGroup ?? 'unknown'}`,
    e.allergies.length ? `ALLERGIES: ${e.allergies.map((a) => `${a.data.allergen} (${opt(a.data.severity)})`).join('; ')}` : t('No known allergies'),
    e.conditions.length ? `Conditions: ${e.conditions.map((c) => c.data.condition).join('; ')}` : '',
    e.activeMedications.length ? `Medicines: ${e.activeMedications.map((m) => `${m.data.name} ${m.data.dosage}`).join('; ')}` : '',
    patient.importantNotes ? `Note: ${patient.importantNotes}` : '',
    patient.emergencyContact ? `Contact: ${patient.emergencyContact.name} (${patient.emergencyContact.relationship}) ${patient.emergencyContact.phone}` : '',
  ].filter(Boolean).join('\n') : '';

  return (
    <>
      <div className="page-head">
        <div><h1>{t('Emergency profile')}</h1><p>{t('The essentials a first responder or emergency doctor needs, in one place.')}</p></div>
        <div className="actions">
          <Button icon={Printer} onClick={() => window.print()}>{t('Print card')}</Button>
          <Button variant="primary" icon={PencilLine} onClick={() => setEditing(true)}>{t('Edit details')}</Button>
        </div>
      </div>
      {em.error ? <ErrorState error={em.error} onRetry={em.reload} /> : !e ? <Skeleton h={420} r={14} /> : (
        <div className="dash-grid">
          <article className="emergency-card" aria-label={t('Emergency card')}>
            <div className="emergency-head">
              <Siren size={28} aria-hidden />
              <div>
                <div style={{ fontSize: 12, opacity: .85, letterSpacing: '.08em' }}>{t('EMERGENCY MEDICAL INFORMATION')}</div>
                <div style={{ fontSize: 22, fontWeight: 650 }}>{patient.fullName}</div>
                <div style={{ fontSize: 13, opacity: .9 }}>{isAdult(patient.dateOfBirth) ? t('{n} yrs', { n: ageFrom(patient.dateOfBirth) }) : ageLabel(patient.dateOfBirth, todayISO())} · {t('born {date}', { date: fmtDate(patient.dateOfBirth) })}{patient.sex ? ` · ${t(patient.sex)}` : ''}</div>
              </div>
              <div className="blood"><span>{t('Blood')}</span><b>{patient.bloodGroup ?? '?'}</b></div>
            </div>
            {e.warnings.length > 0 && (
              <div className="emergency-section" style={{ background: 'var(--danger-soft)' }}>
                <h3 style={{ color: 'var(--danger)' }}>{t('Important warnings')}</h3>
                <ul className="stack" style={{ '--gap': '6px', margin: 0, paddingLeft: 18 } as React.CSSProperties}>{e.warnings.map((w) => <li key={w} className="strong small">{w}</li>)}</ul>
              </div>
            )}
            <div className="emergency-section">
              <h3><TriangleAlert size={12} aria-hidden />{' '}{t('Allergies')}</h3>
              {e.allergies.length ? <div className="allergy-strip">{e.allergies.map((a) => <span key={a.id} className={`allergy-pill ${isSevereAllergy(a) ? 'severe' : ''}`}>{String(a.data.allergen)}<span className="reaction">· {String(a.data.reaction)}</span></span>)}</div> : <p className="small">{patient.declarations?.noAllergies ? t('No known allergies (confirmed {value})', { value: fmtDate(patient.declarations.confirmedAt) }) : t('None recorded')}</p>}
            </div>
            <div className="emergency-section">
              <h3><Activity size={12} aria-hidden />{' '}{t('Conditions')}</h3>
              <p className="small">{e.conditions.length ? e.conditions.map((c) => String(c.data.condition)).join(' · ') : t('None recorded')}</p>
            </div>
            <div className="emergency-section">
              <h3><Pill size={12} aria-hidden />{' '}{t('Current medications')}</h3>
              {e.activeMedications.length ? <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{e.activeMedications.map((m) => <li key={m.id}><b>{String(m.data.name)}</b> {String(m.data.dosage)} — {opt(m.data.frequency)}</li>)}</ul> : <p className="small">{t('None')}</p>}
            </div>
            <div className="emergency-section">
              <h3><UserRound size={12} aria-hidden />{' '}{t('Emergency contact')}</h3>
              {patient.emergencyContact?.name ? (
                <div className="spread">
                  <div className="small"><b>{patient.emergencyContact.name}</b> · {patient.emergencyContact.relationship}<div className="muted num">{patient.emergencyContact.phone}</div></div>
                  <a className="btn btn-secondary btn-sm" href={`tel:${patient.emergencyContact.phone.replace(/\s/g, '')}`}><Phone aria-hidden />{t('Call')}</a>
                </div>
              ) : <Button size="sm" onClick={() => setEditing(true)}>{t('Add emergency contact')}</Button>}
            </div>
          </article>

          <div className="stack">
            <section className="card card-pad stack">
              <div className="spread">
                <div><h2 style={{ fontSize: 'var(--t-md)' }}>{t('Emergency access')}</h2><p className="small muted">{t('Let responders see this card without your password.')}</p></div>
                <label className="check" style={{ alignItems: 'center' }}>
                  <input type="checkbox" checked={patient.emergencyCardEnabled} onChange={async (ev) => {
                    try { await patientService.updateProfile({ emergencyCardEnabled: ev.target.checked }); toast(ev.target.checked ? t('Emergency card turned on') : t('Emergency card turned off')); } catch (x) { toast(friendlyError(x), 'error'); }
                  }} />
                  <span className="sr-only">{t('Emergency card enabled')}</span>
                </label>
              </div>
              {patient.emergencyCardEnabled ? (
                <>
                  <QrCode value={qrText} size={180} label={t('Emergency information QR code')} />
                  <p className="xs muted" style={{ textAlign: 'center' }}><QrIcon size={12} aria-hidden />{' '}{t('Any phone camera can read this QR — even offline. It holds only what’s on this card, never your full record.')}</p>
                  <div className="lock-screen" aria-label={t('Lock-screen preview')}>
                    <div className="time">9:41</div>
                    <div className="lock-card">
                      <div style={{ fontWeight: 650, marginBottom: 4 }}>{t('⚕ Medical ID ·')}{' '}{patient.fullName}</div>
                      <div>{t('Blood')}{' '}{patient.bloodGroup ?? '?'} · {e.allergies.filter(isSevereAllergy).map((a) => `${a.data.allergen} allergy`).join(', ') || t('No severe allergies')}</div>
                      {patient.emergencyContact?.name && <div style={{ opacity: .8 }}>{t('ICE:')}{' '}{patient.emergencyContact.name} {patient.emergencyContact.phone}</div>}
                    </div>
                  </div>
                  <p className="xs subtle" style={{ textAlign: 'center' }}>{t('Preview of a lock-screen widget. Requires the mobile app (not part of this prototype).')}</p>
                </>
              ) : (
                <div className="alert alert-info"><Info aria-hidden /><div>{t('Your emergency card is only visible to you and doctors you’ve granted access to.')}</div></div>
              )}
            </section>
            <p className="xs subtle"><T text="Doctors with active access see this card at the top of your record. Changes to allergies and medicines update it automatically — manage them in {allergies} and {medications}." allergies={<Link to="/app/allergies">{t('Allergies')}</Link>} medications={<Link to="/app/medications">{t('Medications')}</Link>} /></p>
          </div>
        </div>
      )}
      <EditEmergency open={editing} onClose={() => setEditing(false)} />
    </>
  );
}

function EditEmergency({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { patient } = useSession();
  const toast = useToast();
  const [blood, setBlood] = useState('');
  const [c, setC] = useState({ name: '', relationship: '', phone: '' });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    if (open && patient) { setBlood(patient.bloodGroup ?? ''); setC({ name: '', relationship: '', phone: '', ...patient.emergencyContact }); setNotes(patient.importantNotes ?? ''); setErr(undefined); }
  }, [open, patient]);
  return (
    <Modal open={open} onClose={onClose} title={t('Emergency details')}
      footer={<><Button onClick={onClose} disabled={busy}>{t('Cancel')}</Button><Button variant="primary" loading={busy} onClick={async () => {
        setBusy(true);
        try {
          await patientService.updateProfile({ bloodGroup: blood || undefined, emergencyContact: c, importantNotes: notes.trim() || undefined });
          toast(t('Emergency details saved'));
          onClose();
        } catch (x) { setErr(friendlyError(x)); } finally { setBusy(false); }
      }}>{t('Save')}</Button></>}>
      <div className="stack">
        <Field label={t('Blood group')}>{(p) => <Select {...p} value={blood} onChange={(e) => setBlood(e.target.value)} options={BLOOD_GROUPS} placeholder={t('Unknown')} />}</Field>
        <div className="form-grid">
          <Field label={t('Emergency contact')} required className="wide">{(p) => <Input {...p} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />}</Field>
          <Field label={t('Relationship')} required>{(p) => <Input {...p} value={c.relationship} onChange={(e) => setC({ ...c, relationship: e.target.value })} />}</Field>
          <Field label={t('Phone')} required>{(p) => <Input {...p} type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />}</Field>
        </div>
        <Field label={t('Important medical warnings')} help={t('e.g. carries an inhaler, pacemaker, pregnant')}>{(p) => <Textarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <InlineError message={err} />
      </div>
    </Modal>
  );
}
