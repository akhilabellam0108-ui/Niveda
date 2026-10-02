import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { RecordData, RecordType } from '@shared/types';
import { RECORD_TYPE_LIST, RECORD_TYPES, validateData } from '@shared/recordMeta';
import { RECORD_ICON } from '../../lib/icons';
import { todayISO } from '@shared/dates';
import { recordService, friendlyError, type NewFile } from '../../services';
import { Button, InlineError, Modal } from '../ui';
import { FilePicker, RecordFields } from './RecordForm';

interface Props {
  open: boolean;
  onClose: () => void;
  initialType?: RecordType;
  onSaved: (id: string) => void;
}

/** The universal "Add medical record" flow for patients: choose a type, then a form made for it. */
export function AddRecordDialog({ open, onClose, initialType, onSaved }: Props) {
  const [type, setType] = useState<RecordType | undefined>(initialType);
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<RecordData>({});
  const [files, setFiles] = useState<NewFile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setType(initialType);
      setDate(todayISO());
      setData({});
      setFiles([]);
      setErrors({});
      setErr(undefined);
    }
  }, [open, initialType]);

  const save = async () => {
    if (!type) return;
    const v = validateData(type, data);
    if (!date) v.date = 'Date is required';
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setErr(undefined);
    try {
      const r = await recordService.create({ type, date, data, files });
      onSaved(r.id);
    } catch (e) {
      setErr(friendlyError(e, 'Your record couldn’t be saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const choosable = RECORD_TYPE_LIST.filter((t) => t.patientCanAdd);

  return (
    <Modal
      open={open} onClose={() => !busy && onClose()} size="lg"
      title={type ? `Add ${RECORD_TYPES[type].label.toLowerCase()}` : 'Add to your record'}
      description={type ? 'It will appear in your timeline and records straight away.' : 'What would you like to add?'}
      footer={type ? (
        <>
          {!initialType && <Button variant="ghost" icon={ArrowLeft} onClick={() => setType(undefined)} disabled={busy} style={{ marginRight: 'auto' }}>Change type</Button>}
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy}>Save to my record</Button>
        </>
      ) : undefined}
    >
      {!type ? (
        <div className="choice-grid" role="list">
          {choosable.map((t) => {
            const Icon = RECORD_ICON[t.type];
            return (
              <button key={t.type} role="listitem" className="choice" onClick={() => setType(t.type)}>
                <span className="choice-title"><Icon aria-hidden />{t.label}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="stack" style={{ '--gap': '20px' } as React.CSSProperties}>
          <RecordFields type={type} date={date} onDate={setDate} data={data} onChange={setData} errors={errors} />
          <FilePicker files={files} onChange={setFiles} compact />
          <InlineError message={err} />
        </div>
      )}
    </Modal>
  );
}
