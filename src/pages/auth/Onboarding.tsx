import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Camera, ArrowLeft, LogOut, ShieldCheck, Info } from 'lucide-react';
import { brand } from '../../config/brand';
import { patientService, validateOnboarding, friendlyError, type OnboardingInput } from '../../services';
import { useSession } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { useDocumentTitle } from '../../state/hooks';
import { perTab } from '../../mock/storage';
import { defaultTimes } from '../../lib/reminders';
import { todayISO } from '../../lib/dates';
import { Avatar, Button, Field, InlineError, Input, Select, Textarea } from '../../components/ui';
import { Brand } from '../../components/ui/Logo';
import { TimesEditor } from '../../components/medications/TimesEditor';

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const SEVERITIES = ['Mild', 'Moderate', 'Severe', 'Life-threatening'];
const FREQS = ['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Every night', 'Weekly', 'As needed'];

const STEPS = [
  { title: 'About you', intro: 'Your blood group is shown on your emergency card and to doctors you grant access to.' },
  { title: 'Emergency contact', intro: 'Who should be contacted if something happens to you? This is required.' },
  { title: 'Allergies', intro: 'Allergies are shown at the top of your record for every doctor. Add each one, or confirm you have none.' },
  { title: 'Ongoing conditions', intro: 'Long-term or current conditions, such as asthma, diabetes or high blood pressure.' },
  { title: 'Current medicines', intro: 'Everything you take now. We’ll remind you when each dose is due — on this device and, if you add them to your calendar, on your phone and smartwatch.' },
  { title: 'Surgeries & hospital stays', intro: 'Operations and times you were admitted to hospital, so your history is complete from day one.' },
];

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

const empty = (): OnboardingInput => ({
  bloodGroup: '', emergencyContact: { name: '', relationship: '', phone: '' },
  allergies: [], noAllergies: false, conditions: [], noConditions: false,
  medications: [], noMedications: false, history: [], noHistory: false, importantNotes: '',
});

/** Checks just the fields on one step, so people see problems before moving on. */
function stepProblem(step: number, d: OnboardingInput): string | undefined {
  const all = validateOnboarding(d);
  if (!all) return undefined;
  const belongs = [
    /blood group/i, /emergency contact/i, /allerg/i, /condition/i, /medicine|reminder time/i, /surger|hospital/i,
  ];
  // Report the first problem only if it belongs to this step or an earlier one.
  const at = belongs.findIndex((re) => re.test(all));
  return at !== -1 && at <= step ? all : undefined;
}

