import { Building2, Lock, Paperclip, UserRound, History } from 'lucide-react';
import type { MedicalRecord } from '@shared/types';
import { RECORD_TYPES, recordSummary, recordTitle, isSevereAllergy } from '@shared/recordMeta';
import { RECORD_ICON, RECORD_TONE } from '../../lib/icons';
import { fmtDate } from '@shared/dates';
import { isMedicationActive } from '../../services';
import { Badge } from '../ui';

export function TypeIcon({ type, size }: { type: MedicalRecord['type']; size?: 'sm' }) {
  const Icon = RECORD_ICON[type];
  return <span className={`type-icon ${size ?? ''} ${RECORD_TONE[type]}`} aria-hidden><Icon /></span>;
}

export function StatusBadge({ record }: { record: MedicalRecord }) {
  const d = record.data;
  switch (record.type) {
    case 'medication':
      if (d.medStatus === 'discontinued') return <Badge>Stopped</Badge>;
      return isMedicationActive(record) ? <Badge tone="ok" dot>Active</Badge> : <Badge>Completed</Badge>;
    case 'allergy':
      return isSevereAllergy(record) ? <Badge tone="danger">{String(d.severity)}</Badge> : <Badge tone="warn">{String(d.severity)}</Badge>;
    case 'lab_result': {
      const tone = d.status === 'Normal' ? 'ok' : d.status === 'Borderline' ? 'warn' : 'danger';
      return <Badge tone={tone}>{String(d.status)}</Badge>;
    }
    case 'lab_test':
      return d.status === 'Completed' ? <Badge tone="ok">Result in</Badge> : d.status === 'Cancelled' ? <Badge>Cancelled</Badge> : <Badge tone="info" dot>{String(d.status)}</Badge>;
    case 'diagnosis':
      return <Badge tone={d.status === 'Resolved' ? undefined : d.status === 'Active' ? 'violet' : 'info'}>{String(d.status)}</Badge>;
    default:
      return null;
  }
}

interface CardProps {
  record: MedicalRecord;
  onOpen: (id: string) => void;
  children?: React.ReactNode;
  highlight?: boolean;
  showDate?: boolean;
  viewerIsPatient?: boolean;
}

export function RecordCard({ record, onOpen, children, highlight, showDate, viewerIsPatient = true }: CardProps) {
  const meta = RECORD_TYPES[record.type];
  const summary = recordSummary(record);
  const by = record.createdBy;
  return (
    <div className={`rec-card ${highlight ? 'highlight' : ''}`} onClick={() => onOpen(record.id)}>
      <div className="rec-top">
        <span className="rec-type">{meta.label}</span>
        <StatusBadge record={record} />
        {record.version > 1 && <Badge icon={History}>v{record.version}</Badge>}
        {meta.permission === 'mental_health' || meta.permission === 'sensitive' ? <Badge icon={Lock}>Private</Badge> : null}
        {showDate && <span className="subtle xs" style={{ marginLeft: 'auto' }}>{fmtDate(record.date)}</span>}
      </div>
      <button type="button" className="rec-title rec-open" onClick={(e) => { e.stopPropagation(); onOpen(record.id); }}>
        {recordTitle(record)}<span className="sr-only">, {meta.label}, {fmtDate(record.date)}</span>
      </button>
      {summary && <div className="rec-summary truncate">{summary}</div>}
      {children}
      <div className="rec-meta">
        <span><UserRound aria-hidden />{by.role === 'patient' ? (viewerIsPatient ? 'Added by you' : 'Added by patient') : by.name}</span>
        {(record.organization?.name ?? by.organization) && <span><Building2 aria-hidden />{record.organization?.name ?? by.organization}</span>}
        {record.attachments.length > 0 && <span><Paperclip aria-hidden />{record.attachments.length} attachment{record.attachments.length > 1 ? 's' : ''}</span>}
      </div>
    </div>
  );
}
