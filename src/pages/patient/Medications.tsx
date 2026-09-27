import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Plus, Ban, History, TriangleAlert, UserRound, CalendarDays } from 'lucide-react';
import type { MedicalRecord } from '../../types';
import { isMedicationActive, recordService } from '../../services';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { brand } from '../../config/brand';
import { fmtDate } from '../../lib/dates';
import { ALLERGY_SEVERITY_RANK, isSevereAllergy } from '../../lib/recordMeta';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, SkeletonList, Tabs } from '../../components/ui';
import { StatusBadge, TypeIcon } from '../../components/records/RecordCard';
import { usePatientUI } from '../../components/layout/PatientShell';

export function MedicationsPage() {
  useDocumentTitle(`Medications · ${brand.name}`);
  const ui = usePatientUI();
  const toast = useToast();
  const records = useLive(() => recordService.list(), []);
  const [tab, setTab] = useState<'current' | 'past'>('current');
  const [stop, setStop] = useState<MedicalRecord>();
  const [reason, setReason] = useState('');
  const meds = useMemo(() => (records.data ?? []).filter((r) => r.type === 'medication'), [records.data]);
  const current = meds.filter((m) => isMedicationActive(m));
  const past = meds.filter((m) => !isMedicationActive(m));
  const list = tab === 'current' ? current : past;

  return (
    <>
      <div className="page-head">
        <div><h1>Medications</h1><p>What you take now and everything you’ve taken before. Prescriptions from your doctors appear here automatically.</p></div>
        <Button variant="primary" icon={Plus} onClick={() => ui.addRecord('medication')}>Add medication</Button>
      </div>
      <Tabs label="Medication lists" value={tab} onChange={setTab} tabs={[{ value: 'current', label: 'Current', count: current.length }, { value: 'past', label: 'Previous', count: past.length }]} />
      {records.error ? <ErrorState error={records.error} onRetry={records.reload} /> : !records.data ? <SkeletonList rows={3} /> : list.length === 0 ? (
        <div className="card">
          {tab === 'current'
            ? <EmptyState icon={Pill} title="No medications recorded yet" body="Add your first medication to keep your treatment history up to date." action={<Button variant="primary" icon={Plus} onClick={() => ui.addRecord('medication')}>Add medication</Button>} />
            : <EmptyState icon={History} title="No previous medications" body="Medicines you stop or finish will move here, with their full history." />}
        </div>
      ) : (
        <div className="card">
          {list.map((m) => (
            <div key={m.id} className="med-card">
              <TypeIcon type="medication" />
              <div className="grow stack" style={{ '--gap': '6px', minWidth: 0 } as React.CSSProperties}>
                <div className="row-wrap">
                  <button className="rec-open" style={{ fontSize: 'var(--t-md)' }} onClick={() => ui.openRecord(m.id)}>{String(m.data.name)}</button>
                  <span className="med-dose muted">{String(m.data.dosage)}</span>
                  <StatusBadge record={m} />
                  {m.version > 1 && <Badge icon={History}>v{m.version}</Badge>}
                </div>
                <div className="small">{String(m.data.frequency)}{m.data.reason ? ` · for ${String(m.data.reason)}` : ''}</div>
                {m.data.instructions && <div className="small muted">{String(m.data.instructions)}</div>}
                <div className="rec-meta">
                  <span><CalendarDays aria-hidden />{fmtDate(m.date)} → {m.data.discontinuedOn ? `stopped ${fmtDate(String(m.data.discontinuedOn))}` : m.data.endDate ? fmtDate(String(m.data.endDate)) : 'ongoing'}</span>
                  <span><UserRound aria-hidden />{m.data.prescriber ? String(m.data.prescriber) : m.createdBy.role === 'patient' ? 'Added by you' : m.createdBy.name}</span>
                </div>
              </div>
              <div className="med-actions">
                <Button size="sm" variant="ghost" icon={History} onClick={() => ui.openRecord(m.id)}><span className="desktop-only">History</span></Button>
                {isMedicationActive(m) && <Button size="sm" icon={Ban} onClick={() => { setReason(''); setStop(m); }}><span className="desktop-only">Stop</span></Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!stop} onClose={() => setStop(undefined)} danger confirmLabel="Stop medication" title={`Stop ${stop ? String(stop.data.name) : ''}?`}
        body="It moves to your previous medications and the change is added to your timeline. Talk to your doctor before stopping prescribed medicines."
        onConfirm={async () => { await recordService.discontinueMedication(stop!.id, reason); toast('Medication stopped'); }}>
        <Field label="Reason (optional)">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Course completed" />}</Field>
      </ConfirmDialog>
    </>
  );
}

export function AllergiesPage() {
  useDocumentTitle(`Allergies · ${brand.name}`);
  const ui = usePatientUI();
  const records = useLive(() => recordService.list(), []);
  const allergies = useMemo(() => (records.data ?? []).filter((r) => r.type === 'allergy').sort((a, b) => (ALLERGY_SEVERITY_RANK[String(b.data.severity)] ?? 0) - (ALLERGY_SEVERITY_RANK[String(a.data.severity)] ?? 0)), [records.data]);
  const severe = allergies.filter(isSevereAllergy);
  return (
    <>
      <div className="page-head">
        <div><h1>Allergies</h1><p>Shown at the top of your record for every doctor with access, and on your <Link to="/app/emergency">emergency card</Link>.</p></div>
        <Button variant="primary" icon={Plus} onClick={() => ui.addRecord('allergy')}>Add allergy</Button>
      </div>
      {records.error ? <ErrorState error={records.error} onRetry={records.reload} /> : !records.data ? <SkeletonList rows={3} /> : allergies.length === 0 ? (
        <div className="card"><EmptyState icon={TriangleAlert} title="No allergies recorded" body="If you have any allergies — to medicines, foods or anything else — add them so doctors always see them." action={<Button variant="primary" icon={Plus} onClick={() => ui.addRecord('allergy')}>Add allergy</Button>} /></div>
      ) : (
        <>
          {severe.length > 0 && (
            <div className="alert alert-danger" role="alert">
              <TriangleAlert aria-hidden />
              <div><div className="alert-title">{severe.length} severe {severe.length === 1 ? 'allergy' : 'allergies'}</div>{severe.map((a) => `${a.data.allergen} (${a.data.reaction})`).join(' · ')}</div>
            </div>
          )}
          <Card>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Allergen</th><th>Reaction</th><th>Severity</th><th>Identified</th><th className="desktop-only">Notes</th></tr></thead>
                <tbody>
                  {allergies.map((a) => (
                    <tr key={a.id}>
                      <td><button className="rec-open" onClick={() => ui.openRecord(a.id)}>{String(a.data.allergen)}</button></td>
                      <td>{String(a.data.reaction ?? '—')}</td>
                      <td><StatusBadge record={a} /></td>
                      <td className="nowrap num">{fmtDate(a.date)}</td>
                      <td className="desktop-only muted">{String(a.data.notes ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
