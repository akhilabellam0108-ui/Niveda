import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * Goes back to the previous screen. If there is no previous Niveda screen (the page was
 * opened directly, reloaded, or reached from another site), it goes to `fallback` instead of
 * leaving the app. React Router numbers its own history entries in `history.state.idx`.
 */
export function BackButton({ fallback, className }: { fallback: string; className?: string }) {
  const navigate = useNavigate();
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
  return (
    <button type="button" className={`back-btn${className ? ` ${className}` : ''}`} onClick={goBack} aria-label="Go back" title="Go back">
      <ArrowLeft aria-hidden /><span className="back-btn-label">Back</span>
    </button>
  );
}
