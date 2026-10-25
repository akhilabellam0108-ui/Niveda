import { Building2, Lock, Paperclip, UserRound, History } from 'lucide-react';
import type { MedicalRecord } from '../../types';
import { RECORD_TYPES, addedByLabel, opt, recordSummary, recordTitle, isSevereAllergy } from '../../lib/recordMeta';
import { useSession } from '../../state/SessionContext';
import { RECORD_ICON, RECORD_TONE } from '../../lib/icons';
import { fmtDate } from '../../lib/dates';
import { isMedicationActive } from '../../services';
import { Badge } from '../ui';

import { t } from '../../i18n';
export function TypeIcon({ type, size }: { type: MedicalRecord['type']; size?: 'sm' }) {
  const Icon = RECORD_ICON[type];
  return <span className={`type-icon ${size ?? ''} ${RECORD_TONE[type]}`} aria-hidden><Icon /></span>;
}

export function StatusBadge({ record }: { record: MedicalRecord }) {
  const d = record.data;
  switch (record.type) {
    case 'medication':
      if (d.medStatus === 'discontinued') return <Badge>{t('Stopped')}</Badge>;
      return isMedicationActive(record) ? <Badge tone="ok" dot>{t('Active')}</Badge> : <Badge>{t('Completed')}</Badge>;
    case 'allergy':
      return isSevereAllergy(record) ? <Badge tone="danger">{String(d.severity)}</Badge> : <Badge tone="warn">{String(d.severity)}</Badge>;
    case 'lab_result': {
      const tone = d.status === 'Normal' ? 'ok' : d.status === 'Borderline' ? 'warn' : 'danger';
      return <Badge tone={tone}>{String(d.status)}</Badge>;
    }
    case 'lab_test':
      return d.status === 'Completed' ? <Badge tone="ok">{t('Result in')}</Badge> : d.status === 'Cancelled' ? <Badge>{t('Cancelled')}</Badge> : <Badge tone="info" dot>{opt(d.status)}</Badge>;
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
  const selfId = useSession().family?.self.id;
  const meta = RECORD_TYPES[record.type];
  const summary = recordSummary(record);
  const by = record.createdBy;
  return (
    <div className={`rec-card ${highlight ? 'highlight' : ''}`} onClick={() => onOpen(record.id)}>
      <div className="rec-top">
        <span className="rec-type">{t(meta.label)}</span>
        <StatusBadge record={record} />
        {record.version > 1 && <Badge icon={History}>v{record.version}</Badge>}
        {meta.permission === 'mental_health' || meta.permission === 'sensitive' ? <Badge icon={Lock}>{t('Private')}</Badge> : null}
        {showDate && <span className="subtle xs" style={{ marginLeft: 'auto' }}>{fmtDate(record.date)}</span>}
      </div>
      <button type="button" className="rec-title rec-open" onClick={(e) => { e.stopPropagation(); onOpen(record.id); }}>
        {recordTitle(record)}<span className="sr-only">, {t(meta.label)}, {fmtDate(record.date)}</span>
      </button>
      {summary && <div className="rec-summary truncate">{summary}</div>}
      {children}
      <div className="rec-meta">
        <span><UserRound aria-hidden />{by.role === 'doctor' ? by.name : addedByLabel(by, viewerIsPatient ? 'patient' : 'doctor', selfId)}</span>
        {(record.organization?.name ?? by.organization) && <span><Building2 aria-hidden />{record.organization?.name ?? by.organization}</span>}
        {record.attachments.length > 0 && <span><Paperclip aria-hidden />{record.attachments.length > 1 ? t('{n} attachments', { n: record.attachments.length }) : t('1 attachment')}</span>}
      </div>
    </div>
  );
}
