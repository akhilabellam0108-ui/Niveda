import {
  forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CloudOff, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { friendlyError } from '../../services';

/* ---------------- Button ---------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  block?: boolean;
  icon?: LucideIcon;
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, block, icon: Icon, iconOnly, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  const cls = ['btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', iconOnly && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : Icon ? <Icon aria-hidden /> : null}
      {!iconOnly && children}
    </button>
  );
});

/* ---------------- Form fields ---------------- */

interface FieldProps {
  label: string;
  required?: boolean;
  help?: ReactNode;
  error?: string;
  className?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}

export function Field({ label, required, help, error, className = '', children }: FieldProps) {
  const id = useId();
  const describedBy = [help && `${id}-help`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden>*</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <span className="field-error" id={`${id}-err`}><AlertCircle size={13} aria-hidden />{error}</span>
      ) : help ? (
        <span className="field-help" id={`${id}-help`}>{help}</span>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...p }, ref) {
  return <input ref={ref} className={`input ${className}`} {...p} />;
});

export function Select({ className = '', options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[]; placeholder?: string }) {
  return (
    <select className={`select ${className}`} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o || '—' : o.label;
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

export function Textarea({ className = '', ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} {...p} />;
}

/* ---------------- Overlays ---------------- */

function useOverlay(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])') ?? []);
    requestAnimationFrame(() => {
      const auto = el?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables().find((f) => f.tagName !== 'BUTTON' || !f.getAttribute('aria-label')?.startsWith('Close')) ?? el;
      auto?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  hideClose?: boolean;
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md', className = '', hideClose }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${size !== 'md' ? `modal-${size}` : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {!hideClose && <Button variant="ghost" size="sm" iconOnly icon={X} aria-label="Close dialog" onClick={onClose} />}
        </div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, header, children, footer, label }: { open: boolean; onClose: () => void; header: ReactNode; children: ReactNode; footer?: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <div className="drawer-head">
          <div className="grow">{header}</div>
          <Button variant="ghost" size="sm" iconOnly icon={X} aria-label="Close panel" onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  children?: ReactNode;
  disabled?: boolean;
}

/** Confirmation for consequential actions (revoke, delete, discontinue…). Shows errors inline. */
export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, danger, children, disabled }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  useEffect(() => { if (open) setErr(undefined); }, [open]);
  const go = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title} size="sm"
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={go} loading={busy} disabled={disabled} data-autofocus>{confirmLabel}</Button>
      </>}>
      <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
        <div className="muted">{body}</div>
        {children}
        {err && <InlineError message={err} />}
      </div>
    </Modal>
  );
}

/* ---------------- States ---------------- */

export function EmptyState({ icon: Icon, title, body, action, compact }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      <div className="empty-icon"><Icon aria-hidden /></div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, title = 'Unable to load this', onRetry }: { error: unknown; title?: string; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <div className="empty-icon tone-danger"><CloudOff aria-hidden /></div>
      <h3>{title}</h3>
      <p>{friendlyError(error, 'Please check your connection and try again.')}</p>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function InlineError({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="alert alert-danger" role="alert"><AlertCircle aria-hidden /><div>{message}</div></div>;
}

export function Skeleton({ w = '100%', h = 14, r, style }: { w?: number | string; h?: number | string; r?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden />;
}

export function SkeletonList({ rows = 4, card = true }: { rows?: number; card?: boolean }) {
  const inner = (
    <div className="stack" style={{ padding: card ? 20 : 0, '--gap': '18px' } as React.CSSProperties} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="row">
          <Skeleton w={36} h={36} r={10} />
          <div className="grow stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <Skeleton w={`${45 + ((i * 17) % 35)}%`} h={13} />
            <Skeleton w={`${25 + ((i * 11) % 30)}%`} h={11} />
          </div>
        </div>
      ))}
    </div>
  );
  return card ? <div className="card">{inner}</div> : inner;
}

/* ---------------- Misc ---------------- */

export function Badge({ tone, children, dot, icon: Icon }: { tone?: 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'violet'; children: ReactNode; dot?: boolean; icon?: LucideIcon }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ''} ${dot ? 'badge-dot' : ''}`}>{Icon && <Icon aria-hidden />}{children}</span>;
}

export function Avatar({ name, src, size, doctor }: { name: string; src?: string; size?: 'sm' | 'lg' | 'xl'; doctor?: boolean }) {
  const initials = name.replace(/^Dr\.?\s+/i, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className={`avatar ${size ? `avatar-${size}` : ''} ${doctor ? 'doctor' : ''}`} aria-hidden>
      {src ? <img src={src} alt="" /> : initials}
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" className="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="badge">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Card({ title, action, children, className = '', pad, footer }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean; footer?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {title && <div className="card-head"><h2>{title}</h2>{action}</div>}
      {pad ? <div className="card-body">{children}</div> : children}
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}