export function OnboardingPage() {
  useDocumentTitle(`Set up · ${brand.name}`);
  const { patient, user, refresh, signOut } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const draftKey = `niveda.onboarding.${user?.id}`;
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardingInput>(() => {
    try { return { ...empty(), ...JSON.parse(perTab.get(draftKey) ?? '{}') }; } catch { return empty(); }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const set = (p: Partial<OnboardingInput>) => { setErr(undefined); setData((d) => ({ ...d, ...p })); };

  // Keep a draft in this tab so a refresh doesn't lose answers (photo excluded to stay small).
  useEffect(() => { const { photoDataUrl: _p, ...rest } = data; perTab.set(draftKey, JSON.stringify(rest)); }, [data, draftKey]);

  const next = async () => {
    const problem = stepProblem(step, data);
    if (problem) { setErr(problem); return; }
    setErr(undefined);
    if (step < STEPS.length - 1) { setStep(step + 1); window.scrollTo(0, 0); return; }
    setBusy(true);
    try {
      await patientService.completeOnboarding(data);
      perTab.remove(draftKey);
      await refresh();
      toast('Your record is set up');
      navigate('/app', { replace: true });
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const first = patient?.fullName.split(' ')[0] ?? '';
  const s = STEPS[step];

  return (
    <div className="onboard">
      <div className="onboard-card stack" style={{ '--gap': '24px' } as React.CSSProperties}>
        <div className="spread">
          <Brand />
          <Button variant="ghost" icon={LogOut} onClick={async () => { await signOut(); navigate('/login'); }} disabled={busy}>Log out</Button>
        </div>
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          <div className="spread xs subtle strong"><span>STEP {step + 1} OF {STEPS.length} · {s.title.toUpperCase()}</span><span>All steps required</span></div>
          <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Setup progress"><div style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
        </div>
        <div>
          <h1 className="display" style={{ fontSize: 32 }}>{step === 0 ? `Welcome, ${first}.` : s.title}</h1>
          <p className="muted" style={{ marginTop: 8 }}>{s.intro}</p>
        </div>

        <div className="card card-pad stack">
          {step === 0 && (
            <>
              <div className="row" style={{ '--gap': '16px', flexWrap: 'wrap' } as React.CSSProperties}>
                <Avatar name={patient?.fullName ?? '?'} src={data.photoDataUrl} size="xl" />
                <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <label className="btn btn-secondary">
                    <Camera aria-hidden />{data.photoDataUrl ? 'Change photo' : 'Add a photo'}
                    <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { set({ photoDataUrl: await readImage(f) }); } catch { setErr('That image couldn’t be read.'); } } }} />
                  </label>
                  <span className="xs subtle">Optional — helps staff confirm it’s you in an emergency.</span>
                </div>
              </div>
              <Field label="Blood group" required help="If you don’t know it, choose “Not sure” — a doctor can add it after a blood test.">
                {(p) => <Select {...p} value={data.bloodGroup} onChange={(e) => set({ bloodGroup: e.target.value })} placeholder="Select…" options={[...BLOOD_GROUPS, { value: 'Unknown', label: 'Not sure' }]} />}
              </Field>
            </>
          )}

          {step === 1 && (
            <div className="form-grid">
              <Field label="Name" required className="wide">{(p) => <Input {...p} autoComplete="off" value={data.emergencyContact.name} onChange={(e) => set({ emergencyContact: { ...data.emergencyContact, name: e.target.value } })} />}</Field>
              <Field label="Relationship" required>{(p) => <Input {...p} placeholder="e.g. Sister" value={data.emergencyContact.relationship} onChange={(e) => set({ emergencyContact: { ...data.emergencyContact, relationship: e.target.value } })} />}</Field>
              <Field label="Phone" required>{(p) => <Input {...p} type="tel" placeholder="+91" value={data.emergencyContact.phone} onChange={(e) => set({ emergencyContact: { ...data.emergencyContact, phone: e.target.value } })} />}</Field>
            </div>
          )}

          {step === 2 && (
            <Section none={data.noAllergies} onNone={(v) => set({ noAllergies: v })} noneLabel="I have no known allergies" count={data.allergies.length}>
              <Rows items={data.allergies} empty={{ allergen: '', severity: '', reaction: '' }} addLabel="Add an allergy" onChange={(allergies) => set({ allergies, noAllergies: false })}
                render={(a, upd) => (
                  <div className="form-grid">
                    <Field label="Allergen" required>{(p) => <Input {...p} value={a.allergen} placeholder="e.g. Penicillin, peanuts" onChange={(e) => upd({ allergen: e.target.value })} />}</Field>
                    <Field label="Severity" required>{(p) => <Select {...p} value={a.severity} options={SEVERITIES} placeholder="Select…" onChange={(e) => upd({ severity: e.target.value })} />}</Field>
                    <Field label="Reaction" required className="wide">{(p) => <Input {...p} value={a.reaction} placeholder="e.g. Rash, swelling, breathing difficulty" onChange={(e) => upd({ reaction: e.target.value })} />}</Field>
                  </div>
                )} />
            </Section>
          )}

          {step === 3 && (
            <Section none={data.noConditions} onNone={(v) => set({ noConditions: v })} noneLabel="I have no ongoing conditions" count={data.conditions.length}>
              <Rows items={data.conditions} empty={{ condition: '', since: '' }} addLabel="Add a condition" onChange={(conditions) => set({ conditions, noConditions: false })}
                render={(c, upd) => (
                  <div className="form-grid">
                    <Field label="Condition" required>{(p) => <Input {...p} value={c.condition} placeholder="e.g. Asthma" onChange={(e) => upd({ condition: e.target.value })} />}</Field>
                    <Field label="Diagnosed around">{(p) => <Input {...p} type="date" max={todayISO()} value={c.since ?? ''} onChange={(e) => upd({ since: e.target.value })} />}</Field>
                  </div>
                )} />
            </Section>
          )}

          {step === 4 && (
            <Section none={data.noMedications} onNone={(v) => set({ noMedications: v })} noneLabel="I’m not taking any medicines" count={data.medications.length}>
              <Rows items={data.medications} empty={{ name: '', dosage: '', frequency: '', times: [] }} addLabel="Add a medicine" onChange={(medications) => set({ medications, noMedications: false })}
                render={(m, upd) => (
                  <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
                    <div className="form-grid">
                      <Field label="Medicine" required>{(p) => <Input {...p} value={m.name} onChange={(e) => upd({ name: e.target.value })} />}</Field>
                      <Field label="Dose" required>{(p) => <Input {...p} value={m.dosage} placeholder="e.g. 10 mg" onChange={(e) => upd({ dosage: e.target.value })} />}</Field>
                      <Field label="How often" required className="wide">{(p) => <Select {...p} value={m.frequency} options={FREQS} placeholder="Select…" onChange={(e) => upd({ frequency: e.target.value, times: defaultTimes(e.target.value) })} />}</Field>
                    </div>
                    {m.frequency && m.frequency !== 'As needed' && <TimesEditor times={m.times} onChange={(times) => upd({ times })} />}
                    {m.frequency === 'As needed' && <p className="xs subtle">As-needed medicines don’t get scheduled reminders.</p>}
                  </div>
                )} />
            </Section>
          )}

          {step === 5 && (
            <>
              <Section none={data.noHistory} onNone={(v) => set({ noHistory: v })} noneLabel="I’ve never had surgery or been admitted to hospital" count={data.history.length}>
                <Rows items={data.history} empty={{ kind: 'surgery' as 'surgery' | 'hospitalization', name: '', date: '', hospital: '' }} addLabel="Add a surgery or hospital stay" onChange={(history) => set({ history, noHistory: false })}
                  render={(h, upd) => (
                    <div className="form-grid">
                      <Field label="Type" required>{(p) => <Select {...p} value={h.kind} onChange={(e) => upd({ kind: e.target.value as 'surgery' | 'hospitalization' })} options={[{ value: 'surgery', label: 'Surgery / procedure' }, { value: 'hospitalization', label: 'Hospital stay' }]} />}</Field>
                      <Field label="Date" required>{(p) => <Input {...p} type="date" max={todayISO()} value={h.date} onChange={(e) => upd({ date: e.target.value })} />}</Field>
                      <Field label={h.kind === 'surgery' ? 'Procedure' : 'Reason for admission'} required>{(p) => <Input {...p} value={h.name} placeholder={h.kind === 'surgery' ? 'e.g. Appendix removal' : 'e.g. Dengue fever'} onChange={(e) => upd({ name: e.target.value })} />}</Field>
                      <Field label="Hospital" required>{(p) => <Input {...p} value={h.hospital} onChange={(e) => upd({ hospital: e.target.value })} />}</Field>
                    </div>
                  )} />
              </Section>
              <Field label="Anything else doctors should know?" help="Optional. Shown on your emergency card, e.g. pacemaker, pregnancy, carries an inhaler.">
                {(p) => <Textarea {...p} rows={3} value={data.importantNotes ?? ''} onChange={(e) => set({ importantNotes: e.target.value })} />}
              </Field>
              <div className="alert alert-accent"><ShieldCheck aria-hidden /><div>You can add reports and older records later from your dashboard. Only doctors you grant access to will see any of this.</div></div>
            </>
          )}
        </div>
        <InlineError message={err} />
        <div className="spread">
          {step > 0 ? <Button variant="ghost" icon={ArrowLeft} onClick={() => { setErr(undefined); setStep(step - 1); }} disabled={busy}>Back</Button> : <span />}
          <Button variant="primary" onClick={next} loading={busy}>{step === STEPS.length - 1 ? 'Finish setup' : 'Continue'}</Button>
        </div>
      </div>
    </div>
  );
}

function Section({ none, onNone, noneLabel, count, children }: { none: boolean; onNone: (v: boolean) => void; noneLabel: string; count: number; children: React.ReactNode }) {
  return (
    <div className="stack">
      {!none && children}
      {count === 0 && (
        <>
          {!none && <div className="row xs subtle" style={{ '--gap': '6px' } as React.CSSProperties}><Info size={13} aria-hidden />Add at least one, or confirm below.</div>}
          <label className={`none-check ${none ? 'on' : ''}`}>
            <input type="checkbox" checked={none} onChange={(e) => onNone(e.target.checked)} />
            {noneLabel}
          </label>
        </>
      )}
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
