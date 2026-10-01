import { NotebookPen } from 'lucide-react';
import type { MedicalRecord } from '../../types';
import { fmtDate, fmtLongDate } from '../../lib/dates';

/**
 * The note the last doctor left for the next visit — whether the patient comes
 * back to them or sees someone else. Shown at the top of the patient's record.
 */
export function HandoverNote({ record, onOpen, compact }: { record: MedicalRecord; onOpen?: (id: string) => void; compact?: boolean }) {
  const who = record.createdBy.role === 'doctor' ? record.createdBy.name : String(record.data.doctor ?? 'Previous visit');
  const where = record.organization?.name ?? (record.data.facility ? String(record.data.facility) : undefined);
  return (
    <section className="alert alert-info handover" aria-label="Note for the next visit">
      <NotebookPen aria-hidden />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="alert-title">Note for the next visit</div>
        <p className="handover-text">{String(record.data.handoverNote)}</p>
        <div className="xs muted">
          {who}{where ? ` · ${where}` : ''} · {compact ? fmtDate(record.date) : fmtLongDate(record.date)}
          {record.data.followUp ? ` · follow-up ${fmtDate(String(record.data.followUp))}` : ''}
          {onOpen && <> · <button type="button" className="link-btn" onClick={() => onOpen(record.id)}>Open visit</button></>}
        </div>
      </div>
    </section>
  );
}
