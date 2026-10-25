import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Baby, Check, ChevronDown, UsersRound, Plus, ArrowLeftRight } from 'lucide-react';
import { familyService } from '../../services';
import { useSession } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { friendlyError } from '../../services/core';
import { ageLabel } from '../../lib/immunization';
import { todayISO } from '../../lib/dates';
import { Avatar } from '../ui';

import { t } from '../../i18n';

/**
 * Switches which record the app shows. The whole app reloads on the new profile, so every
 * screen — and anything it has cached — shows the right person.
 */
export function useSwitchProfile() {
  const toast = useToast();
  return async (profileId: string | null, to = '/app') => {
    try {
      await familyService.switchTo(profileId);
      window.location.hash = `#${to}`;
      window.location.reload();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };
}

const firstName = (n: string) => n.trim().split(/\s+/)[0];

/** Top-bar control: whose record is open. Shown once someone manages another person's record. */
export function ProfileSwitcher() {
  const { patient, family } = useSession();
  const switchTo = useSwitchProfile();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement).closest('.profile-switch')) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  if (!patient || !family || family.managed.length === 0) return null;
  const today = todayISO();
  const people = [
    { id: family.self.id, name: family.self.fullName, photo: family.self.photoDataUrl, sub: t('You') },
    ...family.managed.map((m) => ({ id: m.patient.id, name: m.patient.fullName, photo: m.patient.photoDataUrl, sub: m.patient.userId ? t('You help manage this record') : ageLabel(m.patient.dateOfBirth, today) })),
  ];
  return (
    <div className="profile-switch" style={{ position: 'relative' }}>
      <button className="profile-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        aria-label={t('Whose record: {name}. Switch profile', { name: patient.fullName })}>
        <Avatar name={patient.fullName} src={patient.photoDataUrl} size="sm" />
        <span className="profile-chip-name">{firstName(patient.fullName)}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="menu profile-menu" role="menu">
          <div className="menu-head"><div className="xs muted strong">{t('Whose record')}</div></div>
          {people.map((p) => (
            <button key={p.id} role="menuitemradio" aria-checked={p.id === patient.id} className="menu-item"
              onClick={() => { setOpen(false); if (p.id !== patient.id) void switchTo(p.id === family.self.id ? null : p.id); }}>
              <Avatar name={p.name} src={p.photo} size="sm" />
              <span className="grow" style={{ textAlign: 'left' }}><span className="strong">{p.name}</span><br /><span className="xs muted">{p.sub}</span></span>
              {p.id === patient.id && <Check aria-hidden />}
            </button>
          ))}
          <div className="menu-sep" />
          <Link to="/app/family?add=1" role="menuitem" className="menu-item" onClick={() => setOpen(false)}><Plus aria-hidden />{t('Add a child')}</Link>
          <Link to="/app/family" role="menuitem" className="menu-item" onClick={() => setOpen(false)}><UsersRound aria-hidden />{t('Family & guardians')}</Link>
        </div>
      )}
    </div>
  );
}

/** Across the top while working on someone else's record, so it's never mistaken for your own. */
export function ManagingBar() {
  const { patient, family, managing } = useSession();
  const switchTo = useSwitchProfile();
  if (!managing || !patient || !family) return null;
  const minor = !patient.userId;
  return (
    <div className="managing-bar" role="status">
      <Baby aria-hidden />
      <span className="grow">
        {minor
          ? t('You’re looking after {name}’s record ({age}). Everything you do here is logged in their record with your name.', { name: patient.fullName, age: ageLabel(patient.dateOfBirth, todayISO()) })
          : t('You’re helping {name} with their record. Everything you do here is logged with your name.', { name: patient.fullName })}
      </span>
      <button className="managing-back" onClick={() => void switchTo(null)}><ArrowLeftRight aria-hidden />{t('Back to my record')}</button>
    </div>
  );
}
