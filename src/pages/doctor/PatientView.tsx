import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FilePlus2, ShieldOff, TriangleAlert, Activity, Pill, Clock3, ShieldCheck, Send, Siren, ArrowLeft, FileText, Lock } from 'lucide-react';
import { doctorService, documentService, recordService } from '../../services';
import { AppError } from '../../services/core';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { brand } from '../../config/brand';
import { ageFrom, fmtDate, fmtDateTime, timeLeft } from '../../lib/dates';
import { PERMISSIONS, RECORD_TYPES, isSevereAllergy, recordTitle } from '../../lib/recordMeta';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, SkeletonList, Tabs } from '../../components/ui';
import { RecordFilters, Timeline, applyFilters, emptyFilters, type FilterState } from '../../components/records/Timeline';
import { RecordCard } from '../../components/records/RecordCard';
import { RecordDrawer } from '../../components/records/RecordDrawer';
import { PermissionBadges } from '../../components/access/PermissionSelector';
import { DocumentViewer, DOC_ICON, formatBytes } from '../../components/documents/DocumentViewer';
import { useRecordParam } from '../../components/layout/PatientShell';
import { DOC_CATEGORY_LABEL } from '../../services';

type Tab = 'overview' | 'timeline' | 'records' | 'reports' | 'access';

/** Shown when the patient hasn't shared (or has revoked) access. Reveals nothing about the record. */
export function NoAccess({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <div className="card">
      <EmptyState icon={ShieldOff} title="You don’t have access to this record" body={message}
        action={<div className="row"><Button icon={ArrowLeft} onClick={() => navigate('/doctor/patients')}>My patients</Button><Button variant="primary" icon={Send} onClick={() => navigate('/doctor/find')}>Request access</Button></div>} />
    </div>
  );
}

