import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, Clock3, LogOut, PencilLine, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { DoctorApplication, DoctorApplicationInput } from '../../types';
import { brand } from '../../config/brand';
import {
  applicationService, authService, friendlyError, isLive, validateApplication, MEDICAL_COUNCILS, DEMO_ONLY_MESSAGE,
} from '../../services';
import { useSession } from '../../state/SessionContext';
import { useDocumentTitle, useLive } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { Badge, Button, ErrorState, Field, InlineError, Input, Select, SkeletonList } from '../../components/ui';
import { AuthLayout, PasswordInput } from './AuthPages';
import { fmtDateTime } from '../../lib/dates';

import { t } from '../../i18n';
import { T } from '../../i18n/T';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const EMPTY_APPLICATION: DoctorApplicationInput = {
  fullName: '', phone: '', registrationNumber: '', medicalCouncil: '', registrationYear: '', specialization: '',
  qualifications: '', yearsOfPractice: '', hospitalName: '', hospitalCity: '', hospitalType: 'hospital',
};

const HOSPITAL_TYPES = [
  { value: 'hospital', label: t('Hospital') }, { value: 'clinic', label: t('Clinic') },
  { value: 'laboratory', label: t('Laboratory') }, { value: 'imaging', label: t('Imaging centre') },
];

const toInput = (a: DoctorApplication): DoctorApplicationInput => ({
  fullName: a.fullName, phone: a.phone, registrationNumber: a.registrationNumber, medicalCouncil: a.medicalCouncil,
  registrationYear: a.registrationYear ? String(a.registrationYear) : '', specialization: a.specialization, qualifications: a.qualifications,
  yearsOfPractice: String(a.yearsOfPractice), hospitalName: a.hospitalName, hospitalCity: a.hospitalCity, hospitalType: a.hospitalType,
});

/** The professional details a doctor gives. Used for applying and for corrections. */
function ApplicationFields({ value, onChange, errors }: { value: DoctorApplicationInput; onChange: (v: DoctorApplicationInput) => void; errors: Record<string, string> }) {
  const set = (k: keyof DoctorApplicationInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <Field label={t('Full name')} required error={errors.fullName} help={t('As it appears on your medical registration')}>{(p) => <Input {...p} autoComplete="name" value={value.fullName} onChange={set('fullName')} placeholder={t('Dr. ')} />}</Field>
      <Field label={t('Mobile number')} required error={errors.phone}>{(p) => <Input {...p} type="tel" autoComplete="tel" value={value.phone} onChange={set('phone')} placeholder="+91" />}</Field>
      <fieldset className="stack fieldset">
        <legend>{t('Medical registration')}</legend>
        <Field label={t('Medical council')} required error={errors.medicalCouncil}>{(p) => <Select {...p} value={value.medicalCouncil} onChange={set('medicalCouncil')} placeholder={t('Choose your council')} options={[...MEDICAL_COUNCILS]} />}</Field>
        <div className="form-grid">
          <Field label={t('Registration number')} required error={errors.registrationNumber}>{(p) => <Input {...p} value={value.registrationNumber} onChange={set('registrationNumber')} autoCapitalize="characters" />}</Field>
          <Field label={t('Year of registration')} error={errors.registrationYear}>{(p) => <Input {...p} inputMode="numeric" value={value.registrationYear} onChange={set('registrationYear')} placeholder="e.g. 2012" />}</Field>
        </div>
      </fieldset>
      <fieldset className="stack fieldset">
        <legend>{t('Practice')}</legend>
        <div className="form-grid">
          <Field label={t('Specialisation')} required error={errors.specialization}>{(p) => <Input {...p} value={value.specialization} onChange={set('specialization')} placeholder={t('e.g. General medicine')} />}</Field>
          <Field label={t('Qualifications')} required error={errors.qualifications}>{(p) => <Input {...p} value={value.qualifications} onChange={set('qualifications')} placeholder={t('e.g. MBBS, MD')} />}</Field>
          <Field label={t('Years of practice')} error={errors.yearsOfPractice}>{(p) => <Input {...p} inputMode="numeric" value={value.yearsOfPractice} onChange={set('yearsOfPractice')} />}</Field>
          <Field label={t('Type')} required>{(p) => <Select {...p} value={value.hospitalType} onChange={set('hospitalType')} options={HOSPITAL_TYPES} />}</Field>
          <Field label={t('Hospital or clinic')} required error={errors.hospitalName}>{(p) => <Input {...p} value={value.hospitalName} onChange={set('hospitalName')} />}</Field>
          <Field label={t('City')} required error={errors.hospitalCity}>{(p) => <Input {...p} value={value.hospitalCity} onChange={set('hospitalCity')} />}</Field>
        </div>
      </fieldset>
    </>
  );
}

