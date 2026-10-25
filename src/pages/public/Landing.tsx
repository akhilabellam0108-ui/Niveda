import { Link } from 'react-router-dom';
import { Clock3, ShieldCheck, Stethoscope, ScrollText, Syringe, Scissors, Microscope, TriangleAlert, Lock } from 'lucide-react';
import { brand } from '../../config/brand';
import { isLive } from '../../config/backend';
import { useDocumentTitle } from '../../state/hooks';
import { Brand } from '../../components/ui/Logo';

import { getLocale, t } from '../../i18n';
import { T } from '../../i18n/T';
import { LanguagePicker } from '../../components/ui/LanguagePicker';
/** “24 Sep” in the interface language. */
const dayMonth = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(`${getLocale()}-u-nu-latn`, { day: 'numeric', month: 'short' });

const PREVIEW = [
  { y: '2026', d: '2026-09-24', type: t('Consultation'), title: t('Tension-type headache'), by: 'Dr. Priya Sharma · Lakeview Hospital', icon: Stethoscope, tone: 'tone-accent', fresh: true },
  { y: '2026', d: '2026-08-11', type: t('Lab result'), title: t('Complete blood count'), by: 'Sunrise Diagnostics', icon: Microscope, tone: 'tone-ok' },
  { y: '2022', d: '2022-08-18', type: t('Surgery'), title: t('Laparoscopic appendectomy'), by: 'Dr. Rahul Kumar · Northbridge Hospital', icon: Scissors, tone: 'tone-warn' },
  { y: '2021', d: '2021-05-18', type: t('Vaccination'), title: t('COVID-19 · Dose 1'), by: t('Added by you'), icon: Syringe, tone: 'tone-accent' },
  { y: '2018', d: '2018-02-14', type: t('Allergy'), title: t('Penicillin — life-threatening'), by: t('Added by you'), icon: TriangleAlert, tone: 'tone-danger' },
];

