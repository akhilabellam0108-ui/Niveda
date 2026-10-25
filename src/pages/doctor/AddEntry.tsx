import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, X, Stethoscope, Activity, Pill, FlaskConical, CalendarClock, Paperclip, CheckCircle2, Lock, TriangleAlert, Siren, ShieldCheck, NotebookPen } from 'lucide-react';
import type { RecordData, RecordType } from '../../types';
import { doctorService, recordService, friendlyError, HANDOVER_MIN_LENGTH, type NewFile, type PrescriptionInput } from '../../services';
import { AppError } from '../../services/core';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useSession } from '../../state/SessionContext';
import { brand } from '../../config/brand';
import { ageFrom, fmtDate, fmtLongDate, timeLeft, todayISO } from '../../lib/dates';
import { RECORD_TYPES, isSevereAllergy, validateData, recordTitle, opt } from '../../lib/recordMeta';
import { Avatar, Badge, Button, ConfirmDialog, ErrorState, Field, InlineError, Input, Select, SkeletonList, Textarea } from '../../components/ui';
import { FilePicker, RecordFields } from '../../components/records/RecordForm';
import { TypeIcon } from '../../components/records/RecordCard';
import { HandoverNote } from '../../components/records/HandoverNote';
import { NoAccess } from './PatientView';

import { t } from '../../i18n';
import { T } from '../../i18n/T';
const FREQS = ['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Every night', 'Weekly', 'As needed'];
const emptyRx = (): PrescriptionInput => ({ name: '', dosage: '', frequency: 'Twice daily', durationDays: 5, startDate: todayISO(), instructions: '' });

/**
 * "Add to medical record": the doctor writes directly into the patient's
 * existing lifelong record. Nothing is created in a separate doctor system.
 */