/* ---------------- Apply ---------------- */

export function DoctorSignupPage() {
  useDocumentTitle(`${t('Join as a doctor')} · ${brand.name}`);
  const navigate = useNavigate();
  const [f, setF] = useState(EMPTY_APPLICATION);
  const [acct, setAcct] = useState({ email: '', password: '', confirm: '' });
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const setA = (k: keyof typeof acct) => (e: React.ChangeEvent<HTMLInputElement>) => setAcct({ ...acct, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateApplication(f);
    if (!EMAIL_RE.test(acct.email.trim())) v.email = t('Enter a valid email address');
    if (acct.password.length < 8 || !/[A-Za-z]/.test(acct.password) || !/\d/.test(acct.password)) v.password = t('Use at least 8 characters with letters and numbers');
    if (acct.confirm !== acct.password) v.confirm = t('Passwords don’t match');
    if (!agree) v.agree = t('Please confirm to continue');
    setErrors(v);
    if (Object.keys(v).length) {
      setErr(t('Please check the highlighted fields.'));
      return;
    }
    setBusy(true);
    setErr(undefined);
    try {
      const challenge = await authService.startDoctorApplication({ ...f, email: acct.email, password: acct.password });
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
        <h1>{t('Join Niveda as a doctor')}</h1>
        <p className="lede">{t('Patients share their records only with verified doctors. Apply with your medical registration; the Niveda team checks it against the medical register, usually within 1–2 working days.')}</p>
      </div>
      {!isLive ? (
        <div className="stack">
          <div className="alert alert-info" role="status"><ShieldCheck aria-hidden /><div>{DEMO_ONLY_MESSAGE}</div></div>
          <Link to="/login?as=doctor" className="btn btn-primary btn-lg btn-block">{t('Try the demo doctor')}</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <div className="form-grid">
            <Field label={t('Work email')} required error={errors.email} className="wide">{(p) => <Input {...p} type="email" autoComplete="email" value={acct.email} onChange={setA('email')} />}</Field>
            <Field label={t('Password')} required error={errors.password} help={t('8+ characters, letters and numbers')}>{(p) => <PasswordInput {...p} autoComplete="new-password" value={acct.password} onChange={setA('password')} />}</Field>
            <Field label={t('Confirm password')} required error={errors.confirm}>{(p) => <PasswordInput {...p} autoComplete="new-password" value={acct.confirm} onChange={setA('confirm')} />}</Field>
          </div>
          <ApplicationFields value={f} onChange={setF} errors={errors} />
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} aria-invalid={!!errors.agree} />
            <span><T text="I confirm these details are true, and I agree to the {terms}. I understand I can open a patient’s record only when they grant access, and every view is logged for them." terms={<Link to="/legal/terms" target="_blank">{t('Terms')}</Link>} /></span>
          </label>
          {errors.agree && <span className="field-error">{errors.agree}</span>}
          <InlineError message={err} />
          <Button type="submit" variant="primary" size="lg" block loading={busy}>{t('Apply')}</Button>
        </form>
      )}
      <p className="small muted" style={{ textAlign: 'center' }}>{t('Already applied or verified?')}{' '}<Link to="/login?as=doctor">{t('Log in')}</Link></p>
    </AuthLayout>
  );
}

/* ---------------- Waiting for review ---------------- */

export function ApplicationStatusPage() {
  useDocumentTitle(`${t('Your application')} · ${brand.name}`);
  const navigate = useNavigate();
  const toast = useToast();
  const { signOut, refresh, user } = useSession();
  const app = useLive(() => applicationService.mine(), []);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(EMPTY_APPLICATION);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  // Approved while this page was open: the account is now a doctor's.
  useEffect(() => {
    if (app.data?.status === 'approved') void refresh();
  }, [app.data?.status, refresh]);
  useEffect(() => {
    if (user?.role === 'doctor') navigate('/doctor', { replace: true });
  }, [user?.role, navigate]);

  const startEdit = () => {
    if (!app.data) return;
    setF(toInput(app.data));
    setErrors({});
    setErr(undefined);
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateApplication(f);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setErr(undefined);
    try {
      await applicationService.update(f);
      setEditing(false);
      toast(t('Sent for review again'));
      app.reload();
    } catch (x) {
      setErr(friendlyError(x));
    } finally {
      setBusy(false);
    }
  };

  const a = app.data;
  return (
    <AuthLayout back={false}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('Your application')}</h1>
        <Button variant="ghost" size="sm" icon={LogOut} onClick={async () => { await signOut(); navigate('/login'); }}>{t('Log out')}</Button>
      </div>
      {app.loading && !a ? <SkeletonList rows={3} card={false} /> : app.error ? <ErrorState error={app.error} onRetry={app.reload} /> : !a ? (
        <p className="muted">{t('We couldn’t find an application for this account.')}</p>
      ) : editing ? (
        <form className="stack" onSubmit={save} noValidate>
          <ApplicationFields value={f} onChange={setF} errors={errors} />
          <InlineError message={err} />
          <div className="row">
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>{t('Cancel')}</Button>
            <Button type="submit" variant="primary" loading={busy} style={{ marginLeft: 'auto' }}>{t('Send for review')}</Button>
          </div>
        </form>
      ) : (
        <div className="stack">
          {a.status === 'pending' && (
            <div className="alert alert-info" role="status"><Clock3 aria-hidden /><div><strong>{t('Waiting for verification.')}</strong>{' '}{t('The Niveda team is checking your registration with the {council}. We’ll notify you here and by email. Submitted {date}.', { council: a.medicalCouncil, date: fmtDateTime(a.submittedAt) })}</div></div>
          )}
          {a.status === 'declined' && (
            <div className="alert alert-danger" role="alert"><TriangleAlert aria-hidden /><div><strong>{t('Your application needs changes.')}</strong> {a.reviewNote}</div></div>
          )}
          {a.status === 'approved' && (
            <div className="alert alert-ok" role="status"><BadgeCheck aria-hidden /><div><strong>{t('You’re verified.')}</strong>{' '}{t('Opening your workspace…')}</div></div>
          )}
          {a.status === 'pending' && a.reviewNote && <p className="small muted">{t('Previous note from the team:')}{' '}{a.reviewNote}</p>}
          <dl className="kv">
            <dt>{t('Name')}</dt><dd>{a.fullName}</dd>
            <dt>{t('Registration')}</dt><dd>{a.registrationNumber} · {a.medicalCouncil}{a.registrationYear ? ` · ${a.registrationYear}` : ''}</dd>
            <dt>{t('Practice')}</dt><dd>{a.specialization} · {a.qualifications} · {t('{n} years', { n: a.yearsOfPractice })}</dd>
            <dt>{t('Works at')}</dt><dd>{a.hospitalName}, {a.hospitalCity}</dd>
            <dt>{t('Status')}</dt><dd><Badge tone={a.status === 'declined' ? 'danger' : a.status === 'approved' ? 'ok' : 'warn'} dot>{a.status === 'pending' ? t('Under review') : a.status === 'declined' ? t('Needs changes') : t('Verified')}</Badge></dd>
          </dl>
          {a.status !== 'approved' && <Button icon={PencilLine} onClick={startEdit}>{a.status === 'declined' ? t('Correct and resubmit') : t('Edit details')}</Button>}
        </div>
      )}
    </AuthLayout>
  );
}