export function LandingPage() {
  useDocumentTitle(`${brand.name} — ${brand.tagline}`);
  return (
    <div className="landing">
      {!isLive && <div className="proto-bar"><b>{t('Prototype')}</b> · {t('fictional demo data only — don’t enter real medical information')}</div>}
      <header className="landing-nav">
        <Brand />
        <div className="row"><LanguagePicker compact /><Link to="/login" className="btn btn-ghost">{t('Log in')}</Link><Link to="/signup" className="btn btn-primary">{t('Get started')}</Link></div>
      </header>
      <section className="hero">
        <div>
          <span className="badge badge-accent"><Lock aria-hidden />{t('Private by default')}</span>
          <h1 style={{ marginTop: 18 }}>{t('Your health.')}<br />{t('Your history.')}<br />{t('Your control.')}</h1>
          <p className="lede">{brand.shortDescription}{' '}{t('Every hospital, lab and prescription — in one lifelong timeline that follows you, not the other way round.')}</p>
          <div className="cta">
            <Link to="/signup" className="btn btn-primary btn-lg">{t('Get started')}</Link>
            <Link to="/login" className="btn btn-secondary btn-lg">{t('Log in')}</Link>
          </div>
          <p className="small muted" style={{ marginTop: 16 }}>{t('Are you a doctor?')}{' '}<Link to="/signup/doctor">{t('Apply to join')}</Link>
            {isLive && <> · <a href="demo/">{t('Try the demo with sample data')}</a></>}
          </p>
        </div>
        <div className="hero-visual" aria-hidden>
          <div className="card" style={{ padding: 18 }}>
            <div className="spread" style={{ marginBottom: 10 }}>
              <div><div className="xs subtle strong">MEERA IYER · NV-4821-7730</div><div className="strong">{t('Health timeline')}</div></div>
              <span className="access-chip"><ShieldCheck />{t('1 doctor has access')}</span>
            </div>
            <ol className="tl-list" style={{ marginTop: 6 }}>
              {PREVIEW.map((p) => (
                <li key={p.title} className="tl-item" style={{ gridTemplateColumns: '54px 40px 1fr' }}>
                  <div className="tl-date">{dayMonth(p.d)}<br /><span style={{ fontWeight: 500 }}>{p.y}</span></div>
                  <div className="tl-node"><span className={`type-icon ${p.tone}`}><p.icon /></span></div>
                  <div className={`rec-card ${p.fresh ? 'highlight' : ''}`} style={{ cursor: 'default', padding: '10px 12px' }}>
                    <div className="rec-top"><span className="rec-type">{p.type}</span>{p.fresh && <span className="badge badge-accent">{t('Added by doctor')}</span>}</div>
                    <div className="rec-title" style={{ fontSize: 14 }}>{p.title}</div>
                    <div className="rec-meta">{p.by}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
      <section className="pillars" aria-label={t('How it works')}>
        <div className="pillar"><Clock3 aria-hidden /><h3>{t('One lifelong timeline')}</h3><p>{t('Consultations, tests, scans, surgeries and vaccines from every hospital — in order, in one place.')}</p></div>
        <div className="pillar"><ShieldCheck aria-hidden /><h3>{t('You grant access')}</h3><p>{t('Choose which doctor, what they see and for how long. Revoke with one tap.')}</p></div>
        <div className="pillar"><Stethoscope aria-hidden /><h3>{t('Doctors add to your record')}</h3><p>{t('With your permission, doctors add visits, diagnoses and prescriptions straight into your history.')}</p></div>
        <div className="pillar"><ScrollText aria-hidden /><h3>{t('Nothing hidden')}</h3><p>{t('Every view, addition and correction is attributed and time-stamped in your access log.')}</p></div>
      </section>
      <footer className="landing-foot">© {new Date().getFullYear()} {brand.name}{isLive ? '' : ` · ${t('Prototype')}`} · <Link to="/legal/privacy">{t('Privacy')}</Link> · <Link to="/legal/terms">{t('Terms')}</Link></footer>
    </div>
  );
}

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  useDocumentTitle(`${kind === 'terms' ? t('Terms') : t('Privacy notice')} · ${brand.name}`);
  const g = brand.grievanceOfficer;
  return (
    <div className="landing">
      <header className="landing-nav"><Brand /><Link to="/" className="btn btn-ghost">{t('Back')}</Link></header>
      <main className="content legal" style={{ maxWidth: 760 }}>
        {!brand.legalReviewed && <div className="alert alert-warn"><TriangleAlert aria-hidden /><div><T text="Draft pending legal review. It describes how {app} actually works, but it hasn’t yet been checked by a lawyer." app={brand.name} /></div></div>}
        {kind === 'privacy' ? (
          <div className="stack">
            <h1>{t('Privacy notice')}</h1>
            <p className="small muted">{t('Version {v}. Written for India’s Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025.', { v: brand.privacyNoticeVersion })}</p>
            <p>{t('Your medical record belongs to you. {app} (“we”) keeps it so that you can see it and decide who else can. This notice explains what we collect, why, who sees it, how long we keep it and your rights. You can read it in any of the 22 languages of the Eighth Schedule on request.', { app: brand.dataFiduciary })}</p>

            <h2>{t('What we collect')}</h2>
            <ul>
              <li><T text="{b}: name, date of birth, email, mobile number, password (stored only as a one-way hash)." b={<b>{t('Account details')}</b>} /></li>
              <li><T text="{b}: what you or the doctors you allow add — visits, diagnoses, medicines, allergies, test results, surgeries, vaccinations, documents and notes." b={<b>{t('Your health record')}</b>} /></li>
              <li><T text="{b}: blood group, emergency contact and anything you choose to show on your emergency card." b={<b>{t('Emergency details')}</b>} /></li>
              <li><T text="{b}, only if you link your Ayushman Bharat Health Account: ABHA number, ABHA address and the name on it." b={<b>{t('ABHA details')}</b>} /></li>
              <li><T text="{b}: sign-ins, devices, and every view, addition or correction of your record." b={<b>{t('Activity and security logs')}</b>} /></li>
            </ul>

            <h2>{t('Why we use it — and what you agree to')}</h2>
            <p><T text="We use your data only for the purposes you agree to, and you can withdraw any optional consent at any time in {place}. Withdrawing doesn’t affect what was done before." place={<b>{t('Privacy & security')}</b>} /></p>
            <ul>
              <li><T text="{b} (needed to use {app}): storing it, showing it to you, and sharing the parts you choose with the doctors you approve, for as long as you allow." b={<b>{t('Keeping your health record')}</b>} app={brand.name} /></li>
              <li><T text="{b} (optional): sending reminders to your phone, computer or watch." b={<b>{t('Medicine reminders')}</b>} /></li>
              <li><T text="{b} (optional): linking your ABHA and exchanging records with other ABDM apps when you approve each request." b={<b>{t('Sharing through ABDM')}</b>} /></li>
              <li><T text="{b} (optional): occasional news about new features. Never advertising; we never sell your data." b={<b>{t('Product updates')}</b>} /></li>
            </ul>

            <h2>{t('Who can see your record')}</h2>
            <p>{t('Only you, and doctors you grant access to. Each grant covers only the parts you choose and ends automatically; you can revoke it at any time. Mental-health and other sensitive entries are hidden unless you share them, and are stored encrypted. In an emergency a verified doctor can see only your allergies, medicines, conditions and surgeries, for 4 hours; you are told immediately and our team reviews every such access.')}</p>
            <p>{t('Our staff can’t read your record. We use these service providers, under contracts that require the same protection: Supabase (database and file storage, India region), our SMS provider (MSG91 or Twilio, for one-time codes) and our email provider. If you link ABHA, the National Health Authority’s ABDM systems receive what that linking needs.')}</p>

            <h2>{t('How long we keep it')}</h2>
            <p>{t('As long as you have an account. If you ask us to delete your account, it is erased 7 days later (so you can change your mind) — your record, documents, logs and consents. Backups that still contain it are overwritten within 30 days. Grievances are kept without your name, as the law requires. Activity logs are kept for at least one year while your account exists.')}</p>

            <h2>{t('Your rights')}</h2>
            <ul>
              <li><T text="{b}: everything is visible in the app, and you can download it all from Settings → Data & export." b={<b>{t('See your data')}</b>} /></li>
              <li><T text="{b}: edit what you added; ask the doctor (or us) to correct their entries. Every correction keeps the original." b={<b>{t('Correct it')}</b>} /></li>
              <li><T text="{b}: delete your account from Privacy & security." b={<b>{t('Erase it')}</b>} /></li>
              <li><T text="{b} for any optional purpose, at any time." b={<b>{t('Withdraw consent')}</b>} /></li>
              <li><T text="{b} to exercise these rights if you die or can’t act yourself." b={<b>{t('Nominate someone')}</b>} /></li>
              <li><T text="{b} — we reply within 90 days at most, and aim for 7. If you’re not satisfied, you can complain to the Data Protection Board of India." b={<b>{t('Raise a grievance')}</b>} /></li>
            </ul>

            <h2>{t('Children')}</h2>
            <p>{t('You must be 18 or older to create an account. Parents and guardians can keep a child’s records in their own account; family accounts with verified parental consent are coming.')}</p>

            <h2>{t('Security and breaches')}</h2>
            <p>{t('Data is encrypted in transit and at rest; sensitive entries are encrypted again with a separate key. Access is enforced by the database itself, every sign-in needs a one-time code, and every access is logged. If a breach ever affects your data, we will tell you and the Data Protection Board without delay, with what happened and what you can do.')}</p>

            <h2>{t('Contact')}</h2>
            <p><T text="{name} · {email}. You can also raise a grievance in the app under Privacy & security." name={g.name} email={<a href={`mailto:${g.email}`}>{g.email}</a>} /></p>
            <p className="small muted">{t('If this notice changes we’ll show you the new version and ask before applying it to optional uses.')}</p>
          </div>
        ) : (
          <div className="stack">
            <h1>{t('Terms of use')}</h1>
            <p>{t('{app} helps you keep and share your health information. It does not give medical advice or replace your doctor; always follow their advice, and in an emergency call 112.', { app: brand.name })}</p>
            <h2>{t('Your account')}</h2>
            <p>{t('You must be 18 or older and give true details. Keep your password and one-time codes private — {app} staff will never ask for them. You’re responsible for the doctors you choose to share your record with.', { app: brand.name })}</p>
            <h2>{t('Entries in your record')}</h2>
            <p>{t('Entries you add are marked as added by you. Entries added by clinicians carry their name and organisation, and can only be changed by a recorded correction that keeps the original.')}</p>
            <h2>{t('Doctors')}</h2>
            <p>{t('Doctors must be registered with a State Medical Council or the National Medical Commission and are verified by our team. They may open a record only with the patient’s permission (or the limited, reviewed emergency access) and only for that patient’s care. Misuse ends their access and may be reported to their council.')}</p>
            <h2>{t('Availability')}</h2>
            <p>{t('We work to keep {app} available and your data safe, but we can’t promise it will never be interrupted. Keep copies of documents you can’t replace.', { app: brand.name })}</p>
            <h2>{t('Ending')}</h2>
            <p>{t('You can delete your account at any time. We may suspend accounts that misuse the service, and will tell you why.')}</p>
            <p className="small muted"><T text="Questions: {email}. Privacy: see the {notice}." email={<a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>} notice={<Link to="/legal/privacy">{t('privacy notice')}</Link>} /></p>
          </div>
        )}
      </main>
    </div>
  );
}
