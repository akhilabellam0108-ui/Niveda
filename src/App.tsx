import { Component, type ReactNode } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Compass, RotateCcw } from 'lucide-react';
import { SessionProvider, useSession } from './state/SessionContext';
import { ToastProvider } from './state/ToastContext';
import { Button, EmptyState } from './components/ui';
import { LogoMark } from './components/ui/Logo';
import { PatientShell } from './components/layout/PatientShell';
import { DoctorShell } from './components/layout/DoctorShell';
import { LandingPage, LegalPage } from './pages/public/Landing';
import { ForgotPasswordPage, LoginPage, SignupPage, VerifyPage } from './pages/auth/AuthPages';
import { OnboardingPage } from './pages/auth/Onboarding';
import { ApplicationStatusPage, DoctorSignupPage } from './pages/auth/DoctorSignup';
import { AdminPage } from './pages/admin/AdminPage';
import { homeFor } from './lib/home';
import { PatientHome } from './pages/patient/Home';
import { RecordsPage, TimelinePage } from './pages/patient/Records';
import { AllergiesPage, MedicationsPage } from './pages/patient/Medications';
import { ReportsPage } from './pages/patient/Reports';
import { EmergencyPage } from './pages/patient/Emergency';
import { AccessPage } from './pages/patient/Access';
import { ActivityPage } from './pages/patient/Activity';
import { NotificationsPage } from './pages/shared/Notifications';
import { PrivacyPage, SecuritySection } from './pages/shared/Security';
import { ProfilePage, SettingsPage } from './pages/shared/Settings';
import { DoctorActivity, DoctorHome, DoctorPatients, DoctorProfile, FindPatient } from './pages/doctor/DoctorPages';
import { PatientView } from './pages/doctor/PatientView';
import { AddEntryPage } from './pages/doctor/AddEntry';

function Splash() {
  return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }} aria-busy="true" aria-label="Loading"><LogoMark size={44} /></div>;
}

/** Route guard. Role checks here are for UX only — services enforce access. */
function RequireRole({ role }: { role: 'patient' | 'doctor' | 'applicant' }) {
  const { status, user } = useSession();
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'signed-out' || !user) return <Navigate to={role === 'patient' ? '/login?as=patient' : '/login?as=doctor'} replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  if (role === 'patient' && !user.onboarded && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

function PublicOnly() {
  const { status, user } = useSession();
  if (status === 'loading') return <Splash />;
  if (status === 'signed-in' && user) return <Navigate to={homeFor(user)} replace />;
  return <Outlet />;
}

/** The Niveda team's pages. The database checks this again for every action. */
function RequireAdmin() {
  const { status, user } = useSession();
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'signed-out' || !user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!user.isAdmin) return <Navigate to={homeFor(user)} replace />;
  return <Outlet />;
}

function NotFound() {
  return <div className="card"><EmptyState icon={Compass} title="Page not found" body="That page doesn’t exist or has moved." action={<a className="btn btn-primary" href="#/">Go home</a>} /></div>;
}

function DoctorSettings() {
  return <SettingsPage base="/doctor/settings" role="doctor" />;
}
function DoctorSecurity() {
  return <><div className="page-head"><div><h1>Security</h1><p>Devices, sign-ins and your password.</p></div></div><SecuritySection /></>;
}
function SettingsRoute({ role }: { role: 'patient' | 'doctor' }) {
  const { section } = useParams();
  if (!section) return <Navigate to="account" replace />;
  return role === 'doctor' ? <DoctorSettings /> : <SettingsPage />;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error(e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="card" style={{ maxWidth: 440 }}>
          <EmptyState icon={RotateCcw} title="Something went wrong" body="The page hit an unexpected problem. Your record is safe — reload to continue."
            action={<Button variant="primary" onClick={() => location.reload()}>Reload</Button>} />
        </div>
      </div>
    );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <SessionProvider>
          <ToastProvider>
            <Routes>
              <Route path="/legal/terms" element={<LegalPage kind="terms" />} />
              <Route path="/legal/privacy" element={<LegalPage kind="privacy" />} />
              <Route element={<PublicOnly />}>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/signup/doctor" element={<DoctorSignupPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              </Route>
              <Route path="/verify" element={<VerifyPage />} />
              <Route element={<RequireRole role="applicant" />}>
                <Route path="/doctor-application" element={<ApplicationStatusPage />} />
              </Route>
              <Route element={<RequireAdmin />}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
              <Route element={<RequireRole role="patient" />}>
                <Route path="/onboarding" element={<OnboardingPage />} />
                <Route path="/app" element={<PatientShell />}>
                  <Route index element={<PatientHome />} />
                  <Route path="timeline" element={<TimelinePage />} />
                  <Route path="records" element={<RecordsPage />} />
                  <Route path="medications" element={<MedicationsPage />} />
                  <Route path="allergies" element={<AllergiesPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="emergency" element={<EmergencyPage />} />
                  <Route path="access" element={<AccessPage />} />
                  <Route path="activity" element={<ActivityPage />} />
                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route path="privacy" element={<PrivacyPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="settings" element={<SettingsRoute role="patient" />} />
                  <Route path="settings/:section" element={<SettingsRoute role="patient" />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Route>
              <Route element={<RequireRole role="doctor" />}>
                <Route path="/doctor" element={<DoctorShell />}>
                  <Route index element={<DoctorHome />} />
                  <Route path="patients" element={<DoctorPatients />} />
                  <Route path="patients/:patientId" element={<PatientView />} />
                  <Route path="patients/:patientId/add" element={<AddEntryPage />} />
                  <Route path="find" element={<FindPatient />} />
                  <Route path="activity" element={<DoctorActivity />} />
                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route path="profile" element={<DoctorProfile />} />
                  <Route path="security" element={<DoctorSecurity />} />
                  <Route path="settings" element={<SettingsRoute role="doctor" />} />
                  <Route path="settings/:section" element={<SettingsRoute role="doctor" />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ToastProvider>
        </SessionProvider>
      </HashRouter>
    </ErrorBoundary>
  );
}
