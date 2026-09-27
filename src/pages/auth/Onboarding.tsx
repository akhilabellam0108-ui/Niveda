import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Camera, ArrowLeft } from 'lucide-react';
import { brand } from '../../config/brand';
import { authService, patientService, friendlyError, type OnboardingInput } from '../../services';
import { useSession } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { useDocumentTitle } from '../../state/hooks';
import { Avatar, Button, Field, InlineError, Input, Select, Textarea } from '../../components/ui';
import { Brand } from '../../components/ui/Logo';

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const SEVERITIES = ['Mild', 'Moderate', 'Severe', 'Life-threatening'];
const FREQS = ['Once daily', 'Twice daily', 'Three times daily', 'Every night', 'Weekly', 'As needed'];

const STEPS = ['About you', 'Emergency contact', 'Allergies', 'Conditions & medicines', 'Past surgeries'];

export function readImage(file: File, max = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = url;
  });
}

export function OnboardingPage() {
  useDocumentTitle(`Set up · ${brand.name}`);
  const { patient, refresh } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardingInput>({ allergies: [], conditions: [], medications: [], surgeries: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const set = (p: Partial<OnboardingInput>) => setData((d) => ({ ...d, ...p }));

  const finish = async (skipAll = false) => {
    setBusy(true);
    setErr(undefined);
    try {
      if (skipAll) await authService.markOnboarded();
      else await patientService.completeOnboarding(data);
      await refresh();
      toast(skipAll ? 'You can add your details anytime' : 'Your record is set up');
      navigate('/app', { replace: true });
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : void finish());
  const first = patient?.fullName.split(' ')[0] ?? '';

  return (
    <div className="onboard">
      <div className="onboard-card stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        <div className="spread"><Brand /><Button variant="ghost" onClick={() => finish(true)} disabled={busy}>Skip for now</Button></div>
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          <div className="spread xs subtle strong"><span>STEP {step + 1} OF {STEPS.length} · {STEPS[step].toUpperCase()}</span></div>
          <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}><div style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
        </div>
        <div>
          <h1 className="display" style={{ fontSize: 32 }}>{step === 0 ? `Welcome, ${first}.` : STEPS[step]}</h1>
          <p className="muted" style={{ marginTop: 8 }}>{[
            'A few basics help in an emergency. Everything here is optional — you can skip any step.',
            'Who should be contacted if something happens to you?',
            'Allergies are shown prominently to any doctor you grant access to.',
            'Ongoing conditions and medicines you take regularly.',
            'Operations or procedures you’ve had in the past, and anything else doctors should know.',
          ][step]}</p>
        </div>

        <div className="card card-pad stack">
          {step === 0 && (
            <>
              <div className="row" style={{ '--gap': '16px' } as React.CSSProperties}>
                <Avatar name={patient?.fullName ?? '?'} src={data.photoDataUrl} size="xl" />
                <label className="btn btn-secondary">
                  <Camera aria-hidden />{data.photoDataUrl ? 'Change photo' : 'Add a photo'}
                  <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { set({ photoDataUrl: await readImage(f) }); } catch { setErr('That image couldn’t be read.'); } } }} />
                </label>
              </div>
              <Field label="Blood group" help="Shown on your emergency card.">
                {(p) => <Select {...p} value={data.bloodGroup ?? ''} onChange={(e) => set({ bloodGroup: e.target.value })} options={BLOOD_GROUPS} placeholder="I don’t know" />}
              </Field>
            </>
          )}
          {step === 1 && (
            <div className="form-grid">
              <Field label="Name" className="wide">{(p) => <Input {...p} value={data.emergencyContact?.name ?? ''} onChange={(e) => set({ emergencyContact: { relationship: '', phone: '', ...data.emergencyContact, name: e.target.value } })} />}</Field>
              <Field label="Relationship">{(p) => <Input {...p} placeholder="e.g. Sister" value={data.emergencyContact?.relationship ?? ''} onChange={(e) => set({ emergencyContact: { name: '', phone: '', ...data.emergencyContact, relationship: e.target.value } })} />}</Field>
              <Field label="Phone">{(p) => <Input {...p} type="tel" value={data.emergencyContact?.phone ?? ''} onChange={(e) => set({ emergencyContact: { name: '', relationship: '', ...data.emergencyContact, phone: e.target.value } })} />}</Field>
            </div>
          )}
          {step === 2 && (
            <Rows
              items={data.allergies} empty={{ allergen: '', severity: 'Moderate', reaction: '' }} addLabel="Add an allergy" onChange={(allergies) => set({ allergies })}
              render={(a, upd) => (
                <div className="form-grid">
                  <Field label="Allergen">{(p) => <Input {...p} value={a.allergen} placeholder="e.g. Penicillin, peanuts" onChange={(e) => upd({ allergen: e.target.value })} />}</Field>
                  <Field label="Severity">{(p) => <Select {...p} value={a.severity} options={SEVERITIES} onChange={(e) => upd({ severity: e.target.value })} />}</Field>
                  <Field label="Reaction" className="wide">{(p) => <Input {...p} value={a.reaction} placeholder="e.g. Rash, swelling" onChange={(e) => upd({ reaction: e.target.value })} />}</Field>
                </div>
              )}
            />
          )}
          {step === 3 && (
            <>
              <h3 className="small strong">Conditions</h3>
              <Rows items={data.conditions} empty={{ condition: '' }} addLabel="Add a condition" onChange={(conditions) => set({ conditions })}
                render={(c, upd) => <Field label="Condition">{(p) => <Input {...p} value={c.condition} placeholder="e.g. Asthma, hypertension" onChange={(e) => upd({ condition: e.target.value })} />}</Field>} />
              <hr className="divider" />
              <h3 className="small strong">Current medicines</h3>
              <Rows items={data.medications} empty={{ name: '', dosage: '', frequency: 'Once daily' }} addLabel="Add a medicine" onChange={(medications) => set({ medications })}
                render={(m, upd) => (
                  <div className="form-grid">
                    <Field label="Medicine">{(p) => <Input {...p} value={m.name} onChange={(e) => upd({ name: e.target.value })} />}</Field>
                    <Field label="Dose">{(p) => <Input {...p} value={m.dosage} placeholder="e.g. 10 mg" onChange={(e) => upd({ dosage: e.target.value })} />}</Field>
                    <Field label="How often" className="wide">{(p) => <Select {...p} value={m.frequency} options={FREQS} onChange={(e) => upd({ frequency: e.target.value })} />}</Field>
                  </div>
                )} />
            </>
          )}
          {step === 4 && (
            <>
              <Rows items={data.surgeries} empty={{ procedure: '', date: '' }} addLabel="Add a surgery or procedure" onChange={(surgeries) => set({ surgeries })}
                render={(s, upd) => (
                  <div className="form-grid">
                    <Field label="Procedure">{(p) => <Input {...p} value={s.procedure} onChange={(e) => upd({ procedure: e.target.value })} />}</Field>
                    <Field label="Approximate date">{(p) => <Input {...p} type="date" value={s.date} onChange={(e) => upd({ date: e.target.value })} />}</Field>
                  </div>
                )} />
              <Field label="Anything else doctors should know?" help="Shown on your emergency card, e.g. pacemaker, pregnancy, carries an inhaler.">
                {(p) => <Textarea {...p} rows={3} value={data.importantNotes ?? ''} onChange={(e) => set({ importantNotes: e.target.value })} />}
              </Field>
            </>
          )}
        </div>
        <InlineError message={err} />
        <div className="spread">
          {step > 0 ? <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(step - 1)} disabled={busy}>Back</Button> : <span />}
          <div className="row">
            {step < STEPS.length - 1 && <Button variant="ghost" onClick={() => setStep(step + 1)} disabled={busy}>Skip this step</Button>}
            <Button variant="primary" onClick={next} loading={busy}>{step === STEPS.length - 1 ? 'Finish' : 'Continue'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Rows<T>({ items, empty, onChange, render, addLabel }: { items: T[]; empty: T; onChange: (x: T[]) => void; render: (item: T, update: (p: Partial<T>) => void) => React.ReactNode; addLabel: string }) {
  return (
    <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
      {items.map((it, i) => (
        <div key={i} className="inset" style={{ position: 'relative', paddingRight: 48 }}>
          {render(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}
          <Button size="sm" variant="ghost" iconOnly icon={X} aria-label="Remove" style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button icon={Plus} onClick={() => onChange([...items, { ...empty }])} style={{ alignSelf: 'flex-start' }}>{addLabel}</Button>
    </div>
  );
}
