import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  House, Clock3, FolderHeart, Pill, TriangleAlert, FileText, ShieldCheck, Siren, Bell, ScrollText, LockKeyhole,
  UserRound, Settings, Search, LogOut, Ellipsis, ChevronDown, ShieldPlus,
} from 'lucide-react';
import type { RecordType } from '../../types';
import { brand, PROTOTYPE_NOTICE } from '../../config/brand';
import { isLive } from '../../config/backend';
import { accessService, notificationService } from '../../services';
import { useSession } from '../../state/SessionContext';
import { useLive } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { Avatar, Badge, Modal } from '../ui';
import { Brand } from '../ui/Logo';
import { BackButton } from '../ui/BackButton';
import { RecordDrawer } from '../records/RecordDrawer';
import { AddRecordDialog } from '../records/AddRecordDialog';
import { UploadDialog } from '../documents/UploadDialog';
import { GrantAccessDialog } from '../access/GrantAccessDialog';
import { SearchPalette } from '../search/SearchPalette';
import { MedicationAlarms, NativeAlarmSync } from '../medications/Doses';

/* ---------------- Shared nav pieces ---------------- */

export interface NavItem { to: string; label: string; icon: LucideIcon; badge?: number; end?: boolean }

export function SideNav({ sections, footer }: { sections: { title?: string; items: NavItem[] }[]; footer?: ReactNode }) {
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand-row"><Brand to={sections[0].items[0].to} /></div>
      {sections.map((s, i) => (
        <div key={i} className="stack" style={{ '--gap': '2px' } as React.CSSProperties}>
          {s.title && <div className="nav-section">{s.title}</div>}
          {s.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <it.icon aria-hidden />{it.label}
              {!!it.badge && <Badge tone="danger">{it.badge}</Badge>}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="sidebar-foot">{footer}</div>
    </nav>
  );
}

export function UserMenu({ name, sub, photo, doctor, items }: { name: string; sub: string; photo?: string; doctor?: boolean; items: { label: string; icon: LucideIcon; to?: string; onClick?: () => void }[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement).closest('.user-menu')) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div className="user-menu" style={{ position: 'relative' }}>
      <button className="user-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label="Account menu">
        <Avatar name={name} src={photo} size="sm" doctor={doctor} />
        <ChevronDown size={14} className="subtle desktop-only" aria-hidden />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head"><div className="strong small">{name}</div><div className="xs muted">{sub}</div></div>
          {items.map((it) => it.to ? (
            <Link key={it.label} to={it.to} role="menuitem" className="menu-item" onClick={() => setOpen(false)}><it.icon aria-hidden />{it.label}</Link>
          ) : (
            <button key={it.label} role="menuitem" className="menu-item" onClick={() => { setOpen(false); it.onClick?.(); }}><it.icon aria-hidden />{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProtoBar() {
  if (isLive) return null;
  return <div className="proto-bar" role="note"><b>Prototype</b> · {PROTOTYPE_NOTICE.replace('Prototype: ', '')}</div>;
}

/** Opens the record drawer via ?record=… so records are linkable from anywhere. */
export function useRecordParam() {
  const [params, setParams] = useSearchParams();
  const recordId = params.get('record') ?? undefined;
  const open = useCallback((id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('record', id); return n; }), [setParams]);
  const close = useCallback(() => setParams((p) => { const n = new URLSearchParams(p); n.delete('record'); return n; }), [setParams]);
  return { recordId, open, close };
}

/* ---------------- Patient-wide actions ---------------- */

interface PatientUI {
  addRecord: (type?: RecordType) => void;
  upload: (recordId?: string) => void;
  grantAccess: () => void;
  openRecord: (id: string) => void;
  search: () => void;
}
const UICtx = createContext<PatientUI | null>(null);
export const usePatientUI = () => useContext(UICtx)!;

const PRIMARY: NavItem[] = [
  { to: '/app', label: 'Home', icon: House, end: true },
  { to: '/app/timeline', label: 'Timeline', icon: Clock3 },
  { to: '/app/records', label: 'Medical records', icon: FolderHeart },
  { to: '/app/medications', label: 'Medications', icon: Pill },
  { to: '/app/allergies', label: 'Allergies', icon: TriangleAlert },
  { to: '/app/reports', label: 'Reports', icon: FileText },
];

/** The shell's home screen, where there is nowhere to go back to. */
export const isHome = (pathname: string, home: string) => pathname.replace(/\/+$/, '') === home;

export function PatientShell() {
  const { patient, signOut, user } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { recordId, open: openRecord, close: closeRecord } = useRecordParam();
  const [addType, setAddType] = useState<RecordType | undefined | null>(null);
  const [uploadFor, setUploadFor] = useState<string | undefined | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const unread = useLive(() => notificationService.unreadCount(), []);
  const access = useLive(() => accessService.listForPatient(), []);
  const pending = access.data?.requests.length ?? 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setMoreOpen(false); window.scrollTo(0, 0); }, [location.pathname]);

  const ui: PatientUI = {
    addRecord: (t) => setAddType(t),
    upload: (r) => setUploadFor(r),
    grantAccess: () => setGrantOpen(true),
    openRecord,
    search: () => setSearchOpen(true),
  };

  const sections = [
    { items: PRIMARY },
    { title: 'Sharing & safety', items: [
      { to: '/app/access', label: 'Doctors & access', icon: ShieldCheck, badge: pending },
      { to: '/app/emergency', label: 'Emergency', icon: Siren },
      { to: '/app/activity', label: 'Access log', icon: ScrollText },
      { to: '/app/privacy', label: 'Privacy & security', icon: LockKeyhole },
    ] },
    { title: 'Account', items: [
      { to: '/app/notifications', label: 'Notifications', icon: Bell, badge: unread.data },
      { to: '/app/profile', label: 'Profile', icon: UserRound },
      { to: '/app/settings', label: 'Settings', icon: Settings },
    ] },
  ];

  if (!patient) return null;
  const moreItems = [...PRIMARY.slice(3), ...sections[1].items, ...sections[2].items];

  return (
    <UICtx.Provider value={ui}>
      <ProtoBar />
      <div className="shell">
        <SideNav sections={sections} footer={
          <div className="privacy-pill"><ShieldCheck aria-hidden /><span>Your record is private. Only doctors you approve can see it, and every view is logged.</span></div>
        } />
        <div className="main">
          <header className="topbar">
            {!isHome(location.pathname, '/app') && <BackButton fallback="/app" />}
            <span className="mobile-only"><Brand to="/app" size={28} /></span>
            <button className="search-trigger desktop-only" onClick={() => setSearchOpen(true)}><Search aria-hidden />Search your record<kbd>Ctrl K</kbd></button>
            <div className="topbar-actions">
              <button className="icon-btn mobile-only" aria-label="Search" onClick={() => setSearchOpen(true)}><Search /></button>
              <button className="icon-btn" aria-label={`Notifications${unread.data ? `, ${unread.data} unread` : ''}`} onClick={() => navigate('/app/notifications')}>
                <Bell />{!!unread.data && <span className="dot">{unread.data}</span>}
              </button>
              <UserMenu name={patient.fullName} sub={`Patient ID ${patient.patientCode}`} photo={patient.photoDataUrl} items={[
                { label: 'Profile', icon: UserRound, to: '/app/profile' },
                { label: 'Privacy & security', icon: LockKeyhole, to: '/app/privacy' },
                { label: 'Settings', icon: Settings, to: '/app/settings' },
                ...(user?.isAdmin ? [{ label: 'Niveda team', icon: ShieldPlus, to: '/admin' }] : []),
                { label: 'Log out', icon: LogOut, onClick: async () => { await signOut(); navigate('/login'); } },
              ]} />
            </div>
          </header>
          <main className="content" id="main">
            <Outlet />
          </main>
        </div>
      </div>

      <nav className="bottom-nav" aria-label="Main">
        <NavLink to="/app" end className={({ isActive }) => (isActive ? 'active' : '')}><House aria-hidden />Home</NavLink>
        <NavLink to="/app/timeline" className={({ isActive }) => (isActive ? 'active' : '')}><Clock3 aria-hidden />Timeline</NavLink>
        <NavLink to="/app/records" className={({ isActive }) => (isActive ? 'active' : '')}><FolderHeart aria-hidden />Records</NavLink>
        <NavLink to="/app/access" className={({ isActive }) => (isActive ? 'active' : '')}><ShieldCheck aria-hidden />Access{pending > 0 && <span className="dot" />}</NavLink>
        <button onClick={() => setMoreOpen(true)} aria-haspopup="dialog"><Ellipsis aria-hidden />More{!!unread.data && <span className="dot" />}</button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title={brand.name} className="more-sheet">
        <nav className="stack" style={{ '--gap': '2px' } as React.CSSProperties} aria-label="More">
          {moreItems.map((it) => (
            <NavLink key={it.to} to={it.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <it.icon aria-hidden />{it.label}{!!it.badge && <Badge tone="danger">{it.badge}</Badge>}
            </NavLink>
          ))}
          <button className="nav-link" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={async () => { await signOut(); navigate('/login'); }}><LogOut aria-hidden />Log out</button>
        </nav>
      </Modal>

      <MedicationAlarms />
      <NativeAlarmSync />
      <RecordDrawer recordId={recordId} onClose={closeRecord} onOpenRecord={openRecord} viewer="patient" />
      <AddRecordDialog open={addType !== null} initialType={addType ?? undefined} onClose={() => setAddType(null)}
        onSaved={(id) => { setAddType(null); toast('Added to your record'); navigate(`/app/timeline?record=${id}`); }} />
      <UploadDialog open={uploadFor !== null} recordId={uploadFor ?? undefined} onClose={() => setUploadFor(null)}
        onDone={(n) => { setUploadFor(null); toast(`${n} document${n > 1 ? 's' : ''} uploaded`); if (!location.pathname.startsWith('/app/reports')) navigate('/app/reports'); }} />
      <GrantAccessDialog open={grantOpen} onClose={() => setGrantOpen(false)} onGranted={() => { if (!location.pathname.startsWith('/app/access')) navigate('/app/access'); }} />
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} onOpenRecord={(id) => { navigate(`/app/timeline?record=${id}`); }} />
    </UICtx.Provider>
  );
}

