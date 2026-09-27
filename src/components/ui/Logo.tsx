import { Link } from 'react-router-dom';
import { brand } from '../../config/brand';

/** A continuous line that loops into a closed, protected shape: continuity + privacy. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#134e48" />
      <path d="M5.5 17.2h4.6l2.4-5.2 3.9 9.6 2.7-6.1 1.5 1.7h5.9" fill="none" stroke="#e6f4ef" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="26.4" cy="17.2" r="1.7" fill="#7fd3bf" />
    </svg>
  );
}

export function Brand({ to = '/', size }: { to?: string; size?: number }) {
  return (
    <Link to={to} className="brand" aria-label={`${brand.name} home`}>
      <LogoMark size={size} />
      <span className="brand-name">{brand.name}</span>
    </Link>
  );
}