export function AddEntryPage() {
  const { patientId = '' } = useParams();
  const navigate = useNavigate();
  const { doctor } = useSession();
  const ov = useLive(() => doctorService.patientOverview(patientId), [patientId]);
  const o = ov.data;
  useDocumentTitle(`${t('Add to record')} · ${brand.name}`);

  const [mode, setMode] = useState<'visit' | 'single'>('visit');
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [notes, setNotes] = useState('');
  const [dx, setDx] = useState({ condition: '', status: 'Active', severity: '' });
  const [rx, setRx] = useState<PrescriptionInput[]>([]);
  const [labs, setLabs] = useState<{ test: string; laboratory: string; reason: string }[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [files, setFiles] = useState<NewFile[]>([]);
  const [handover, setHandover] = useState('');
  const [single, setSingle] = useState<{ type: RecordType; date: string; data: RecordData; files: NewFile[] }>({ type: 'clinical_note', date: todayISO(), data: {}, files: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState<{ id: string; items: { type: RecordType; title: string }[]; files: number; handover?: string }>();

  const perms = o?.grant.permissions ?? [];
  const can = (t: RecordType) => perms.includes(RECORD_TYPES[t].permission);
  // Visits go through the Consultation tab, which always ends with the note for the next visit.
  const writable = useMemo(() => recordService.typesDoctorCanWrite(perms).filter((t): t is RecordType => t !== 'consultation'), [perms]);
  useEffect(() => { if (o && !writable.includes(single.type) && writable[0]) setSingle((s) => ({ ...s, type: writable[0], data: {} })); }, [o]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ov.error instanceof AppError && ov.error.code === 'ACCESS_DENIED') return <NoAccess message={ov.error.message} />;
  if (ov.error) return <ErrorState error={ov.error} onRetry={ov.reload} />;
  if (!o || !doctor) return <SkeletonList rows={6} />;

  const validate = () => {
    const v: Record<string, string> = {};
    if (mode === 'visit') {
      if (!reason.trim()) v.reason = t('Reason for visit is required');
      if (!date) v.date = t('Date is required');
      rx.forEach((r, i) => { if (!r.name.trim() || !r.dosage.trim()) v[`rx${i}`] = t('Medicine and dose are required'); });
      labs.forEach((l, i) => { if (!l.test.trim()) v[`lab${i}`] = t('Test name is required'); });
      if (followUp && followUp < date) v.followUp = t('Follow-up must be after the visit');
      if (!handover.trim()) v.handover = t('Write a note for the next visit before saving');
      else if (handover.trim().length < HANDOVER_MIN_LENGTH) v.handover = t('Add a little more detail (at least {n} characters)', { n: HANDOVER_MIN_LENGTH });
    } else {
      Object.assign(v, validateData(single.type, single.data));
      if (!single.date) v.date = t('Date is required');
    }
    setErrors(v);
    return !Object.keys(v).length;
  };

  const save = async () => {
    setErr(undefined);
    try {
      if (mode === 'visit') {
        const res = await recordService.addConsultation({
          patientId, date, reason, symptoms, notes, followUp: followUp || undefined, handoverNote: handover,
          diagnosis: dx.condition.trim() ? { condition: dx.condition, status: dx.status, severity: dx.severity || undefined } : undefined,
          prescriptions: rx, labOrders: labs, files,
        });
        setDone({ id: res.consultation.id, items: res.created.map((r) => ({ type: r.type, title: recordTitle(r) })), files: files.length, handover: handover.trim() });
      } else {
        const r = await recordService.create({ patientId, type: single.type, date: single.date, data: single.data, files: single.files });
        setDone({ id: r.id, items: [{ type: r.type, title: recordTitle(r) }], files: single.files.length });
      }
      window.scrollTo(0, 0);
    } catch (e) {
      setErr(friendlyError(e, t('This couldn’t be saved to the patient’s record. Nothing was added.')));
      throw e;
    }
  };

  if (done) {
    return (
      <section className="card">
        <div className="success-hero">
          <div className="ok-icon"><CheckCircle2 aria-hidden /></div>
          <h1 style={{ fontSize: 'var(--t-xl)' }}>{t('Added to {name}’s record', { name: o.patient.fullName })}</h1>
          <p className="muted">{t('These entries are now part of the patient’s lifelong timeline, attributed to you at {hospital}. The patient has been notified and the addition is in their access log.', { hospital: doctor.hospital?.name })}</p>
          <ul className="list card" style={{ width: '100%', maxWidth: 520, textAlign: 'left' }}>
            {done.items.map((i, k) => <li key={k} className="list-item"><TypeIcon type={i.type} size="sm" /><span className="grow small"><span className="muted">{t(RECORD_TYPES[i.type].label)}: </span><b>{i.title}</b></span></li>)}
            {done.handover && <li className="list-item"><span className="type-icon sm"><NotebookPen aria-hidden /></span><span className="grow small"><span className="muted">{t('Note for the next visit:')}{' '}</span>{done.handover}</span></li>}
            {done.files > 0 && <li className="list-item"><span className="type-icon sm"><Paperclip aria-hidden /></span><span className="grow small">{done.files > 1 ? t('{n} attachments linked', { n: done.files }) : t('1 attachment linked')}</span></li>}
          </ul>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button onClick={() => { setDone(undefined); setReason(''); setSymptoms(''); setNotes(''); setDx({ condition: '', status: 'Active', severity: '' }); setRx([]); setLabs([]); setFollowUp(''); setFiles([]); setHandover(''); setSingle({ ...single, data: {}, files: [] }); }}>{t('Add another entry')}</Button>
            <Button variant="primary" onClick={() => navigate(`/doctor/patients/${patientId}?record=${done.id}`)}>{t('View in patient’s record')}</Button>
          </div>
        </div>
      </section>
    );
  }

  const summary = mode === 'visit'
    ? [t('Consultation'), dx.condition && t('Diagnosis'), rx.length && (rx.length > 1 ? t('{n} prescriptions', { n: rx.length }) : t('1 prescription')), labs.length && (labs.length > 1 ? t('{n} lab orders', { n: labs.length }) : t('1 lab order')), followUp && t('Follow-up'), files.length && (files.length > 1 ? t('{n} attachments', { n: files.length }) : t('1 attachment')), t('a note for the next visit')].filter(Boolean).join(', ')
    : t(RECORD_TYPES[single.type].label);

  return (
    <>
      <div>
        <button className="back-link btn btn-ghost btn-sm" onClick={() => navigate(`/doctor/patients/${patientId}`)}><ArrowLeft aria-hidden />{t('Back to record')}</button>
        <div className="page-head">
          <div>
            <h1>{t('Add to medical record')}</h1>
            <p><T text="Your entry goes straight into {name}’s existing timeline, with your name and {hospital} attached. It can be corrected later, but never silently changed or removed." name={<b>{o.patient.fullName}</b>} hospital={doctor.hospital?.name} /></p>
          </div>
          <div className="segmented" role="group" aria-label={t('Entry type')}>
            <button aria-pressed={mode === 'visit'} onClick={() => setMode('visit')}>{t('Consultation')}</button>
            <button aria-pressed={mode === 'single'} onClick={() => setMode('single')}>{t('Other entry')}</button>
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <form className="card card-pad stack" style={{ '--gap': '22px' } as React.CSSProperties} onSubmit={(e) => { e.preventDefault(); if (validate()) setConfirm(true); }} noValidate>
          {mode === 'visit' ? (
            <>
              <section className="form-section">
                <div className="form-section-title"><Stethoscope aria-hidden />{t('Visit')}</div>
                <div className="form-grid">
                  <Field label={t('Reason for visit')} required error={errors.reason} className="wide">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. Fever and sore throat for 3 days')} />}</Field>
                  <Field label={t('Date of visit')} required error={errors.date}>{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
                  <Field label={t('Doctor / hospital')}>{(p) => <Input {...p} value={`${doctor.fullName} · ${doctor.hospital?.name}`} readOnly disabled />}</Field>
                  <Field label={t('Symptoms')} className="wide">{(p) => <Textarea {...p} rows={2} value={symptoms} onChange={(e) => setSymptoms(e.target.value)} />}</Field>
                  <Field label={t('Examination & notes')} className="wide">{(p) => <Textarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('Vitals, findings, advice given')} />}</Field>
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-title"><Activity aria-hidden />{t('Diagnosis')}{' '}<span className="xs subtle" style={{ fontWeight: 400 }}>{t('optional')}</span></div>
                <div className="form-grid">
                  <Field label={t('Condition')} className="wide">{(p) => <Input {...p} value={dx.condition} onChange={(e) => setDx({ ...dx, condition: e.target.value })} placeholder={t('e.g. Acute pharyngitis')} />}</Field>
                  <Field label={t('Status')}>{(p) => <Select {...p} value={dx.status} onChange={(e) => setDx({ ...dx, status: e.target.value })} options={[t('Active'), t('Suspected'), t('Managed'), t('Resolved')]} />}</Field>
                  <Field label={t('Severity')}>{(p) => <Select {...p} value={dx.severity} onChange={(e) => setDx({ ...dx, severity: e.target.value })} options={[t('Mild'), t('Moderate'), t('Severe'), t('Critical')]} placeholder="—" />}</Field>
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-title"><Pill aria-hidden />{t('Prescription')}</div>
                {!can('medication') ? <Locked what={t('medications')} /> : (
                  <>
                    {o.allergies.some(isSevereAllergy) && rx.length > 0 && (
                      <div className="alert alert-danger"><TriangleAlert aria-hidden /><div>{t('Check allergies before prescribing:')}{' '}{o.allergies.filter(isSevereAllergy).map((a) => String(a.data.allergen)).join(', ')}.</div></div>
                    )}
                    {rx.map((r, i) => (
                      <div key={i} className="rx-row">
                        <Field label={t('Medicine')} required error={errors[`rx${i}`]}>{(p) => <Input {...p} value={r.name} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />}</Field>
                        <Field label={t('Dose')} required>{(p) => <Input {...p} value={r.dosage} placeholder={t('500 mg')} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, dosage: e.target.value } : x)))} />}</Field>
                        <Field label={t('Frequency')}>{(p) => <Select {...p} value={r.frequency} options={FREQS} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, frequency: e.target.value } : x)))} />}</Field>
                        <Field label={t('Days')}>{(p) => <Input {...p} type="number" min={1} value={r.durationDays ?? ''} placeholder="ongoing" onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, durationDays: e.target.value ? Number(e.target.value) : undefined } : x)))} />}</Field>
                        <Button size="sm" variant="ghost" iconOnly icon={X} aria-label={t('Remove medicine')} onClick={() => setRx(rx.filter((_, j) => j !== i))} />
                        <Field label={t('Instructions')} className="wide">{(p) => <Input {...p} value={r.instructions ?? ''} placeholder={t('e.g. After food')} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, instructions: e.target.value } : x)))} />}</Field>
                      </div>
                    ))}
                    <Button icon={Plus} onClick={() => setRx([...rx, emptyRx()])} style={{ alignSelf: 'flex-start' }}>{t('Add medicine')}</Button>
                    {rx.length > 0 && <p className="xs subtle">{t('Prescribed medicines appear in the patient’s medication list automatically, starting {date}.', { date: fmtDate(date) })}</p>}
                  </>
                )}
              </section>

              <section className="form-section">
                <div className="form-section-title"><FlaskConical aria-hidden />{t('Lab tests to order')}</div>
                {!can('lab_test') ? <Locked what={t('lab reports')} /> : (
                  <>
                    {labs.map((l, i) => (
                      <div key={i} className="rx-row" style={{ gridTemplateColumns: '1.3fr 1fr 1.3fr auto' }}>
                        <Field label={t('Test')} required error={errors[`lab${i}`]}>{(p) => <Input {...p} value={l.test} placeholder={t('e.g. CBC')} onChange={(e) => setLabs(labs.map((x, j) => (j === i ? { ...x, test: e.target.value } : x)))} />}</Field>
                        <Field label={t('Laboratory')}>{(p) => <Input {...p} value={l.laboratory} onChange={(e) => setLabs(labs.map((x, j) => (j === i ? { ...x, laboratory: e.target.value } : x)))} />}</Field>
                        <Field label={t('Reason')}>{(p) => <Input {...p} value={l.reason} onChange={(e) => setLabs(labs.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} />}</Field>
                        <Button size="sm" variant="ghost" iconOnly icon={X} aria-label={t('Remove test')} onClick={() => setLabs(labs.filter((_, j) => j !== i))} />
                      </div>
                    ))}
                    <Button icon={Plus} onClick={() => setLabs([...labs, { test: '', laboratory: '', reason: '' }])} style={{ alignSelf: 'flex-start' }}>{t('Order a test')}</Button>
                    {labs.length > 0 && <p className="xs subtle">{t('Results can be added to each order later — by you, the lab, or the patient.')}</p>}
                  </>
                )}
              </section>

              <section className="form-section">
                <div className="form-section-title"><CalendarClock aria-hidden />{t('Follow-up')}</div>
                <Field label={t('Follow-up date')} error={errors.followUp}>{(p) => <Input {...p} type="date" value={followUp} min={date} onChange={(e) => setFollowUp(e.target.value)} style={{ maxWidth: 240 }} />}</Field>
              </section>

              <section className="form-section">
                <div className="form-section-title"><Paperclip aria-hidden />{t('Attachments')}</div>
                <FilePicker files={files} onChange={setFiles} label={t('Attach reports, scans or the prescription')} compact />
              </section>

              <section className="form-section">
                <div className="form-section-title"><NotebookPen aria-hidden />{t('Note for the next visit')}</div>
                <Field label={t('What should the next doctor know?')} required error={errors.handover} className="handover-field"
                  help={t('Shown at the top of {fullName}’s record to whoever sees them next — you at the follow-up, or another doctor if they go elsewhere.', { fullName: o.patient.fullName })}>
                  {(p) => <Textarea {...p} rows={4} value={handover} onChange={(e) => setHandover(e.target.value)}
                    placeholder={t('e.g. Recheck BP at follow-up. If headaches persist past 2 weeks despite screen breaks, consider MRI brain. Started paracetamol only — avoid NSAIDs (gastritis history).')} />}
                </Field>
              </section>
            </>
          ) : (
            <section className="stack">
              <Field label={t('Entry type')}>{(p) => <Select {...p} value={single.type} onChange={(e) => setSingle({ ...single, type: e.target.value as RecordType, data: {} })} options={writable.map((type) => ({ value: type, label: t(RECORD_TYPES[type].label) }))} />}</Field>
              <RecordFields type={single.type} date={single.date} onDate={(d) => setSingle({ ...single, date: d })} data={single.data} onChange={(d) => setSingle({ ...single, data: d })} errors={errors} />
              <FilePicker files={single.files} onChange={(f) => setSingle({ ...single, files: f })} compact />
            </section>
          )}
          <InlineError message={err} />
          <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button onClick={() => navigate(`/doctor/patients/${patientId}`)}>{t('Cancel')}</Button>
            <Button type="submit" variant="primary" size="lg" icon={ShieldCheck}>{t('Save to patient medical record')}</Button>
          </div>
        </form>

        <aside className="sticky-side" aria-label={t('Relevant history')}>
          <section className="card card-pad stack" style={{ '--gap': '12px' } as React.CSSProperties}>
            <div className="row"><Avatar name={o.patient.fullName} src={o.patient.photoDataUrl} /><div><div className="strong">{o.patient.fullName}</div><div className="xs muted">{t('{n} yrs', { n: ageFrom(o.patient.dateOfBirth) })} · {o.patient.bloodGroup ?? '—'} · {t('access {time}', { time: timeLeft(o.grant.expiresAt) })}</div></div></div>
            {o.patient.importantNotes && <div className="alert alert-danger"><Siren aria-hidden /><div className="small">{o.patient.importantNotes}</div></div>}
            <SideList title={t('Allergies')} items={o.allergies.map((a) => ({ t: String(a.data.allergen), s: opt(a.data.severity), danger: isSevereAllergy(a) }))} empty={can('allergy') ? t('None known') : t('Not shared')} />
            <SideList title={t('Current medications')} items={o.activeMedications.map((m) => ({ t: `${m.data.name} ${m.data.dosage}`, s: opt(m.data.frequency) }))} empty={can('medication') ? t('None') : t('Not shared')} />
            <SideList title={t('Conditions')} items={o.conditions.map((c) => ({ t: String(c.data.condition), s: opt(c.data.status) }))} empty={can('diagnosis') ? t('None recorded') : t('Not shared')} />
            {o.handover && <HandoverNote record={o.handover} compact />}
            {o.lastVisit && <div className="xs muted">{t('Last visit:')}{' '}{fmtLongDate(o.lastVisit.date)} — {recordTitle(o.lastVisit)}</div>}
          </section>
        </aside>
      </div>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} confirmLabel={t('Save to record')} title={t('Add to {fullName}’s record?', { fullName: o.patient.fullName })}
        body={<T text="You’re adding: {summary}. It will be attributed permanently to {doctor}, {hospital}, and the patient will be notified." summary={<b>{summary}</b>} doctor={<b>{doctor.fullName}</b>} hospital={doctor.hospital?.name} />}
        onConfirm={save} />
    </>
  );
}

function Locked({ what }: { what: string }) {
  return <div className="alert alert-info"><Lock aria-hidden /><div>{t('The patient hasn’t shared their {what} with you, so you can’t add to this part of the record.', { what })}</div></div>;
}

function SideList({ title, items, empty }: { title: string; items: { t: string; s: string; danger?: boolean }[]; empty: string }) {
  return (
    <div>
      <div className="xs subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{title}</div>
      {items.length === 0 ? <div className="small subtle">{empty}</div> : (
        <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
          {items.map((i, k) => <div key={k} className="small spread"><span style={{ color: i.danger ? 'var(--danger)' : undefined, fontWeight: i.danger ? 600 : 500 }}>{i.t}</span>{i.danger ? <Badge tone="danger">{i.s}</Badge> : <span className="xs muted">{i.s}</span>}</div>)}
        </div>
      )}
    </div>
  );
}
