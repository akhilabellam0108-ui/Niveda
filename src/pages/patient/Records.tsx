import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock3, FilePlus2, FolderHeart, SearchX, Upload } from 'lucide-react';
import { recordService } from '../../services';
import { useLive, useDocumentTitle, useMediaQuery } from '../../state/hooks';
import { brand } from '../../config/brand';
import { RECORD_CATEGORIES } from '../../lib/recordMeta';
import { RECORD_ICON } from '../../lib/icons';
import { fmtDate } from '../../lib/dates';
import { Button, EmptyState, ErrorState, SkeletonList } from '../../components/ui';
import { RecordFilters, Timeline, applyFilters, emptyFilters, type FilterState } from '../../components/records/Timeline';
import { RecordCard } from '../../components/records/RecordCard';
import { usePatientUI } from '../../components/layout/PatientShell';

export function TimelinePage() {
  useDocumentTitle(`Timeline · ${brand.name}`);
  const ui = usePatientUI();
  const [params] = useSearchParams();
  const records = useLive(() => recordService.list(), []);
  const [filters, setFilters] = useState<FilterState>(emptyFilters());
  const shown = useMemo(() => applyFilters(records.data ?? [], filters), [records.data, filters]);
  const years = records.data?.length ? `${records.data[records.data.length - 1].date.slice(0, 4)} – today` : '';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Health timeline</h1>
          <p>Everything in your record, newest first{years ? ` · ${years}` : ''}. Entries added by doctors show who added them and where.</p>
        </div>
        <div className="actions">
          <Button icon={Upload} onClick={() => ui.upload()}>Upload</Button>
          <Button variant="primary" icon={FilePlus2} onClick={() => ui.addRecord()}>Add record</Button>
        </div>
      </div>
      {records.error ? <ErrorState error={records.error} title="Unable to load medical records" onRetry={records.reload} /> : !records.data ? <SkeletonList rows={6} /> : records.data.length === 0 ? (
        <div className="card"><EmptyState icon={Clock3} title="Your timeline is empty" body="Add past visits, tests, vaccinations or surgeries. Doctors you grant access to can add entries too." action={<Button variant="primary" icon={FilePlus2} onClick={() => ui.addRecord()}>Add your first record</Button>} /></div>
      ) : (
        <>
          <RecordFilters records={records.data} value={filters} onChange={setFilters} />
          {shown.length === 0 ? (
            <div className="card"><EmptyState icon={SearchX} title="No matching entries" body="Try a different search or clear the filters." action={<Button onClick={() => setFilters(emptyFilters())}>Clear filters</Button>} /></div>
          ) : <Timeline records={shown} onOpen={ui.openRecord} highlightId={params.get('record') ?? undefined} />}
        </>
      )}
    </>
  );
}

export function RecordsPage() {
  useDocumentTitle(`Medical records · ${brand.name}`);
  const ui = usePatientUI();
  const [params, setParams] = useSearchParams();
  const narrow = useMediaQuery('(max-width: 640px)');
  const records = useLive(() => recordService.list(), []);
  const [filters, setFilters] = useState<FilterState>(() => emptyFilters({ category: params.get('category') ?? 'all', doctor: params.get('doctor') ?? '', hospital: params.get('hospital') ?? '' }));

  useEffect(() => {
    // Keep the URL in sync so a category view can be linked or refreshed.
    const next = new URLSearchParams(params);
    for (const k of ['category', 'doctor', 'hospital'] as const) {
      const v = filters[k];
      if (v && v !== 'all') next.set(k, v); else next.delete(k);
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => applyFilters(records.data ?? [], filters), [records.data, filters]);
  const counts = useMemo(() => Object.fromEntries(RECORD_CATEGORIES.map((c) => [c.key, (records.data ?? []).filter((r) => c.types.includes(r.type))])), [records.data]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Medical records</h1>
          <p>Your records by category. Each entry is structured, dated and attributed — attach reports to keep documents alongside the details.</p>
        </div>
        <div className="actions">
          <Button icon={Upload} onClick={() => ui.upload()}>Upload report</Button>
          <Button variant="primary" icon={FilePlus2} onClick={() => ui.addRecord()}>Add record</Button>
        </div>
      </div>

      {records.error ? <ErrorState error={records.error} title="Unable to load medical records" onRetry={records.reload} /> : !records.data ? <SkeletonList rows={6} /> : (
        <>
          {filters.category === 'all' && !filters.q && (
            <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {RECORD_CATEGORIES.map((c) => {
                const Icon = RECORD_ICON[c.types[0]];
                const list = counts[c.key] ?? [];
                const latest = list[0];
                return (
                  <button key={c.key} className="qa" style={{ gap: 8 }} onClick={() => setFilters({ ...filters, category: c.key })}>
                    <div className="spread" style={{ width: '100%' }}><Icon aria-hidden /><span className="num subtle">{list.length}</span></div>
                    <span>{c.label}</span>
                    <span className="xs subtle" style={{ fontWeight: 400 }}>{latest ? `Latest ${fmtDate(latest.date)}` : 'Nothing yet'}</span>
                  </button>
                );
              })}
            </div>
          )}
          <RecordFilters records={records.data} value={filters} onChange={setFilters} />
          {shown.length === 0 ? (
            <div className="card">
              {filters.category !== 'all' && !filters.q && !filters.doctor && !filters.hospital ? (
                <EmptyState icon={FolderHeart} title={`No ${RECORD_CATEGORIES.find((c) => c.key === filters.category)?.label.toLowerCase()} yet`} body="Add an entry to keep this part of your history complete."
                  action={<Button variant="primary" icon={FilePlus2} onClick={() => ui.addRecord(RECORD_CATEGORIES.find((c) => c.key === filters.category)?.types[0])}>Add entry</Button>} />
              ) : (
                <EmptyState icon={SearchX} title="No matching records" body="Try a different search or clear the filters." action={<Button onClick={() => setFilters(emptyFilters())}>Clear filters</Button>} />
              )}
            </div>
          ) : (
            <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
              <p className="xs subtle">{shown.length} {shown.length === 1 ? 'entry' : 'entries'}</p>
              {shown.map((r) => (
                <div key={r.id} className="rec-row">
                  <div className="rec-date-col">{fmtDate(r.date)}</div>
                  <div className="grow"><RecordCard record={r} onOpen={ui.openRecord} showDate={narrow} /></div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
