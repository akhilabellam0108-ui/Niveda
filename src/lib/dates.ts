/** Small date helpers. Display follows the interface language (getLocale), always with Western digits. */
import { getLocale, t } from '../i18n';

let clockOffsetMs = 0;
/** The app's notion of "now". Tests can shift it to simulate expiry. */
export const now = () => new Date(Date.now() + clockOffsetMs);
export const nowISO = () => now().toISOString();
export const advanceClock = (ms: number) => { clockOffsetMs += ms; };
export const todayISO = () => toISODate(now());

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Locale for dates: the interface language, Western digits (clearer for doses and times). */
const loc = () => `${getLocale()}-u-nu-latn`;

export const parseDate = (s: string) => (s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s));

export const fmtDate = (s?: string) =>
  s ? parseDate(s).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtLongDate = (s?: string) =>
  s ? parseDate(s).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

export const fmtDayMonth = (s: string) => parseDate(s).toLocaleDateString(loc(), { day: '2-digit', month: 'short' });

export const fmtMonthYear = (s: string) => parseDate(s).toLocaleDateString(loc(), { month: 'long', year: 'numeric' });

export const fmtTime = (s: string) => parseDate(s).toLocaleTimeString(loc(), { hour: 'numeric', minute: '2-digit' });

export const fmtDateTime = (s?: string) => (s ? `${fmtDate(s)}, ${fmtTime(s)}` : '—');

export function ageFrom(dob?: string): number | undefined {
  if (!dob) return undefined;
  const b = parseDate(dob);
  const n = now();
  let age = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) age--;
  return age;
}

export function relativeTime(iso: string): string {
  const diff = now().getTime() - parseDate(iso).getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  const hr = Math.round(abs / 3600000);
  const day = Math.round(abs / 86400000);
  let s: string;
  if (min < 1) return t('just now');
  if (min < 60) s = t('{n} min', { n: min });
  else if (hr < 24) s = t('{n} hr', { n: hr });
  else if (day < 30) s = day === 1 ? t('1 day') : t('{n} days', { n: day });
  else return fmtDate(iso);
  return future ? t('in {time}', { time: s }) : t('{time} ago', { time: s });
}

/** "Expires in 2 days" style label for access grants. */
export function timeLeft(iso: string): string {
  const ms = parseDate(iso).getTime() - now().getTime();
  if (ms <= 0) return t('Expired');
  const hr = ms / 3600000;
  if (hr < 1) return t('{n} min left', { n: Math.max(1, Math.round(ms / 60000)) });
  if (hr < 48) return t('{n} hr left', { n: Math.round(hr) });
  return t('{n} days left', { n: Math.round(hr / 24) });
}

export const addHours = (iso: string, h: number) => new Date(parseDate(iso).getTime() + h * 3600000).toISOString();
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
