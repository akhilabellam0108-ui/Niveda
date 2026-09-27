import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal, X, Ban, Paperclip, CornerDownRight } from 'lucide-react';
import type { MedicalRecord } from '../../types';
import { RECORD_CATEGORIES, RECORD_TYPES, recordTitle, recordSummary } from '../../lib/recordMeta';
import { fmtDayMonth, fmtDate } from '../../lib/dates';
import { Button, Input, Select } from '../ui';
import { RecordCard, StatusBadge, TypeIcon } from './RecordCard';

/* ---------------- Filters ---------------- */

export interface FilterState {
  q: string;
  category: string; // 'all' or category key
  doctor: string;
  hospital: string;
  from: string;
  to: string;
}

export const emptyFilters = (init?: Partial<FilterState>): FilterState => ({ q: '', category: 'all', doctor: '', hospital: '', from: '', to: '', ...init });

const doctorOf = (r: MedicalRecord) => (r.createdBy.role === 'doctor' ? r.createdBy.name : String(r.data.doctor ?? r.data.prescriber ?? r.data.surgeon ?? r.data.attendingDoctor ?? r.data.orderedBy ?? '')) || '';
const hospitalOf = (r: MedicalRecord) => r.organization?.name ?? String(r.data.facility ?? '');

export function applyFilters(records: MedicalRecord[], f: FilterState): MedicalRecord[] {
  const q = f.q.trim().toLowerCase();
  const cat = RECORD_CATEGORIES.find((c) => c.key === f.category);
  return records.filter((r) => {
    if (cat && !cat.types.includes(r.type)) return false;
    if (f.doctor && doctorOf(r) !== f.doctor) return false;
    if (f.hospital && hospitalOf(r) !== f.hospital) return false;
    if (f.from && r.date < f.from) return false;
    if (f.to && r.date > f.to) return false;
    if (q) {
      const hay = [recordTitle(r), RECORD_TYPES[r.type].label, r.createdBy.name, hospitalOf(r), fmtDate(r.date), r.date, ...Object.values(r.data).map(String)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function RecordFilters({ records, value, onChange, showCategories = true }: { records: MedicalRecord[]; value: FilterState; onChange: (f: FilterState) => void; showCategories?: boolean }) {
  const [more, setMore] = useState(!!(value.doctor || value.hospital || value.from || value.to));
  const doctors = useMemo(() => [...new Set(records.map(doctorOf).filter(Boolean))].sort(), [records]);
  const hospitals = useMemo(() => [...new Set(records.map(hospitalOf).filter(Boolean))].sort(), [records]);
  const counts = useMemo(() => Object.fromEntries(RECORD_CATEGORIES.map((c) => [c.key, records.filter((r) => c.types.includes(r.type)).length])), [records]);
  const active = value.doctor || value.hospital || value.from || value.to;
  const set = (p: Partial<FilterState>) => onChange({ ...value, ...p });
  return (
    <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
      <div className="row">
        <div className="input-wrap grow">
          <Search aria-hidden />
          <Input type="search" placeholder="Search diagnoses, medicines, doctors, hospitals…" aria-label="Search records" value={value.q} onChange={(e) => set({ q: e.target.value })} />
        </div>
        <Button icon={SlidersHorizontal} onClick={() => setMore((m) => !m)} aria-expanded={more}>
          <span className="desktop-only">Filters</span>{active ? <span className="badge badge-accent" style={{ height: 18 }}>on</span> : null}
        </Button>
      </div>
      {more && (
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <label className="field"><span className="field-label">Doctor</span><Select value={value.doctor} onChange={(e) => set({ doctor: e.target.value })} options={doctors} placeholder="Any doctor" /></label>
            <label className="field"><span className="field-label">Hospital / clinic</span><Select value={value.hospital} onChange={(e) => set({ hospital: e.target.value })} options={hospitals} placeholder="Any" /></label>
            <label className="field"><span className="field-label">From</span><Input type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} /></label>
            <label className="field"><span className="field-label">To</span><Input type="date" value={value.to} onChange={(e) => set({ to: e.target.value })} /></label>
          </div>
          {active && <Button size="sm" variant="ghost" icon={X} style={{ marginTop: 10 }} onClick={() => set({ doctor: '', hospital: '', from: '', to: '' })}>Clear filters</Button>}
        </div>
      )}
      {showCategories && (
        <div className="chip-scroll" role="group" aria-label="Record type">
          <button className="chip" aria-pressed={value.category === 'all'} onClick={() => set({ category: 'all' })}>All <span className="count">{records.length}</span></button>
          {RECORD_CATEGORIES.filter((c) => counts[c.key] > 0 || value.category === c.key).map((c) => (
            <button key={c.key} className="chip" aria-pressed={value.category === c.key} onClick={() => set({ category: c.key })}>{c.label} <span className="count">{counts[c.key]}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Timeline ---------------- */

type Entry =
  | { kind: 'record'; date: string; record: MedicalRecord; children: MedicalRecord[] }
  | { kind: 'stopped'; date: string; record: MedicalRecord };

export function buildTimeline(records: MedicalRecord[], all: MedicalRecord[] = records): Entry[] {
  const ids = new Set(records.map((r) => r.id));
  const entries: Entry[] = [];
  for (const r of records) {
    // Children render under a parent that is also shown; otherwise they stand alone.
    if (r.parentId && ids.has(r.parentId)) continue;
    entries.push({ kind: 'record', date: r.date, record: r, children: all.filter((c) => c.parentId === r.id && ids.has(c.id)) });
  }
  for (const r of records) {
    if (r.type === 'medication' && r.data.discontinuedOn) entries.push({ kind: 'stopped', date: String(r.data.discontinuedOn), record: r });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date) || (b.kind === 'record' && a.kind === 'record' ? b.record.createdAt.localeCompare(a.record.createdAt) : 0));
}

export function Timeline({ records, onOpen, highlightId, viewerIsPatient = true }: { records: MedicalRecord[]; onOpen: (id: string) => void; highlightId?: string; viewerIsPatient?: boolean }) {
  const entries = useMemo(() => buildTimeline(records), [records]);
  const byYear = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) {
      const y = e.date.slice(0, 4);
      if (!m.has(y)) m.set(y, []);
      m.get(y)!.push(e);
    }
    return [...m.entries()];
  }, [entries]);

  return (
    <div className="timeline">
      {byYear.map(([year, list]) => (
        <section key={year} aria-label={year}>
          <div className="tl-year"><h2>{year}</h2><span>{list.length} {list.length === 1 ? 'entry' : 'entries'}</span></div>
          <ol className="tl-list">
            {list.map((e) => (
              <li key={`${e.kind}-${e.record.id}`} className="tl-item">
                <div className="tl-date">{fmtDayMonth(e.date)}</div>
                <div className="tl-node">{e.kind === 'stopped' ? <span className="type-icon" aria-hidden><Ban /></span> : <TypeIcon type={e.record.type} />}</div>
                {e.kind === 'stopped' ? (
                  <button type="button" className="rec-card" onClick={() => onOpen(e.record.id)} style={{ boxShadow: 'none', background: 'transparent' }}>
                    <div className="rec-top"><span className="rec-type">Medication stopped</span><span className="subtle xs mobile-only">{fmtDate(e.date)}</span></div>
                    <div className="rec-title">{recordTitle(e.record)}</div>
                    {e.record.data.discontinueReason && <div className="rec-summary">{String(e.record.data.discontinueReason)}</div>}
                  </button>
                ) : (
                  <RecordCard record={e.record} onOpen={onOpen} highlight={highlightId === e.record.id} viewerIsPatient={viewerIsPatient}>
                    {e.children.length > 0 && (
                      <div className="tl-sub" style={{ marginLeft: 0 }}>
                        {e.children.map((c) => (
                          <button type="button" key={c.id} className="sub-row"
                            onClick={(ev) => { ev.stopPropagation(); onOpen(c.id); }}>
                            <CornerDownRight aria-hidden />
                            <span className="subtle" style={{ minWidth: 86 }}>{RECORD_TYPES[c.type].label}</span>
                            <span className="truncate" style={{ color: 'var(--text)' }}>{recordTitle(c)}{recordSummary(c) && c.type === 'medication' ? ` · ${recordSummary(c)}` : ''}</span>
                            <StatusBadge record={c} />
                            {c.attachments.length > 0 && <Paperclip aria-hidden />}
                          </button>
                        ))}
                      </div>
                    )}
                  </RecordCard>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
