import { useEffect, useState } from 'react';
import { Lock, PencilLine, Ban, FlaskConical, History, Building2, CornerDownRight } from 'lucide-react';
import type { MedicalRecord, RecordData, RecordVersion } from '@shared/types';
import { RECORD_TYPES, fieldLabel, recordTitle, validateData, INTERNAL_KEYS } from '@shared/recordMeta';
import { fmtDate, fmtDateTime, fmtLongDate, todayISO } from '@shared/dates';
import { documentService, isMedicationActive, recordService, friendlyError, type DocumentView, type NewFile } from '../../services';
import { useLive } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { Avatar, Badge, Button, ConfirmDialog, Drawer, ErrorState, Field, InlineError, Input, Modal, Skeleton, Textarea } from '../ui';
import { DocumentViewer, DOC_ICON } from '../documents/DocumentViewer';
import { FilePicker, RecordFields, DATE_LABEL } from './RecordForm';
import { StatusBadge, TypeIcon } from './RecordCard';

interface Props {
  recordId?: string;
  onClose: () => void;
  onOpenRecord: (id: string) => void;
  viewer: 'patient' | 'doctor';
}

export function RecordDrawer({ recordId, onClose, onOpenRecord, viewer }: Props) {
  const live = useLive(() => (recordId ? recordService.get(recordId) : Promise.resolve(undefined)), [recordId]);
  const rec = live.data?.record;
  const docs = useLive(() => (rec ? documentService.list(rec.patientId) : Promise.resolve([] as DocumentView[])), [rec?.id, rec?.attachments.length]);
  const [viewDoc, setViewDoc] = useState<string>();
  const [dialog, setDialog] = useState<'amend' | 'stop' | 'result'>();
  const [stopReason, setStopReason] = useState('');
  const toast = useToast();

  useEffect(() => { setDialog(undefined); setViewDoc(undefined); }, [recordId]);

  const canAmend = rec && (viewer === 'doctor' || rec.createdBy.role === 'patient');
  const canStop = rec && isMedicationActive(rec);
  const canAddResult = rec && rec.type === 'lab_test' && rec.data.status !== 'Completed' && rec.data.status !== 'Cancelled';
  const attachments = (docs.data ?? []).filter((d) => rec?.attachments.includes(d.id));

  return (
    <>
      <Drawer
        open={!!recordId} onClose={onClose} label="Record details"
        header={rec ? (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <TypeIcon type={rec.type} />
            <div className="grow">
              <div className="rec-top"><span className="rec-type">{RECORD_TYPES[rec.type].label}</span><StatusBadge record={rec} /></div>
              <h2 style={{ fontSize: 'var(--t-lg)', marginTop: 2 }}>{recordTitle(rec)}</h2>
              <div className="small muted">{DATE_LABEL[rec.type] ?? 'Date'}: {fmtLongDate(rec.date)}</div>
            </div>
          </div>
        ) : <Skeleton w="60%" h={22} />}
        footer={rec && (canAmend || canStop || canAddResult) ? (
          <>
            {canAddResult && <Button variant="primary" icon={FlaskConical} onClick={() => setDialog('result')}>Add result</Button>}
            {canStop && <Button icon={Ban} onClick={() => { setStopReason(''); setDialog('stop'); }}>Stop medication</Button>}
            {canAmend && <Button icon={PencilLine} onClick={() => setDialog('amend')}>Correct this entry</Button>}
          </>
        ) : undefined}
      >
        {live.error ? <ErrorState error={live.error} title="Unable to open this record" onRetry={live.reload} /> : !rec ? (
          <div className="stack"><Skeleton h={56} /><Skeleton h={160} /><Skeleton h={80} /></div>
        ) : (
          <>
            <div className="attribution">
              <Avatar name={rec.createdBy.name} size="sm" doctor={rec.createdBy.role === 'doctor'} />
              <div className="grow">
                <div className="strong">Added by {rec.createdBy.role === 'patient' && viewer === 'patient' ? 'you' : rec.createdBy.name}</div>
                <div className="xs muted">
                  {rec.organization?.name && <><Building2 size={12} aria-hidden style={{ verticalAlign: -2 }} /> {rec.organization.name} · </>}
                  {fmtDateTime(rec.createdAt)}
                </div>
              </div>
              <span className="lock" title="Who added an entry can’t be edited or removed"><Lock aria-hidden />Permanent</span>
            </div>

            {rec.version > 1 && <LatestChange v={rec.versions[rec.versions.length - 1]} />}

            <section className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
              <h3 className="small subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 11 }}>Details</h3>
              <Details record={rec} />
            </section>

            {live.data?.parent && (
              <section className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                <h3 className="small subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 11 }}>Part of</h3>
                <LinkedRow r={live.data.parent} onOpen={onOpenRecord} />
              </section>
            )}
            {!!live.data?.children.length && (
              <section className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                <h3 className="small subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 11 }}>Linked entries</h3>
                {live.data.children.map((c) => <LinkedRow key={c.id} r={c} onOpen={onOpenRecord} />)}
              </section>
            )}

            <section className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
              <h3 className="small subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 11 }}>Attachments</h3>
              {rec.attachments.length === 0 ? <p className="small subtle">No attachments.</p> : attachments.length === 0 && docs.loading ? <Skeleton h={40} /> : attachments.map((d) => {
                const Icon = DOC_ICON[d.category];
                return (
                  <button key={d.id} className="file-row clickable" style={{ background: 'var(--surface)', cursor: 'pointer', textAlign: 'left' }} onClick={() => setViewDoc(d.id)}>
                    <Icon aria-hidden /><span className="grow truncate">{d.name}</span><span className="xs subtle">{fmtDate(d.date)}</span>
                  </button>
                );
              })}
              {rec.attachments.length > attachments.length && !docs.loading && <p className="xs subtle">{rec.attachments.length - attachments.length} attachment(s) not shared with you.</p>}
            </section>

            <section className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
              <h3 className="small subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 11 }}>History</h3>
              <VersionHistory record={rec} />
            </section>
          </>
        )}
      </Drawer>

      <DocumentViewer docId={viewDoc} onClose={() => setViewDoc(undefined)} />

      {rec && (
        <>
          <AmendDialog open={dialog === 'amend'} record={rec} onClose={() => setDialog(undefined)} onDone={() => { setDialog(undefined); toast('Correction saved. The original is kept in the history.'); }} />
          <ConfirmDialog
            open={dialog === 'stop'} onClose={() => setDialog(undefined)} title={`Stop ${recordTitle(rec)}?`} confirmLabel="Stop medication" danger
            body="It will move to your past medications. Its full history stays in your record."
            onConfirm={async () => { await recordService.discontinueMedication(rec.id, stopReason); toast('Medication stopped'); }}
          >
            <Field label="Reason (optional)">{(p) => <Input {...p} value={stopReason} onChange={(e) => setStopReason(e.target.value)} placeholder="e.g. Course finished, side effects" />}</Field>
          </ConfirmDialog>
          <LabResultDialog open={dialog === 'result'} order={rec} onClose={() => setDialog(undefined)} onDone={(id) => { setDialog(undefined); toast('Result added'); onOpenRecord(id); }} />
        </>
      )}
    </>
  );
}