export function PatientView() {
  const { patientId = '' } = useParams();
  const navigate = useNavigate();
  const overview = useLive(() => doctorService.patientOverview(patientId), [patientId]);
  const records = useLive(() => recordService.list(patientId), [patientId]);
  const docs = useLive(() => documentService.list(patientId), [patientId]);
  const { recordId, open, close } = useRecordParam();
  const [tab, setTab] = useState<Tab>('overview');
  const [filters, setFilters] = useState<FilterState>(emptyFilters());
  const [viewDoc, setViewDoc] = useState<string>();
  const o = overview.data;
  useDocumentTitle(`${o?.patient.fullName ?? 'Patient'} · ${brand.name}`);

  useEffect(() => { void recordService.logHistoryView(patientId).catch(() => undefined); }, [patientId]);
  const shown = useMemo(() => applyFilters(records.data ?? [], filters), [records.data, filters]);

  const denied = overview.error instanceof AppError && overview.error.code === 'ACCESS_DENIED';
  if (denied) return <><div className="page-head"><h1>Patient record</h1></div><NoAccess message={(overview.error as AppError).message} /></>;
  if (overview.error) return <ErrorState error={overview.error} title="Unable to load this patient" onRetry={overview.reload} />;
  if (!o) return <SkeletonList rows={6} />;

  const g = o.grant;
  const low = new Date(g.expiresAt).getTime() - Date.now() < 24 * 3600000;
  const hidden = PERMISSIONS.filter((p) => !g.permissions.includes(p.key));
  const severe = o.allergies.filter(isSevereAllergy);

  return (
    <>
      <section className="card patient-banner">
        <Avatar name={o.patient.fullName} src={o.patient.photoDataUrl} size="lg" />
        <div className="grow" style={{ minWidth: 220 }}>
          <h1 style={{ fontSize: 'var(--t-xl)' }}>{o.patient.fullName}</h1>
          <div className="facts">
            <span><b>{ageFrom(o.patient.dateOfBirth)}</b> yrs{o.patient.sex ? `, ${o.patient.sex}` : ''}</span>
            <span>Blood <b>{o.patient.bloodGroup ?? '—'}</b></span>
            <span>ID <b className="num">{o.patient.patientCode}</b></span>
            <span>DOB {fmtDate(o.patient.dateOfBirth)}</span>
          </div>
        </div>
        <div className="stack" style={{ '--gap': '8px', alignItems: 'flex-end' } as React.CSSProperties}>
          <span className={`access-chip ${low ? 'low' : ''}`}><ShieldCheck aria-hidden />Access · {timeLeft(g.expiresAt)}</span>
          <Button variant="primary" size="lg" icon={FilePlus2} onClick={() => navigate(`/doctor/patients/${patientId}/add`)}>Add to medical record</Button>
        </div>
      </section>

      {(severe.length > 0 || o.patient.importantNotes) && (
        <div className="alert alert-danger" role="alert">
          <Siren aria-hidden />
          <div>
            {severe.length > 0 && <div className="alert-title">{severe.map((a) => `${String(a.data.allergen).toUpperCase()} — ${a.data.severity}`).join(' · ')}</div>}
            {o.patient.importantNotes && <div>{o.patient.importantNotes}</div>}
          </div>
        </div>
      )}

      <Tabs label="Patient record" value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Summary' }, { value: 'timeline', label: 'Timeline' }, { value: 'records', label: 'Records', count: records.data?.length },
        { value: 'reports', label: 'Reports', count: docs.data?.length }, { value: 'access', label: 'Access' },
      ]} />

      {tab === 'overview' && (
        <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <SummaryCard title="Allergies" icon={TriangleAlert} tone="tone-danger" empty={g.permissions.includes('allergies') ? 'No known allergies' : 'Not shared with you'}
            items={o.allergies.map((a) => ({ id: a.id, main: String(a.data.allergen), sub: `${a.data.reaction} · ${a.data.severity}`, danger: isSevereAllergy(a) }))} onOpen={open} />
          <SummaryCard title="Important conditions" icon={Activity} tone="tone-violet" empty={g.permissions.includes('history') ? 'None recorded' : 'Not shared with you'}
            items={o.conditions.map((c) => ({ id: c.id, main: String(c.data.condition), sub: `${c.data.status} · since ${fmtDate(c.date)}` }))} onOpen={open} />
          <SummaryCard title="Current medications" icon={Pill} tone="tone-info" empty={g.permissions.includes('medications') ? 'None' : 'Not shared with you'}
            items={o.activeMedications.map((m) => ({ id: m.id, main: `${m.data.name} ${m.data.dosage}`, sub: `${m.data.frequency}${m.data.prescriber ? ` · ${m.data.prescriber}` : ''}` }))} onOpen={open} />
          <Card title="Recent history" action={<button className="card-link btn btn-ghost btn-sm" onClick={() => setTab('timeline')}>Timeline</button>}>
            {!records.data ? <SkeletonList rows={3} card={false} /> : (
              <ul className="list">
                {records.data.filter((r) => !r.parentId).slice(0, 6).map((r) => (
                  <li key={r.id}><button className="list-item clickable" onClick={() => open(r.id)}><span className="xs subtle num" style={{ width: 78 }}>{fmtDate(r.date)}</span><span className="grow small truncate"><span className="muted">{RECORD_TYPES[r.type].label} · </span><b>{recordTitle(r)}</b></span></button></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'timeline' && (records.error ? <ErrorState error={records.error} onRetry={records.reload} /> : !records.data ? <SkeletonList rows={5} /> : (
        <>
          <RecordFilters records={records.data} value={filters} onChange={setFilters} />
          {shown.length ? <Timeline records={shown} onOpen={open} highlightId={recordId} viewerIsPatient={false} /> : <div className="card"><EmptyState icon={Clock3} title="No matching entries" /></div>}
        </>
      ))}

      {tab === 'records' && (!records.data ? <SkeletonList rows={5} /> : (
        <>
          <RecordFilters records={records.data} value={filters} onChange={setFilters} />
          <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            {shown.map((r) => <div key={r.id} className="rec-row"><div className="rec-date-col">{fmtDate(r.date)}</div><div className="grow"><RecordCard record={r} onOpen={open} viewerIsPatient={false} /></div></div>)}
            {!shown.length && <div className="card"><EmptyState icon={Clock3} title="No matching records" /></div>}
          </div>
        </>
      ))}

      {tab === 'reports' && (docs.error ? <ErrorState error={docs.error} onRetry={docs.reload} /> : !docs.data ? <SkeletonList rows={3} /> : docs.data.length === 0 ? (
        <div className="card"><EmptyState icon={FileText} title="No documents shared" body="Either the patient hasn’t uploaded any, or they belong to parts of the record you can’t see." /></div>
      ) : (
        <div className="doc-grid">
          {docs.data.map((d) => {
            const Icon = DOC_ICON[d.category];
            return (
              <button key={d.id} className="doc-card" onClick={() => setViewDoc(d.id)}>
                <div className="doc-thumb"><Icon aria-hidden /></div>
                <div className="strong small truncate">{d.name}</div>
                <div className="row-wrap"><Badge>{DOC_CATEGORY_LABEL[d.category]}</Badge><span className="xs subtle">{fmtDate(d.date)} · {formatBytes(d.size)}</span></div>
                {d.recordLabel && <div className="xs muted truncate">{d.recordLabel}</div>}
              </button>
            );
          })}
        </div>
      ))}

      {tab === 'access' && (
        <Card title="Your access to this record" pad>
          <div className="stack">
            <dl className="kv">
              <dt>Granted by</dt><dd>{o.grantedBy} (the patient)</dd>
              <dt>Granted</dt><dd>{fmtDateTime(g.grantedAt)}</dd>
              <dt>Verified</dt><dd>Patient one-time code · {fmtDateTime(g.verification.verifiedAt)}</dd>
              <dt>Expires</dt><dd>{fmtDateTime(g.expiresAt)} · {timeLeft(g.expiresAt)}</dd>
            </dl>
            <div><div className="xs subtle strong" style={{ marginBottom: 6 }}>YOU CAN SEE AND ADD TO</div><PermissionBadges value={g.permissions} /></div>
            {hidden.length > 0 && <div className="alert alert-info"><Lock aria-hidden /><div>Not shared with you: {hidden.map((h) => h.label).join(', ')}. These entries are hidden completely.</div></div>}
            <p className="xs subtle">Opening this record, each entry and each document is logged and visible to the patient.</p>
          </div>
        </Card>
      )}

      <RecordDrawer recordId={recordId} onClose={close} onOpenRecord={open} viewer="doctor" />
      <DocumentViewer docId={viewDoc} onClose={() => setViewDoc(undefined)} />
    </>
  );
}

function SummaryCard({ title, icon: Icon, tone, items, empty, onOpen }: { title: string; icon: typeof Pill; tone: string; items: { id: string; main: string; sub: string; danger?: boolean }[]; empty: string; onOpen: (id: string) => void }) {
  return (
    <Card title={<span className="row" style={{ '--gap': '8px' } as React.CSSProperties}><span className={`type-icon sm ${tone}`}><Icon aria-hidden /></span>{title}</span>}>
      {items.length === 0 ? <p className="small subtle" style={{ padding: 20 }}>{empty}</p> : (
        <ul className="list">
          {items.map((i) => (
            <li key={i.id}><button className="list-item clickable" onClick={() => onOpen(i.id)}>
              <span className="grow" style={{ minWidth: 0 }}><span className="strong small" style={{ display: 'block', color: i.danger ? 'var(--danger)' : undefined }}>{i.main}</span><span className="xs muted">{i.sub}</span></span>
            </button></li>
          ))}
        </ul>
      )}
    </Card>
  );
}

