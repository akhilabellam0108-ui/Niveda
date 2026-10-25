import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { t } from '../../i18n';
/**
 * Goes back to the previous screen. If there is no previous Niveda screen (the page was
 * opened directly, reloaded, or reached from another site), it goes to `fallback` instead of
 * leaving the app. React Router numbers its own history entries in `history.state.idx`.
 */
export function BackButton({ fallback, className, onBack }: { fallback: string; className?: string; onBack?: () => void }) {
  const navigate = useNavigate();
  const goBack = () => {
    if (onBack) { onBack(); return; }
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
  return (
    <button type="button" className={`back-btn${className ? ` ${className}` : ''}`} onClick={goBack} aria-label={t('Go back')} title={t('Go back')}>
      <ArrowLeft aria-hidden /><span className="back-btn-label">{t('Back')}</span>
    </button>
  );
}
