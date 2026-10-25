import { Languages } from 'lucide-react';
import { LANGUAGES, changeLanguage, getLanguage, t, type LangCode } from '../../i18n';

/**
 * Choose the interface language. Names are shown in their own script, so anyone can find
 * theirs whatever language the app is in now. Choosing one reloads the app in that language.
 * `onChosen` runs first (e.g. to save the choice to the person's account).
 */
export function LanguagePicker({ compact = false, onChosen }: { compact?: boolean; onChosen?: (lang: LangCode) => void | Promise<void> }) {
  const current = getLanguage();
  return (
    <label className={`lang-picker${compact ? ' compact' : ''}`}>
      <Languages aria-hidden size={16} />
      <span className={compact ? 'sr-only' : 'lang-picker-label'}>{t('Language')}</span>
      <select
        className="select"
        value={current}
        aria-label={t('Language')}
        onChange={async (e) => {
          const lang = e.target.value as LangCode;
          try {
            await onChosen?.(lang);
          } finally {
            changeLanguage(lang);
          }
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.native}{l.code !== 'en' ? ` — ${l.english}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
