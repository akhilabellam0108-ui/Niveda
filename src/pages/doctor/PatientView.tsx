import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FilePlus2, ShieldOff, TriangleAlert, Activity, Pill, Clock3, ShieldCheck, Send, Siren, ArrowLeft, FileText, Lock } from 'lucide-react';
import { doctorService, documentService, recordService, emergencyReasonLabel } from '../../services';
import { AppError } from '../../services/core';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { brand } from '../../config/brand';
import { ageFrom, fmtDate, fmtDateTime, timeLeft, todayISO } from '../../lib/dates';
import { PERMISSIONS, RECORD_TYPES, isSevereAllergy, recordTitle, opt } from '../../lib/recordMeta';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, SkeletonList, Tabs } from '../../components/ui';
import { RecordFilters, Timeline, applyFilters, emptyFilters, type FilterState } from '../../components/records/Timeline';
import { RecordCard } from '../../components/records/RecordCard';
import { RecordDrawer } from '../../components/records/RecordDrawer';
import { HandoverNote } from '../../components/records/HandoverNote';
import { PreVisitBrief } from '../../components/records/PreVisitBrief';
import { buildBrief } from '../../lib/brief';
import { PermissionBadges } from '../../components/access/PermissionSelector';
import { DocumentViewer, DOC_ICON, formatBytes } from '../../components/documents/DocumentViewer';
import { useRecordParam } from '../../components/layout/PatientShell';
import { DOC_CATEGORY_LABEL } from '../../services';

import { t } from '../../i18n';
import { T } from '../../i18n/T';
type Tab = 'brief' | 'overview' | 'timeline' | 'records' | 'reports' | 'access';

