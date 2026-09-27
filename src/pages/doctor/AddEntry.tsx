import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, X, Stethoscope, Activity, Pill, FlaskConical, CalendarClock, Paperclip, CheckCircle2, Lock, TriangleAlert, Siren, ShieldCheck } from 'lucide-react';
import type { RecordData, RecordType } from '../../types';
import { doctorService, recordService, friendlyError, type NewFile, type PrescriptionInput } from '../../services';
import { AppError } from '../../services/core';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useSession } from '../../state/SessionContext';
import { brand } from '../../config/brand';
import { ageFrom, fmtDate, fmtLongDate, timeLeft, todayISO } from '../../lib/dates';
import { RECORD_TYPES, isSevereAllergy, validateData, recordTitle } from '../../lib/recordMeta';
import { Avatar, Badge, Button, ConfirmDialog, ErrorState, Field, InlineError, Input, Select, SkeletonList, Textarea } from '../../components/ui';
import { FilePicker, RecordFields } from '../../components/records/RecordForm';
import { TypeIcon } from '../../components/records/RecordCard';
import { NoAccess } from './PatientView';

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
  useDocumentTitle(`Add to record · ${brand.name}`);

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
  const [single, setSingle] = useState<{ type: RecordType; date: string; data: RecordData; files: NewFile[] }>({ type: 'clinical_note', date: todayISO(), data: {}, files: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState<{ id: string; items: { type: RecordType; title: string }[]; files: number }>();

  const perms = o?.grant.permissions ?? [];
  const can = (t: RecordType) => perms.includes(RECORD_TYPES[t].permission);
  const writable = useMemo(() => recordService.typesDoctorCanWrite(perms), [perms]);
  useEffect(() => { if (o && !writable.includes(single.type) && writable[0]) setSingle((s) => ({ ...s, type: writable[0], data: {} })); }, [o]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ov.error instanceof AppError && ov.error.code === 'ACCESS_DENIED') return <NoAccess message={ov.error.message} />;
  if (ov.error) return <ErrorState error={ov.error} onRetry={ov.reload} />;
  if (!o || !doctor) return <SkeletonList rows={6} />;

  const validate = () => {
    const v: Record<string, string> = {};
    if (mode === 'visit') {
      if (!reason.trim()) v.reason = 'Reason for visit is required';
      if (!date) v.date = 'Date is required';
      rx.forEach((r, i) => { if (!r.name.trim() || !r.dosage.trim()) v[`rx${i}`] = 'Medicine and dose are required'; });
      labs.forEach((l, i) => { if (!l.test.trim()) v[`lab${i}`] = 'Test name is required'; });
      if (followUp && followUp < date) v.followUp = 'Follow-up must be after the visit';
    } else {
      Object.assign(v, validateData(single.type, single.data));
      if (!single.date) v.date = 'Date is required';
    }
    setErrors(v);
    return !Object.keys(v).length;
  };

  const save = async () => {
    setErr(undefined);
    try {
      if (mode === 'visit') {
        const res = await recordService.addConsultation({
          patientId, date, reason, symptoms, notes, followUp: followUp || undefined,
          diagnosis: dx.condition.trim() ? { condition: dx.condition, status: dx.status, severity: dx.severity || undefined } : undefined,
          prescriptions: rx, labOrders: labs, files,
        });
        setDone({ id: res.consultation.id, items: res.created.map((r) => ({ type: r.type, title: recordTitle(r) })), files: files.length });
      } else {
        const r = await recordService.create({ patientId, type: single.type, date: single.date, data: single.data, files: single.files });
        setDone({ id: r.id, items: [{ type: r.type, title: recordTitle(r) }], files: single.files.length });
      }
      window.scrollTo(0, 0);
    } catch (e) {
      setErr(friendlyError(e, 'This couldn’t be saved to the patient’s record. Nothing was added.'));
      throw e;
    }
  };

  if (done) {
    return (
      <section className="card">
        <div className="success-hero">
          <div className="ok-icon"><CheckCircle2 aria-hidden /></div>
          <h1 style={{ fontSize: 'var(--t-xl)' }}>Added to {o.patient.fullName}’s record</h1>
          <p className="muted">These entries are now part of the patient’s lifelong timeline, attributed to you at {doctor.hospital?.name}. The patient has been notified and the addition is in their access log.</p>
          <ul className="list card" style={{ width: '100%', maxWidth: 520, textAlign: 'left' }}>
            {done.items.map((i, k) => <li key={k} className="list-item"><TypeIcon type={i.type} size="sm" /><span className="grow small"><span className="muted">{RECORD_TYPES[i.type].label}: </span><b>{i.title}</b></span></li>)}
            {done.files > 0 && <li className="list-item"><span className="type-icon sm"><Paperclip aria-hidden /></span><span className="grow small">{done.files} attachment{done.files > 1 ? 's' : ''} linked</span></li>}
          </ul>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button onClick={() => { setDone(undefined); setReason(''); setSymptoms(''); setNotes(''); setDx({ condition: '', status: 'Active', severity: '' }); setRx([]); setLabs([]); setFollowUp(''); setFiles([]); setSingle({ ...single, data: {}, files: [] }); }}>Add another entry</Button>
            <Button variant="primary" onClick={() => navigate(`/doctor/patients/${patientId}?record=${done.id}`)}>View in patient’s record</Button>
          </div>
        </div>
      </section>
    );
  }

  const summary = mode === 'visit'
    ? ['Consultation', dx.condition && 'Diagnosis', rx.length && `${rx.length} prescription${rx.length > 1 ? 's' : ''}`, labs.length && `${labs.length} lab order${labs.length > 1 ? 's' : ''}`, followUp && 'Follow-up', files.length && `${files.length} attachment${files.length > 1 ? 's' : ''}`].filter(Boolean).join(', ')
    : RECORD_TYPES[single.type].label;

  return (
    <>
      <div>
        <button className="back-link btn btn-ghost btn-sm" onClick={() => navigate(`/doctor/patients/${patientId}`)}><ArrowLeft aria-hidden />Back to record</button>
        <div className="page-head">
          <div>
            <h1>Add to medical record</h1>
            <p>Your entry goes straight into <b>{o.patient.fullName}</b>’s existing timeline, with your name and {doctor.hospital?.name} attached. It can be corrected later, but never silently changed or removed.</p>
          </div>
          <div className="segmented" role="group" aria-label="Entry type">
            <button aria-pressed={mode === 'visit'} onClick={() => setMode('visit')}>Consultation</button>
            <button aria-pressed={mode === 'single'} onClick={() => setMode('single')}>Other entry</button>
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <form className="card card-pad stack" style={{ '--gap': '22px' } as React.CSSProperties} onSubmit={(e) => { e.preventDefault(); if (validate()) setConfirm(true); }} noValidate>
          {mode === 'visit' ? (
            <>
              <section className="form-section">
                <div className="form-section-title"><Stethoscope aria-hidden />Visit</div>
                <div className="form-grid">
                  <Field label="Reason for visit" required error={errors.reason} className="wide">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fever and sore throat for 3 days" />}</Field>
                  <Field label="Date of visit" required error={errors.date}>{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
                  <Field label="Doctor / hospital">{(p) => <Input {...p} value={`${doctor.fullName} · ${doctor.hospital?.name}`} readOnly disabled />}</Field>
                  <Field label="Symptoms" className="wide">{(p) => <Textarea {...p} rows={2} value={symptoms} onChange={(e) => setSymptoms(e.target.value)} />}</Field>
                  <Field label="Examination & notes" className="wide">{(p) => <Textarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Vitals, findings, advice given" />}</Field>
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-title"><Activity aria-hidden />Diagnosis <span className="xs subtle" style={{ fontWeight: 400 }}>optional</span></div>
                <div className="form-grid">
                  <Field label="Condition" className="wide">{(p) => <Input {...p} value={dx.condition} onChange={(e) => setDx({ ...dx, condition: e.target.value })} placeholder="e.g. Acute pharyngitis" />}</Field>
                  <Field label="Status">{(p) => <Select {...p} value={dx.status} onChange={(e) => setDx({ ...dx, status: e.target.value })} options={['Active', 'Suspected', 'Managed', 'Resolved']} />}</Field>
                  <Field label="Severity">{(p) => <Select {...p} value={dx.severity} onChange={(e) => setDx({ ...dx, severity: e.target.value })} options={['Mild', 'Moderate', 'Severe', 'Critical']} placeholder="—" />}</Field>
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-title"><Pill aria-hidden />Prescription</div>
                {!can('medication') ? <Locked what="medications" /> : (
                  <>
                    {o.allergies.some(isSevereAllergy) && rx.length > 0 && (
                      <div className="alert alert-danger"><TriangleAlert aria-hidden /><div>Check allergies before prescribing: {o.allergies.filter(isSevereAllergy).map((a) => String(a.data.allergen)).join(', ')}.</div></div>
                    )}
                    {rx.map((r, i) => (
                      <div key={i} className="rx-row">
                        <Field label="Medicine" required error={errors[`rx${i}`]}>{(p) => <Input {...p} value={r.name} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />}</Field>
                        <Field label="Dose" required>{(p) => <Input {...p} value={r.dosage} placeholder="500 mg" onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, dosage: e.target.value } : x)))} />}</Field>
                        <Field label="Frequency">{(p) => <Select {...p} value={r.frequency} options={FREQS} onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, frequency: e.target.value } : x)))} />}</Field>
                        <Field label="Days">{(p) => <Input {...p} type="number" min={1} value={r.durationDays ?? ''} placeholder="ongoing" onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, durationDays: e.target.value ? Number(e.target.value) : undefined } : x)))} />}</Field>
                        <Button size="sm" variant="ghost" iconOnly icon={X} aria-label="Remove medicine" onClick={() => setRx(rx.filter((_, j) => j !== i))} />
                        <Field label="Instructions" className="wide">{(p) => <Input {...p} value={r.instructions ?? ''} placeholder="e.g. After food" onChange={(e) => setRx(rx.map((x, j) => (j === i ? { ...x, instructions: e.target.value } : x)))} />}</Field>
                      </div>
                    ))}
                    <Button icon={Plus} onClick={() => setRx([...rx, emptyRx()])} style={{ alignSelf: 'flex-start' }}>Add medicine</Button>
                    {rx.length > 0 && <p className="xs subtle">Prescribed medicines appear in the patient’s medication list automatically, starting {fmtDate(date)}.</p>}
                  </>
                )}
              </section>

              <section className="form-section">
                <div className="form-section-title"><FlaskConical aria-hidden />Lab tests to order</div>
                {!can('lab_test') ? <Locked what="lab reports" /> : (
                  <>
                    {labs.map((l, i) => (
                      <div key={i} className="rx-row" style={{ gridTemplateColumns: '1.3fr 1fr 1.3fr auto' }}>
                        <Field label="Test" required error={errors[`lab${i}`]}>{(p) => <Input {...p} value={l.test} placeholder="e.g. CBC" onChange={(e) => setLabs(labs.map((x, j) => (j === i ? { ...x, test: e.target.value } : x)))} />}</Field>
                        <Field label="Laboratory">{(p) => <Input {...p} value={l.laboratory} onChange={(e) => setLabs(labs.map((x, j) => (j === i ? { ...x, laboratory: e.target.value } : x)))} />}</Field>
                        <Field label="Reason">{(p) => <Input {...p} value={l.reason} onChange={(e) => setLabs(labs.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} />}</Field>
                        <Button size="sm" variant="ghost" iconOnly icon={X} aria-label="Remove test" onClick={() => setLabs(labs.filter((_, j) => j !== i))} />
                      </div>
                    ))}
                    <Button icon={Plus} onClick={() => setLabs([...labs, { test: '', laboratory: '', reason: '' }])} style={{ alignSelf: 'flex-start' }}>Order a test</Button>
                    {labs.length > 0 && <p className="xs subtle">Results can be added to each order later — by you, the lab, or the patient.</p>}
                  </>
                )}
              </section>

              <section className="form-section">
                <div className="form-section-title"><CalendarClock aria-hidden />Follow-up</div>
                <Field label="Follow-up date" error={errors.followUp}>{(p) => <Input {...p} type="date" value={followUp} min={date} onChange={(e) => setFollowUp(e.target.value)} style={{ maxWidth: 240 }} />}</Field>
              </section>

              <section className="form-section">
                <div className="form-section-title"><Paperclip aria-hidden />Attachments</div>
                <FilePicker files={files} onChange={setFiles} label="Attach reports, scans or the prescription" compact />
              </section>
            </>
          ) : (
            <section className="stack">
              <Field label="Entry type">{(p) => <Select {...p} value={single.type} onChange={(e) => setSingle({ ...single, type: e.target.value as RecordType, data: {} })} options={writable.map((t) => ({ value: t, label: RECORD_TYPES[t].label }))} />}</Field>
              <RecordFields type={single.type} date={single.date} onDate={(d) => setSingle({ ...single, date: d })} data={single.data} onChange={(d) => setSingle({ ...single, data: d })} errors={errors} />
              <FilePicker files={single.files} onChange={(f) => setSingle({ ...single, files: f })} compact />
            </section>
          )}
          <InlineError message={err} />
          <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button onClick={() => navigate(`/doctor/patients/${patientId}`)}>Cancel</Button>
            <Button type="submit" variant="primary" size="lg" icon={ShieldCheck}>Save to patient medical record</Button>
          </div>
        </form>

        <aside className="sticky-side" aria-label="Relevant history">
          <section className="card card-pad stack" style={{ '--gap': '12px' } as React.CSSProperties}>
            <div className="row"><Avatar name={o.patient.fullName} src={o.patient.photoDataUrl} /><div><div className="strong">{o.patient.fullName}</div><div className="xs muted">{ageFrom(o.patient.dateOfBirth)} yrs · {o.patient.bloodGroup ?? '—'} · access {timeLeft(o.grant.expiresAt)}</div></div></div>
            {o.patient.importantNotes && <div className="alert alert-danger"><Siren aria-hidden /><div className="small">{o.patient.importantNotes}</div></div>}
            <SideList title="Allergies" items={o.allergies.map((a) => ({ t: String(a.data.allergen), s: String(a.data.severity), danger: isSevereAllergy(a) }))} empty={can('allergy') ? 'None known' : 'Not shared'} />
            <SideList title="Current medications" items={o.activeMedications.map((m) => ({ t: `${m.data.name} ${m.data.dosage}`, s: String(m.data.frequency) }))} empty={can('medication') ? 'None' : 'Not shared'} />
            <SideList title="Conditions" items={o.conditions.map((c) => ({ t: String(c.data.condition), s: String(c.data.status) }))} empty={can('diagnosis') ? 'None recorded' : 'Not shared'} />
            {o.lastVisit && <div className="xs muted">Last visit: {fmtLongDate(o.lastVisit.date)} — {recordTitle(o.lastVisit)}</div>}
          </section>
        </aside>
      </div>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} confirmLabel="Save to record" title={`Add to ${o.patient.fullName}’s record?`}
        body={<>You’re adding: <b>{summary}</b>. It will be attributed permanently to <b>{doctor.fullName}</b>, {doctor.hospital?.name}, and the patient will be notified.</>}
        onConfirm={save} />
    </>
  );
}

function Locked({ what }: { what: string }) {
  return <div className="alert alert-info"><Lock aria-hidden /><div>The patient hasn’t shared their {what} with you, so you can’t add to this part of the record.</div></div>;
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
