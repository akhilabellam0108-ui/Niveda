/**
 * Translating text the server (or the demo backend) saved in English: notifications and
 * access-log labels. They are stored in English so every reader sees them in their own
 * language. Each known English sentence is a template; names and other values inside it are
 * kept as they are, and known values (record types, durations, permissions) are translated.
 *
 * Keep the templates in step with the _notify(...) calls in supabase/migrations and notify(...)
 * in src/services. Unknown text is shown unchanged.
 */
import { t } from './index';
import { PERMISSIONS, RECORD_TYPES } from '../lib/recordMeta';

/* templates:start */
const TITLES = [
  'Access expired', 'Access ended', 'Access ends soon', 'New entry in your record', 'Record corrected', 'Medication stopped',
  'Access granted', 'Permissions changed', 'Access revoked', 'Request declined', 'Access request', 'Emergency access to your record',
  'A file was blocked', 'Welcome to Niveda', 'Access expires tomorrow', 'New consultation added', 'New lab report',
];

const TEMPLATES = [
  '{name} ({hospital}) opened your allergies, medicines, conditions and surgeries in an emergency: {reason}. It ends by itself in 4 hours. If you didn’t expect this, end it now.',
  '{name} opened your allergies, medicines, conditions and surgeries in an emergency: {reason}. It ends by itself in 4 hours. If you didn’t expect this, end it now.',
  '{name} ({hospital}) requested access to your {parts} for {duration}.',
  '{name} gave you access to their records for {duration}.',
  '{name} amended “{title}”. The original is kept in its history.',
  '{name} added {what} to your medical record.',
  'Your access to {name}’s records has expired.',
  '{name}’s access to your records ends within 24 hours.',
  '{name} can no longer see your records.',
  '{name} changed what you can see.',
  '{name} ended your access to their records.',
  '{name} declined your access request.',
  '{name} didn’t pass Niveda’s safety check and can’t be opened. {note}',
  '{name} stopped {title}.',
  '{name}’s access to your records ends tomorrow. You can extend or revoke it anytime.',
  '{name} added a consultation, a diagnosis and a prescription to your medical record.',
  'Your {test} results from {lab} were added.',
];

/** Durations written by the server, e.g. "24 hours", "3 days". */
const DURATIONS = ['1 hour', '1 day', '{n} hours', '{n} days'];

/** Other English values saved in the access log (how access was given, etc.). */
const VALUES = ['Invitation', 'Doctor directory', 'Doctor access code', 'QR code', 'Approved request', 'Emergency access', '4 hours', 'Patient account'];
/* templates:end */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compiled = TEMPLATES.map((tpl) => {
  const names: string[] = [];
  const re = new RegExp(`^${escape(tpl).replace(/\\\{(\w+)\\\}/g, (_m, n: string) => { names.push(n); return '([\\s\\S]*?)'; })}$`);
  return { tpl, re, names };
});

export function tDuration(v: string): string {
  const m = /^(\d+) (hour|hours|day|days)$/.exec(v.trim());
  if (!m) return t(v);
  const n = Number(m[1]);
  if (m[2].startsWith('hour')) return n === 1 ? t('1 hour') : t('{n} hours', { n });
  return n === 1 ? t('1 day') : t('{n} days', { n });
}

/** "a consultation" / "an allergy" → the record type in the interface language. */
function recordKind(v: string): string {
  const bare = v.replace(/^(a|an) /i, '').trim().toLowerCase();
  const type = Object.values(RECORD_TYPES).find((m) => m.label.toLowerCase() === bare);
  return type ? t(type.label) : v;
}

/** "medications, lab results" → each permission in the interface language. */
function permissionList(v: string): string {
  return v.split(/,\s*/).map((part) => {
    const p = PERMISSIONS.find((x) => x.label.toLowerCase() === part.trim().toLowerCase());
    return p ? t(p.label) : part;
  }).join(', ');
}

const CONVERT: Record<string, (v: string) => string> = {
  duration: tDuration,
  what: recordKind,
  parts: permissionList,
  reason: (v) => t(v),
  note: (v) => t(v),
};

/** A notification title, body or access-log label saved in English, in the interface language. */
export function tServer(text: string | undefined | null): string {
  if (!text) return '';
  if (TITLES.includes(text) || VALUES.includes(text)) return t(text);
  if (DURATIONS.length && /^\d+ (hour|hours|day|days)$/.test(text)) return tDuration(text);
  for (const { tpl, re, names } of compiled) {
    const m = re.exec(text);
    if (!m) continue;
    const vars: Record<string, string> = {};
    names.forEach((n, i) => { vars[n] = (CONVERT[n] ?? ((v: string) => v))(m[i + 1] ?? ''); });
    return t(tpl, vars);
  }
  // "Medications, Lab reports · 24 hours" — what a doctor asked for, and for how long.
  const asked = /^(.+) · (\d+ (?:hour|hours|day|days))$/.exec(text);
  if (asked) return `${permissionList(asked[1])} · ${tDuration(asked[2])}`;
  // "Consultation: Persistent cough" — a record type, then what the person wrote.
  const typed = /^([^:]{2,40}): ([\s\S]+)$/.exec(text);
  if (typed && Object.values(RECORD_TYPES).some((m) => m.label === typed[1])) return `${t(typed[1])}: ${typed[2]}`;
  return t(text);
}
