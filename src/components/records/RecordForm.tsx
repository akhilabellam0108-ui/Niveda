import { useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import type { DocumentCategory, RecordData, RecordType } from '@shared/types';
import { RECORD_TYPES, type FieldDef } from '@shared/recordMeta';
import { ACCEPT_ATTR, DOC_CATEGORY_LABEL, guessCategory, validateFile, friendlyError, type NewFile } from '../../services';
import { Button, Field, Input, Select, Textarea } from '../ui';

export const DATE_LABEL: Partial<Record<RecordType, string>> = {
  consultation: 'Visit date', diagnosis: 'Date diagnosed', medication: 'Start date', allergy: 'Date identified',
  surgery: 'Date of surgery', procedure: 'Date of procedure', lab_test: 'Date ordered', lab_result: 'Test date',
  imaging: 'Date of scan', vaccination: 'Date given', hospitalization: 'Admission date', family_history: 'Date recorded',
  follow_up: 'Follow-up date',
};

interface Props {
  type: RecordType;
  date: string;
  onDate: (d: string) => void;
  data: RecordData;
  onChange: (d: RecordData) => void;
  errors?: Record<string, string>;
  /** Fields that are filled automatically (e.g. doctor name for clinicians). */
  hiddenKeys?: string[];
}

export function RecordFields({ type, date, onDate, data, onChange, errors = {}, hiddenKeys = [] }: Props) {
  const meta = RECORD_TYPES[type];
  const set = (k: string, v: string) => onChange({ ...data, [k]: v });
  const fields = meta.fields.filter((f) => !hiddenKeys.includes(f.key));
  // Put the headline field first, then the date.
  const [first, ...rest] = fields;
  return (
    <div className="form-grid">
      {first && <FieldInput f={first} value={data[first.key]} onChange={(v) => set(first.key, v)} error={errors[first.key]} />}
      <Field label={DATE_LABEL[type] ?? 'Date'} required error={errors.date}>
        {(p) => <Input {...p} type="date" value={date} onChange={(e) => onDate(e.target.value)} />}
      </Field>
      {rest.map((f) => <FieldInput key={f.key} f={f} value={data[f.key]} onChange={(v) => set(f.key, v)} error={errors[f.key]} />)}
    </div>
  );
}

function FieldInput({ f, value, onChange, error }: { f: FieldDef; value: unknown; onChange: (v: string) => void; error?: string }) {
  const v = value === undefined ? '' : String(value);
  return (
    <Field label={f.label} required={f.required} help={f.help} error={error} className={f.wide ? 'wide' : ''}>
      {(p) =>
        f.kind === 'textarea' ? <Textarea {...p} value={v} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} rows={3} />
        : f.kind === 'select' ? <Select {...p} value={v} options={f.options ?? []} placeholder={f.required ? 'Select…' : undefined} onChange={(e) => onChange(e.target.value)} />
        : <Input {...p} type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'} value={v} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
      }
    </Field>
  );
}

/* ---------------- File picker for attachments ---------------- */

export function FilePicker({ files, onChange, label = 'Attach reports or images', compact }: { files: NewFile[]; onChange: (f: NewFile[]) => void; label?: string; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string>();
  const add = (list: FileList | null) => {
    if (!list) return;
    setErr(undefined);
    const next: NewFile[] = [];
    for (const f of Array.from(list)) {
      try {
        validateFile(f);
        next.push({ name: f.name, type: f.type, blob: f, category: guessCategory(f) });
      } catch (e) {
        setErr(friendlyError(e));
      }
    }
    onChange([...files, ...next]);
  };
  return (
    <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
      <div
        className={`dropzone ${drag ? 'drag' : ''}`} role="button" tabIndex={0}
        style={compact ? { padding: 16 } : undefined}
        onClick={() => ref.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), ref.current?.click())}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
      >
        <Upload aria-hidden />
        <div className="small strong">{label}</div>
        <div className="xs subtle">PDF, JPG or PNG up to 15 MB · drag and drop or browse</div>
        <input ref={ref} type="file" multiple accept={ACCEPT_ATTR} hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </div>
      {err && <div className="field-error">{err}</div>}
      {files.map((f, i) => (
        <div key={i} className="file-row">
          <FileText aria-hidden />
          <span className="grow truncate">{f.name}</span>
          <select className="select" style={{ width: 'auto', minHeight: 30, padding: '2px 30px 2px 8px', fontSize: 12 }} aria-label={`Type of ${f.name}`}
            value={f.category} onChange={(e) => onChange(files.map((x, j) => (j === i ? { ...x, category: e.target.value as DocumentCategory } : x)))}>
            {Object.entries(DOC_CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <Button size="sm" variant="ghost" iconOnly icon={X} aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} />
        </div>
      ))}
    </div>
  );
}
