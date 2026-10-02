import { Link } from 'react-router-dom';
import { Clock3, ShieldCheck, Stethoscope, ScrollText, Syringe, Scissors, Microscope, TriangleAlert, Lock } from 'lucide-react';
import { brand } from '../../config/brand';
import { useDocumentTitle } from '../../state/hooks';
import { Brand } from '../../components/ui/Logo';

const PREVIEW = [
  { y: '2026', d: '24 Sep', type: 'Consultation', title: 'Tension-type headache', by: 'Dr. Priya Sharma · Lakeview Hospital', icon: Stethoscope, tone: 'tone-accent', fresh: true },
  { y: '2026', d: '11 Aug', type: 'Lab result', title: 'Complete blood count', by: 'Sunrise Diagnostics', icon: Microscope, tone: 'tone-ok' },
  { y: '2022', d: '18 Aug', type: 'Surgery', title: 'Laparoscopic appendectomy', by: 'Dr. Rahul Kumar · Northbridge Hospital', icon: Scissors, tone: 'tone-warn' },
  { y: '2021', d: '18 May', type: 'Vaccination', title: 'COVID-19 · Dose 1', by: 'Added by you', icon: Syringe, tone: 'tone-accent' },
  { y: '2018', d: '14 Feb', type: 'Allergy', title: 'Penicillin — life-threatening', by: 'Added by you', icon: TriangleAlert, tone: 'tone-danger' },
];

export function LandingPage() {
  useDocumentTitle(`${brand.name} — ${brand.tagline}`);
  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand />
        <div className="row"><Link to="/login" className="btn btn-ghost">Log in</Link><Link to="/signup" className="btn btn-primary">Get started</Link></div>
      </header>
      <section className="hero">
        <div>
          <span className="badge badge-accent"><Lock aria-hidden />Private by default</span>
          <h1 style={{ marginTop: 18 }}>Your health.<br />Your history.<br />Your control.</h1>
          <p className="lede">{brand.shortDescription} Every hospital, lab and prescription — in one lifelong timeline that follows you, not the other way round.</p>
          <div className="cta">
            <Link to="/signup" className="btn btn-primary btn-lg">Get started</Link>
            <Link to="/login" className="btn btn-secondary btn-lg">Log in</Link>
          </div>
        </div>
        <div className="hero-visual" aria-hidden>
          <div className="card" style={{ padding: 18 }}>
            <div className="spread" style={{ marginBottom: 10 }}>
              <div><div className="xs subtle strong">MEERA IYER · NV-4821-7730</div><div className="strong">Health timeline</div></div>
              <span className="access-chip"><ShieldCheck />1 doctor has access</span>
            </div>
            <ol className="tl-list" style={{ marginTop: 6 }}>
              {PREVIEW.map((p) => (
                <li key={p.title} className="tl-item" style={{ gridTemplateColumns: '54px 40px 1fr' }}>
                  <div className="tl-date">{p.d}<br /><span style={{ fontWeight: 500 }}>{p.y}</span></div>
                  <div className="tl-node"><span className={`type-icon ${p.tone}`}><p.icon /></span></div>
                  <div className={`rec-card ${p.fresh ? 'highlight' : ''}`} style={{ cursor: 'default', padding: '10px 12px' }}>
                    <div className="rec-top"><span className="rec-type">{p.type}</span>{p.fresh && <span className="badge badge-accent">Added by doctor</span>}</div>
                    <div className="rec-title" style={{ fontSize: 14 }}>{p.title}</div>
                    <div className="rec-meta">{p.by}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
      <section className="pillars" aria-label="How it works">
        <div className="pillar"><Clock3 aria-hidden /><h3>One lifelong timeline</h3><p>Consultations, tests, scans, surgeries and vaccines from every hospital — in order, in one place.</p></div>
        <div className="pillar"><ShieldCheck aria-hidden /><h3>You grant access</h3><p>Choose which doctor, what they see and for how long. Revoke with one tap.</p></div>
        <div className="pillar"><Stethoscope aria-hidden /><h3>Doctors add to your record</h3><p>With your permission, doctors add visits, diagnoses and prescriptions straight into your history.</p></div>
        <div className="pillar"><ScrollText aria-hidden /><h3>Nothing hidden</h3><p>Every view, addition and correction is attributed and time-stamped in your access log.</p></div>
      </section>
      <footer className="landing-foot">© {new Date().getFullYear()} {brand.name} · <Link to="/legal/privacy">Privacy</Link> · <Link to="/legal/terms">Terms</Link></footer>
    </div>
  );
}

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  useDocumentTitle(`${kind === 'terms' ? 'Terms' : 'Privacy'} · ${brand.name}`);
  return (
    <div className="landing">
      <header className="landing-nav"><Brand /><Link to="/" className="btn btn-ghost">Back</Link></header>
      <main className="content" style={{ maxWidth: 720 }}>
        <div className="alert alert-warn"><TriangleAlert aria-hidden /><div>Draft for review. Have a qualified lawyer finalise this text before launch.</div></div>
        {kind === 'privacy' ? (
          <div className="stack">
            <h1>Privacy notice (draft)</h1>
            <p>Your medical record belongs to you. {brand.name} stores it so that you can see it and decide who else can.</p>
            <h3>Who can see your record</h3><p>Only you, and doctors you grant access to. Each grant is limited to the parts of your record you choose and ends automatically. You can revoke it at any time.</p>
            <h3>What we log</h3><p>Every time a doctor opens your record, views a document or adds or corrects an entry, we record who, what and when. You can see this in your access log.</p>
            <h3>Emergencies</h3><p>If you turn on your emergency card, the details you choose (blood group, allergies, key conditions and an emergency contact) can be shown without signing in.</p>
            <h3>Your rights</h3><p>You can export your full record and ask for your account to be closed.</p>
          </div>
        ) : (
          <div className="stack">
            <h1>Terms of use (draft)</h1>
            <p>{brand.name} helps you keep and share your health information. It does not give medical advice. Always follow the advice of your doctor.</p>
            <p>Entries you add yourself are marked as added by you. Entries added by clinicians carry their name and organisation and can only be corrected through a recorded amendment.</p>
          </div>
        )}
      </main>
    </div>
  );
}