function LinkedRow({ r, onOpen }: { r: MedicalRecord; onOpen: (id: string) => void }) {
  return (
    <button className="file-row" style={{ background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => onOpen(r.id)}>
      <CornerDownRight aria-hidden />
      <span className="xs subtle" style={{ width: 90, flex: 'none' }}>{RECORD_TYPES[r.type].label}</span>
      <span className="grow truncate strong">{recordTitle(r)}</span>
      <StatusBadge record={r} />
    </button>
  );
}

function visibleEntries(r: MedicalRecord, data: RecordData) {
  const meta = RECORD_TYPES[r.type];
  const out: [string, string][] = [];
  for (const f of meta.fields) {
    const v = data[f.key];
    if (v === undefined || v === '') continue;
    out.push([f.label, f.kind === 'date' ? fmtDate(String(v)) : String(v)]);
  }
  return out;
}

function Details({ record }: { record: MedicalRecord }) {
  const rows = visibleEntries(record, record.data);
  if (record.data.discontinuedOn) rows.push(['Stopped on', fmtDate(String(record.data.discontinuedOn))]);
  if (record.data.discontinueReason) rows.push(['Reason stopped', String(record.data.discontinueReason)]);
  if (!rows.length) return <p className="small subtle">No further details.</p>;
  return (
    <dl className="kv">
      {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

function LatestChange({ v }: { v: RecordVersion }) {
  const label = v.changeType === 'amended' ? 'Corrected' : v.changeType === 'discontinued' ? 'Stopped' : v.changeType === 'result_added' ? 'Result added' : 'Updated';
  return (
    <div className="alert alert-info">
      <History aria-hidden />
      <div>
        <div className="alert-title">{label} by {v.changedBy.name} · {fmtDateTime(v.changedAt)}</div>
        {v.reason && <div>Reason: {v.reason}</div>}
      </div>
    </div>
  );
}

function VersionHistory({ record }: { record: MedicalRecord }) {
  const versions = [...record.versions].reverse();
  return (
    <ol className="versions">
      {versions.map((v, i) => {
        const prev = record.versions.find((x) => x.version === v.version - 1);
        const changes = prev ? diffData(record, prev, v) : [];
        return (
          <li key={v.version} className={`version ${i === 0 ? 'current' : ''}`}>
            <div className="spread">
              <div className="small">
                <span className="strong">v{v.version} · {v.changeType === 'created' ? 'Created' : v.changeType === 'amended' ? 'Correction' : v.changeType === 'discontinued' ? 'Stopped' : v.changeType === 'result_added' ? 'Result added' : 'Updated'}</span>
                <span className="muted"> by {v.changedBy.name}{v.changedBy.organization ? `, ${v.changedBy.organization}` : ''}</span>
              </div>
              {i === 0 && <Badge tone="accent">Current</Badge>}
            </div>
            <div className="xs subtle num">{fmtDateTime(v.changedAt)}</div>
            {v.reason && v.changeType !== 'created' && <div className="small" style={{ marginTop: 6 }}>Reason: {v.reason}</div>}
            {changes.length > 0 && (
              <div className="diff">
                {changes.map(([k, a, b]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <span className="subtle">{k}</span>
                    <span>{a && <del>{a}</del>}{a && b && ' → '}{b && <ins>{b}</ins>}</span>
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function diffData(r: MedicalRecord, a: RecordVersion, b: RecordVersion): [string, string, string][] {
  const out: [string, string, string][] = [];
  if (a.date !== b.date) out.push(['Date', fmtDate(a.date), fmtDate(b.date)]);
  const keys = new Set([...Object.keys(a.data), ...Object.keys(b.data)]);
  for (const k of keys) {
    if (INTERNAL_KEYS.has(k)) continue;
    const x = a.data[k] === undefined ? '' : String(a.data[k]);
    const y = b.data[k] === undefined ? '' : String(b.data[k]);
    if (x !== y) out.push([fieldLabel(r.type, k), x, y]);
  }
  return out;
}

/* ---------------- Amend ---------------- */

function AmendDialog({ open, record, onClose, onDone }: { open: boolean; record: MedicalRecord; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(record.date);
  const [data, setData] = useState<RecordData>(record.data);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (open) { setDate(record.date); setData(record.data); setReason(''); setErrors({}); setErr(undefined); setConfirm(false); }
  }, [open, record]);

  const review = () => {
    const v = validateData(record.type, data);
    if (!reason.trim()) v.reason = 'Say why this needs correcting';
    setErrors(v);
    if (!Object.keys(v).length) setConfirm(true);
  };

  return (
    <>
      <Modal open={open && !confirm} onClose={onClose} size="lg" title="Correct this entry"
        description="Corrections never overwrite the original. Both versions stay in the record with your name, the time and your reason."
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={review}>Review correction</Button></>}>
        <div className="stack" style={{ '--gap': '20px' } as React.CSSProperties}>
          <RecordFields type={record.type} date={date} onDate={setDate} data={data} onChange={setData} errors={errors} />
          <Field label="Reason for correction" required error={errors.reason}>
            {(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Dosage was entered incorrectly" />}
          </Field>
          <InlineError message={err} />
        </div>
      </Modal>
      <ConfirmDialog
        open={open && confirm} onClose={() => setConfirm(false)} title="Save this correction?" confirmLabel="Save correction"
        body={<>A new version (v{record.version + 1}) will be added. The current version stays visible in the history, and the change is recorded in the access log.</>}
        onConfirm={async () => {
          try {
            await recordService.amend(record.id, { date, data, reason });
            onDone();
          } catch (e) {
            setErr(friendlyError(e));
            setConfirm(false);
            throw e;
          }
        }}
      />
    </>
  );
}

/* ---------------- Lab result ---------------- */

function LabResultDialog({ open, order, onClose, onDone }: { open: boolean; order: MedicalRecord; onClose: () => void; onDone: (id: string) => void }) {
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<RecordData>({});
  const [files, setFiles] = useState<NewFile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setDate(todayISO()); setData({ test: order.data.test, laboratory: order.data.laboratory }); setFiles([]); setErrors({}); setErr(undefined); }
  }, [open, order]);
  const save = async () => {
    const v = validateData('lab_result', data);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const r = await recordService.addLabResult(order.id, data, date, files);
      onDone(r.id);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={() => !busy && onClose()} size="lg" title={`Add result: ${recordTitle(order)}`}
      description="The result is linked to this order and to the visit it came from."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save result</Button></>}>
      <div className="stack" style={{ '--gap': '20px' } as React.CSSProperties}>
        <RecordFields type="lab_result" date={date} onDate={setDate} data={data} onChange={setData} errors={errors} />
        <FilePicker files={files} onChange={setFiles} label="Attach the lab report" compact />
        <InlineError message={err} />
      </div>
    </Modal>
  );
}

