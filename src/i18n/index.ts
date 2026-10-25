/**
 * Niveda's interface languages.
 *
 * - Every piece of interface text is written in English in the code and wrapped in t('…').
 *   The English text IS the key: src/i18n/locales/<code>.json maps it to the translation.
 *   Missing translations fall back to English, so nothing ever shows blank.
 * - Values: t('Signed in as {email}', { email }) — translations keep the {email} placeholder.
 * - The language is chosen before the app loads (main.tsx), so text in module-level constants
 *   is translated too. Changing language saves the choice and reloads the app.
 * - Only the interface is translated. What patients and doctors write — diagnoses, medicine
 *   names, notes — is shown exactly as entered: machine-translating medical content is unsafe.
 *
 * Translations are drafts. Before launch, a clinician fluent in each language should review
 * the medical terms. `npm run i18n:check` lists anything missing.
 */

export type LangCode = 'en' | 'hi' | 'bn' | 'mr' | 'te' | 'ta' | 'gu' | 'kn' | 'ml';

export interface Language {
  code: LangCode;
  /** Name in its own script — what people look for. */
  native: string;
  /** Name in English. */
  english: string;
  /** BCP-47 locale for dates and speech. */
  locale: string;
}

/** Ordered by number of speakers in India (Census 2011), English first. */
export const LANGUAGES: readonly Language[] = [
  { code: 'en', native: 'English', english: 'English', locale: 'en-IN' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', locale: 'hi-IN' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali', locale: 'bn-IN' },
  { code: 'mr', native: 'मराठी', english: 'Marathi', locale: 'mr-IN' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu', locale: 'te-IN' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil', locale: 'ta-IN' },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati', locale: 'gu-IN' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada', locale: 'kn-IN' },
  { code: 'ml', native: 'മലയാളം', english: 'Malayalam', locale: 'ml-IN' },
];

const STORAGE_KEY = 'niveda.lang';
let current: LangCode = 'en';
let dict: Record<string, string> = {};

const isLang = (v: unknown): v is LangCode => LANGUAGES.some((l) => l.code === v);

/** Each language is its own file, loaded only when chosen. */
const loaders: Record<Exclude<LangCode, 'en'>, () => Promise<{ default: Record<string, string> }>> = {
  hi: () => import('./locales/hi.json'),
  bn: () => import('./locales/bn.json'),
  mr: () => import('./locales/mr.json'),
  te: () => import('./locales/te.json'),
  ta: () => import('./locales/ta.json'),
  gu: () => import('./locales/gu.json'),
  kn: () => import('./locales/kn.json'),
  ml: () => import('./locales/ml.json'),
};

function stored(): LangCode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

/** First visit: use the phone's language if Niveda has it, otherwise English. */
function fromDevice(): LangCode {
  try {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const base = tag.toLowerCase().split('-')[0];
      if (isLang(base)) return base;
    }
  } catch {
    /* no navigator (tests) */
  }
  return 'en';
}

/** Loads the saved (or device) language. Called once, before the app is imported. */
export async function initLanguage(): Promise<LangCode> {
  const lang = stored() ?? fromDevice();
  await loadLanguage(lang);
  return lang;
}

/** Switches the in-memory language (no reload). Exported for tests and initLanguage. */
export async function loadLanguage(lang: LangCode): Promise<void> {
  if (lang === 'en') {
    dict = {};
  } else {
    try {
      dict = (await loaders[lang]()).default;
    } catch {
      dict = {};
      lang = 'en';
    }
  }
  current = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang === 'en' ? 'en-IN' : lang;
    document.documentElement.dataset.lang = lang;
  }
}

/** Saves the choice and reloads, so every screen — including cached labels — switches. */
export function changeLanguage(lang: LangCode): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage blocked: the choice lasts for this visit only */
  }
  if (lang === current) return;
  window.location.reload();
}

export const getLanguage = (): LangCode => current;
export const getLocale = (): string => LANGUAGES.find((l) => l.code === current)?.locale ?? 'en-IN';

/** Interface text in the current language. `text` is the English original. */
export function t(text: string, vars?: Record<string, unknown>): string {
  let out = (current !== 'en' && dict[text]) || text;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v == null ? '' : String(v));
  }
  return out;
}

/** Translate text that arrives at runtime (e.g. a server message); unknown text stays as it is. */
export const tMaybe = (text: string | undefined | null): string => (text ? t(text) : '');
