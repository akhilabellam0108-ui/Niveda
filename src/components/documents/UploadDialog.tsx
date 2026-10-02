import { useEffect, useState } from 'react';
import type { MedicalRecord } from '@shared/types';
import { recordTitle, RECORD_TYPES } from '@shared/recordMeta';
import { fmtDate, todayISO } from '@shared/dates';
import { documentService, recordService, friendlyError, type NewFile } from '../../services';
import { Button, Field, InlineError, Input, Modal, Select } from '../ui';
import { FilePicker } from '../records/RecordForm';

/** Upload one or more documents, optionally attaching them to an existing record. */
export function UploadDialog({ open, onClose, onDone, recordId: initialRecord }: { open: boolean; onClose: () => void; onDone: (n: number) => void; recordId?: string }) {
  const [files, setFiles] = useState<NewFile[]>([]);
  const [date, setDate] = useState(todayISO());
  const [recordId, setRecordId] = useState(initialRecord ?? '');
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setFiles([]); setDate(todayISO()); setRecordId(initialRecord ?? ''); setErr(undefined);
    recordService.list().then(setRecords).catch(() => setRecords([]));
  }, [open, initialRecord]);

  const save = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      for (const f of files) await documentService.upload({ file: f, date, recordId: recordId || undefined });
      onDone(files.length);
    } catch (e) {
      setErr(friendlyError(e, 'Upload failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Upload reports" size="lg"
      description="Add PDFs, scans, prescriptions or photos. Link them to an entry so they appear in the right place in your timeline."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!files.length} onClick={save}>Upload {files.length > 1 ? `${files.length} files` : ''}</Button></>}>
      <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
        <FilePicker files={files} onChange={setFiles} label="Choose files" />
        <div className="form-grid">
          <Field label="Date on the document">{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Attach to an entry" help="Optional — you can link it later.">
            {(p) => (
              <Select {...p} value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder="Don’t link"
                options={records.slice(0, 60).map((r) => ({ value: r.id, label: `${fmtDate(r.date)} · ${RECORD_TYPES[r.type].label}: ${recordTitle(r)}` }))} />
            )}
          </Field>
        </div>
        <InlineError message={err} />
      </div>
    </Modal>
  );
}