/** Shown when the patient hasn't shared (or has revoked) access. Reveals nothing about the record. */
export function NoAccess({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <div className="card">
      <EmptyState icon={ShieldOff} title={t('You don’t have access to this record')} body={message}
        action={<div className="row"><Button icon={ArrowLeft} onClick={() => navigate('/doctor/patients')}>{t('My patients')}</Button><Button variant="primary" icon={Send} onClick={() => navigate('/doctor/find')}>{t('Request access')}</Button></div>} />
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
  const [tab, setTab] = useState<Tab>('brief');
  const [filters, setFilters] = useState<FilterState>(emptyFilters());
  const [viewDoc, setViewDoc] = useState<string>();
  const o = overview.data;
  useDocumentTitle(`${o?.patient.fullName ?? t('Patient')} · ${brand.name}`);

  useEffect(() => { void recordService.logHistoryView(patientId).catch(() => undefined); }, [patientId]);
  const shown = useMemo(() => applyFilters(records.data ?? [], filters), [records.data, filters]);
  const brief = useMemo(() => (records.data && o ? buildBrief(records.data, o.grant.permissions, todayISO()) : undefined), [records.data, o]);

  const denied = overview.error instanceof AppError && overview.error.code === 'ACCESS_DENIED';
  if (denied) return <><div className="page-head"><h1>{t('Patient record')}</h1></div><NoAccess message={(overview.error as AppError).message} /></>;
  if (overview.error) return <ErrorState error={overview.error} title={t('Unable to load this patient')} onRetry={overview.reload} />;
  if (!o) return <SkeletonList rows={6} />;

  const g = o.grant;
  const low = new Date(g.expiresAt).getTime() - Date.now() < 24 * 3600000;
  const hidden = PERMISSIONS.filter((p) => !g.permissions.includes(p.key));
  const severe = o.allergies.filter(isSevereAllergy);

  return (
    <>
      {g.method === 'emergency' && (
        <div className="alert alert-danger" role="status">
          <Siren aria-hidden />
          <div><strong>{t('Emergency access')}</strong> — {t('{reason}. Ends {date} ({left}). The patient has been told, and everything you open or add is logged and reviewed by the Niveda team.', { reason: emergencyReasonLabel(g.verification.reason), date: fmtDateTime(g.expiresAt), left: timeLeft(g.expiresAt) })}</div>
        </div>
      )}
      <section className="card patient-banner">
        <Avatar name={o.patient.fullName} src={o.patient.photoDataUrl} size="lg" />
        <div className="grow" style={{ minWidth: 220 }}>
          <h1 style={{ fontSize: 'var(--t-xl)' }}>{o.patient.fullName}</h1>
          <div className="facts">
            <span><T text="{n} yrs" n={<b>{ageFrom(o.patient.dateOfBirth)}</b>} />{o.patient.sex ? `, ${t(o.patient.sex)}` : ''}</span>
            <span>{t('Blood')}{' '}<b>{o.patient.bloodGroup ?? '—'}</b></span>
            <span>{t('ID')} <b className="num">{o.patient.patientCode}</b></span>
            <span>{t('DOB {date}', { date: fmtDate(o.patient.dateOfBirth) })}</span>
          </div>
        </div>
        <div className="stack" style={{ '--gap': '8px', alignItems: 'flex-end' } as React.CSSProperties}>
          <span className={`access-chip ${low ? 'low' : ''}`}><ShieldCheck aria-hidden />{t('Access ·')}{' '}{timeLeft(g.expiresAt)}</span>
          <Button variant="primary" size="lg" icon={FilePlus2} onClick={() => navigate(`/doctor/patients/${patientId}/add`)}>{t('Add to medical record')}</Button>
        </div>
      </section>

      {(severe.length > 0 || o.patient.importantNotes) && (
        <div className="alert alert-danger" role="alert">
          <Siren aria-hidden />
          <div>
            {severe.length > 0 && <div className="alert-title">{severe.map((a) => `${String(a.data.allergen).toUpperCase()} — ${opt(a.data.severity)}`).join(' · ')}</div>}
            {o.patient.importantNotes && <div>{o.patient.importantNotes}</div>}
          </div>
        </div>
      )}

      {o.handover && <HandoverNote record={o.handover} onOpen={open} />}

      <Tabs label={t('Patient record')} value={tab} onChange={setTab} tabs={[
        { value: 'brief', label: t('Brief') }, { value: 'overview', label: t('Summary') }, { value: 'timeline', label: t('Timeline') }, { value: 'records', label: t('Records'), count: records.data?.length },
        { value: 'reports', label: t('Reports'), count: docs.data?.length }, { value: 'access', label: t('Access') },
      ]} />

      {tab === 'brief' && (records.error ? <ErrorState error={records.error} onRetry={records.reload} /> : !brief ? <SkeletonList rows={6} /> : (
        <PreVisitBrief brief={brief} permissions={g.permissions} patient={o.patient} onOpen={open} />
      ))}

      {tab === 'overview' && (
        <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <SummaryCard title={t('Allergies')} icon={TriangleAlert} tone="tone-danger" empty={g.permissions.includes('allergies') ? (o.patient.declarations?.noAllergies ? t('No known allergies — confirmed by patient {value}', { value: fmtDate(o.patient.declarations.confirmedAt) }) : t('None recorded')) : t('Not shared with you')}
            items={o.allergies.map((a) => ({ id: a.id, main: String(a.data.allergen), sub: `${a.data.reaction} · ${opt(a.data.severity)}`, danger: isSevereAllergy(a) }))} onOpen={open} />
          <SummaryCard title={t('Important conditions')} icon={Activity} tone="tone-violet" empty={g.permissions.includes('history') ? (o.patient.declarations?.noConditions ? t('No ongoing conditions — confirmed by patient') : t('None recorded')) : t('Not shared with you')}
            items={o.conditions.map((c) => ({ id: c.id, main: String(c.data.condition), sub: t('{status} · since {value}', { status: opt(c.data.status), value: fmtDate(c.date) }) }))} onOpen={open} />
          <SummaryCard title={t('Current medications')} icon={Pill} tone="tone-info" empty={g.permissions.includes('medications') ? (o.patient.declarations?.noMedications ? t('Takes no regular medicines — confirmed by patient') : t('None')) : t('Not shared with you')}
            items={o.activeMedications.map((m) => ({ id: m.id, main: `${m.data.name} ${m.data.dosage}`, sub: `${opt(m.data.frequency)}${m.data.prescriber ? ` · ${m.data.prescriber}` : ''}` }))} onOpen={open} />
          <Card title={t('Recent history')} action={<button className="card-link btn btn-ghost btn-sm" onClick={() => setTab('timeline')}>{t('Timeline')}</button>}>
            {!records.data ? <SkeletonList rows={3} card={false} /> : (
              <ul className="list">
                {records.data.filter((r) => !r.parentId).slice(0, 6).map((r) => (
                  <li key={r.id}><button className="list-item clickable" onClick={() => open(r.id)}><span className="xs subtle num" style={{ width: 78 }}>{fmtDate(r.date)}</span><span className="grow small truncate"><span className="muted">{t(RECORD_TYPES[r.type].label)} · </span><b>{recordTitle(r)}</b></span></button></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'timeline' && (records.error ? <ErrorState error={records.error} onRetry={records.reload} /> : !records.data ? <SkeletonList rows={5} /> : (
        <>
          <RecordFilters records={records.data} value={filters} onChange={setFilters} />
          {shown.length ? <Timeline records={shown} onOpen={open} highlightId={recordId} viewerIsPatient={false} /> : <div className="card"><EmptyState icon={Clock3} title={t('No matching entries')} /></div>}
        </>
      ))}

      {tab === 'records' && (!records.data ? <SkeletonList rows={5} /> : (
        <>
          <RecordFilters records={records.data} value={filters} onChange={setFilters} />
          <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            {shown.map((r) => <div key={r.id} className="rec-row"><div className="rec-date-col">{fmtDate(r.date)}</div><div className="grow"><RecordCard record={r} onOpen={open} viewerIsPatient={false} /></div></div>)}
            {!shown.length && <div className="card"><EmptyState icon={Clock3} title={t('No matching records')} /></div>}
          </div>
        </>
      ))}

      {tab === 'reports' && (docs.error ? <ErrorState error={docs.error} onRetry={docs.reload} /> : !docs.data ? <SkeletonList rows={3} /> : docs.data.length === 0 ? (
        <div className="card"><EmptyState icon={FileText} title={t('No documents shared')} body={t('Either the patient hasn’t uploaded any, or they belong to parts of the record you can’t see.')} /></div>
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
        <Card title={t('Your access to this record')} pad>
          <div className="stack">
            <dl className="kv">
              <dt>{t('Granted by')}</dt><dd>{t('{name} (the patient)', { name: o.grantedBy })}</dd>
              <dt>{t('Granted')}</dt><dd>{fmtDateTime(g.grantedAt)}</dd>
              <dt>{t('Verified')}</dt><dd>{t('Patient one-time code ·')}{' '}{fmtDateTime(g.verification.verifiedAt)}</dd>
              <dt>{t('Expires')}</dt><dd>{fmtDateTime(g.expiresAt)} · {timeLeft(g.expiresAt)}</dd>
            </dl>
            <div><div className="xs subtle strong" style={{ marginBottom: 6 }}>{t('YOU CAN SEE AND ADD TO')}</div><PermissionBadges value={g.permissions} /></div>
            {hidden.length > 0 && <div className="alert alert-info"><Lock aria-hidden /><div>{t('Not shared with you: {parts}. These entries are hidden completely.', { parts: hidden.map((h) => t(h.label)).join(', ') })}</div></div>}
            <p className="xs subtle">{t('Opening this record, each entry and each document is logged and visible to the patient.')}</p>
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

