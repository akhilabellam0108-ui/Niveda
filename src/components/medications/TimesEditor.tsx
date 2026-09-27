import { Plus, X, BellRing } from 'lucide-react';
import { Button } from '../ui';

/** Edit a list of reminder times ("HH:MM"). */
export function TimesEditor({ times, onChange, label = 'Reminder times', disabled }: { times: string[]; onChange: (t: string[]) => void; label?: string; disabled?: boolean }) {
  return (
    <fieldset className="times-editor" disabled={disabled}>
      <legend className="field-label"><BellRing size={14} aria-hidden /> {label}</legend>
      <div className="row-wrap">
        {times.map((t, i) => (
          <span key={i} className="time-chip">
            <input type="time" value={t} aria-label={`Reminder ${i + 1}`} required onChange={(e) => onChange(times.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" aria-label={`Remove reminder ${i + 1}`} onClick={() => onChange(times.filter((_, j) => j !== i))}><X size={14} /></button>
          </span>
        ))}
        <Button size="sm" icon={Plus} onClick={() => onChange([...times, times.length ? nextSlot(times[times.length - 1]) : '08:00'])}>Add time</Button>
      </div>
    </fieldset>
  );
}

function nextSlot(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const nh = (h + 4) % 24;
  return `${String(nh).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
}
