import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { House, Users, UserSearch, ScrollText, Bell, UserRound, LockKeyhole, Settings, LogOut, Search, Stethoscope, Ellipsis, ShieldPlus } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { brand } from '../../config/brand';
import { notificationService } from '../../services';
import { useSession } from '../../state/SessionContext';
import { useLive } from '../../state/hooks';
import { Badge, Modal } from '../ui';
import { Brand } from '../ui/Logo';
import { BackButton } from '../ui/BackButton';
import { ProtoBar, SideNav, UserMenu, isHome, type NavItem } from './PatientShell';

import { t } from '../../i18n';
export function DoctorShell() {
  const { doctor, signOut, user } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const unread = useLive(() => notificationService.unreadCount(), []);
  const [more, setMore] = useState(false);
  if (!doctor) return null;
  const main: NavItem[] = [
    { to: '/doctor', label: t('Dashboard'), icon: House, end: true },
    { to: '/doctor/patients', label: t('My patients'), icon: Users, end: true },
    { to: '/doctor/find', label: t('Find a patient'), icon: UserSearch },
    { to: '/doctor/activity', label: t('My activity'), icon: ScrollText },
  ];
  const account: NavItem[] = [
    { to: '/doctor/notifications', label: t('Notifications'), icon: Bell, badge: unread.data },
    { to: '/doctor/profile', label: t('Profile'), icon: UserRound },
    { to: '/doctor/security', label: t('Security'), icon: LockKeyhole },
    { to: '/doctor/settings', label: t('Settings'), icon: Settings },
  ];
  const logout = async () => { await signOut(); navigate('/login?as=doctor'); };
  return (
    <>
      <ProtoBar />
      <div className="shell">
        <SideNav sections={[{ items: main }, { title: t('Account'), items: account }]} footer={
          <div className="privacy-pill"><Stethoscope aria-hidden /><span>{t('Clinician workspace. You can only open records patients have shared with you — every view is logged for the patient.')}</span></div>
        } />
        <div className="main">
          <header className="topbar">
            {!isHome(location.pathname, '/doctor') && <BackButton fallback="/doctor" />}
            <span className="mobile-only"><Brand to="/doctor" size={28} /></span>
            <button className="search-trigger desktop-only" onClick={() => navigate('/doctor/find')}><Search aria-hidden />{t('Find a patient by ID or QR')}</button>
            <div className="topbar-actions">
              <button className="icon-btn mobile-only" aria-label={t('Find a patient')} onClick={() => navigate('/doctor/find')}><Search /></button>
              <button className="icon-btn" aria-label={t('Notifications')} onClick={() => navigate('/doctor/notifications')}><Bell />{!!unread.data && <span className="dot">{unread.data}</span>}</button>
              <UserMenu name={doctor.fullName} sub={`${doctor.specialization} · ${doctor.hospital?.name}`} doctor items={[
                { label: t('Profile'), icon: UserRound, to: '/doctor/profile' },
                { label: t('Security'), icon: LockKeyhole, to: '/doctor/security' },
                ...(user?.isAdmin ? [{ label: t('Niveda team'), icon: ShieldPlus, to: '/admin' }] : []),
                { label: t('Log out'), icon: LogOut, onClick: logout },
              ]} />
            </div>
          </header>
          <main className="content" id="main"><Outlet /></main>
        </div>
      </div>
      <nav className="bottom-nav" aria-label={t('Main')}>
        {main.map((it) => <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'active' : '')}><it.icon aria-hidden />{it.label.replace('Find a patient', 'Find').replace('My patients', 'Patients').replace('My activity', 'Activity')}</NavLink>)}
        <button onClick={() => setMore(true)}><Ellipsis aria-hidden />{t('More')}{!!unread.data && <span className="dot" />}</button>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title={brand.name} className="more-sheet">
        <nav className="stack" style={{ '--gap': '2px' } as React.CSSProperties} aria-label={t('More')} onClick={() => setMore(false)}>
          {account.map((it) => <NavLink key={it.to} to={it.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><it.icon aria-hidden />{it.label}{!!it.badge && <Badge tone="danger">{it.badge}</Badge>}</NavLink>)}
          <button className="nav-link" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={logout}><LogOut aria-hidden />{t('Log out')}</button>
        </nav>
      </Modal>
    </>
  );
}
