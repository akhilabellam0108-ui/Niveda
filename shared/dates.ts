/** Small date helpers. All display uses the en-IN locale for DD Mon YYYY formatting. */

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

export const parseDate = (s: string) => (s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s));

export const fmtDate = (s?: string) =>
  s ? parseDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtLongDate = (s?: string) =>
  s ? parseDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

export const fmtDayMonth = (s: string) => parseDate(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

export const fmtMonthYear = (s: string) => parseDate(s).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export const fmtTime = (s: string) => parseDate(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

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
  if (min < 1) return 'just now';
  if (min < 60) s = `${min} min`;
  else if (hr < 24) s = `${hr} hr`;
  else if (day < 30) s = `${day} day${day === 1 ? '' : 's'}`;
  else return fmtDate(iso);
  return future ? `in ${s}` : `${s} ago`;
}

/** "Expires in 2 days" style label for access grants. */
export function timeLeft(iso: string): string {
  const ms = parseDate(iso).getTime() - now().getTime();
  if (ms <= 0) return 'Expired';
  const hr = ms / 3600000;
  if (hr < 1) return `${Math.max(1, Math.round(ms / 60000))} min left`;
  if (hr < 48) return `${Math.round(hr)} hr left`;
  return `${Math.round(hr / 24)} days left`;
}

export const addHours = (iso: string, h: number) => new Date(parseDate(iso).getTime() + h * 3600000).toISOString();
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
