import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, Stethoscope, Building2, ArrowRight, CornerDownLeft } from 'lucide-react';
import { searchPatient, type SearchResult } from '../../services';
import { Modal } from '../ui';

const GROUP_LABEL: Record<SearchResult['kind'], string> = { record: 'Records', document: 'Documents', doctor: 'Doctors', hospital: 'Hospitals & clinics', page: 'Go to' };
const ICON = { record: Stethoscope, document: FileText, doctor: Stethoscope, hospital: Building2, page: ArrowRight };

/** Global search (Ctrl/⌘ K) across the patient's own record. */
export function SearchPalette({ open, onClose, onOpenRecord }: { open: boolean; onClose: () => void; onOpenRecord: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(''); setResults([]); } }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(() => searchPatient(q).then((r) => { setResults(r); setActive(0); }).catch(() => setResults([])).finally(() => setLoading(false)), 140);
    return () => clearTimeout(t);
  }, [q]);

  const grouped = useMemo(() => {
    const order: SearchResult['kind'][] = ['record', 'document', 'doctor', 'hospital', 'page'];
    return order.map((k) => [k, results.filter((r) => r.kind === k)] as const).filter(([, l]) => l.length);
  }, [results]);
  const flat = grouped.flatMap(([, l]) => l);

  const choose = (r: SearchResult) => {
    onClose();
    if (r.kind === 'record') onOpenRecord(r.id);
    else navigate(r.link);
  };

  return (
    <Modal open={open} onClose={onClose} title={<span className="sr-only">Search your record</span>} className="palette" hideClose>
      <div style={{ margin: '-8px -20px -20px', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        <div className="palette-input">
          <Search aria-hidden />
          <input
            data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doctors, diagnoses, medicines, tests, dates…"
            aria-label="Search" role="combobox" aria-expanded={flat.length > 0} aria-controls="search-results"
            aria-activedescendant={flat[active] ? `sr-${flat[active].id}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === 'Enter' && flat[active]) choose(flat[active]);
            }}
          />
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="palette-results" id="search-results" role="listbox" ref={listRef}>
          {q.trim().length < 2 ? (
            <p className="small subtle" style={{ padding: 12 }}>Try “asthma”, “Priya”, “CBC”, “Lakeview” or “2022”.</p>
          ) : !loading && !flat.length ? (
            <p className="small subtle" style={{ padding: 12 }}>Nothing found for “{q}”.</p>
          ) : grouped.map(([kind, list]) => (
            <div key={kind}>
              <div className="palette-group">{GROUP_LABEL[kind]}</div>
              {list.map((r) => {
                const Icon = ICON[r.kind];
                const i = flat.indexOf(r);
                return (
                  <button key={r.id} id={`sr-${r.id}`} role="option" aria-selected={i === active} className="palette-item" onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                    <span className="type-icon sm"><Icon aria-hidden /></span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="strong truncate" style={{ display: 'block' }}>{r.title}</span>
                      <span className="xs muted truncate" style={{ display: 'block' }}>{r.subtitle}</span>
                    </span>
                    {i === active && <CornerDownLeft size={14} className="subtle desktop-only" aria-hidden />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
