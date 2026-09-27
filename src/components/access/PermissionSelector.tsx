import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { PermissionKey } from '../../types';
import { PERMISSIONS, permissionLabel } from '../../lib/recordMeta';
import { DURATIONS, durationLabel } from '../../services';
import { Badge, Input, Select } from '../ui';

export function PermissionSelector({ value, onChange, disabled }: { value: PermissionKey[]; onChange: (v: PermissionKey[]) => void; disabled?: boolean }) {
  const toggle = (k: PermissionKey) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  const regular = PERMISSIONS.filter((p) => !p.sensitive);
  const sensitive = PERMISSIONS.filter((p) => p.sensitive);
  const allOn = regular.every((p) => value.includes(p.key));
  return (
    <fieldset className="perm-selector" style={{ border: 0, padding: 0, margin: 0 }} disabled={disabled}>
      <legend className="sr-only">What to share</legend>
      <div className="spread" style={{ padding: '0 12px 4px' }}>
        <span className="xs subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>Medical information</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(allOn ? value.filter((v) => !regular.some((r) => r.key === v)) : [...new Set([...value, ...regular.map((r) => r.key)])])}>
          {allOn ? 'Clear all' : 'Select all'}
        </button>
      </div>
      {regular.map((p) => (
        <label key={p.key} className="perm-option">
          <input type="checkbox" checked={value.includes(p.key)} onChange={() => toggle(p.key)} />
          <span><span className="perm-label">{p.label}</span><span className="perm-desc">{p.description}</span></span>
        </label>
      ))}
      <div className="xs subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em', padding: '14px 12px 4px' }}>Sensitive — off by default</div>
      {sensitive.map((p) => (
        <label key={p.key} className="perm-option">
          <input type="checkbox" checked={value.includes(p.key)} onChange={() => toggle(p.key)} />
          <span><span className="perm-label"><Lock size={13} aria-hidden />{p.label}</span><span className="perm-desc">{p.description}</span></span>
        </label>
      ))}
    </fieldset>
  );
}

export function PermissionBadges({ value, max = 99 }: { value: PermissionKey[]; max?: number }) {
  const shown = value.slice(0, max);
  return (
    <div className="perm-list">
      {shown.map((k) => {
        const sensitive = PERMISSIONS.find((p) => p.key === k)?.sensitive;
        return <Badge key={k} tone={sensitive ? 'violet' : undefined} icon={sensitive ? Lock : undefined}>{permissionLabel(k)}</Badge>;
      })}
      {value.length > max && <Badge>+{value.length - max} more</Badge>}
    </div>
  );
}

export function DurationPicker({ hours, onChange }: { hours: number; onChange: (h: number) => void }) {
  const preset = DURATIONS.some((d) => d.hours === hours);
  const [custom, setCustom] = useState(!preset);
  const [amount, setAmount] = useState(preset ? 2 : hours % 24 === 0 ? hours / 24 : hours);
  const [unit, setUnit] = useState<'hours' | 'days'>(preset || hours % 24 === 0 ? 'days' : 'hours');
  const applyCustom = (a: number, u: 'hours' | 'days') => onChange(Math.max(1, Math.round(a)) * (u === 'days' ? 24 : 1));
  return (
    <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
      <div className="choice-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
        {DURATIONS.map((d) => (
          <button key={d.hours} type="button" className="choice" aria-pressed={!custom && hours === d.hours} onClick={() => { setCustom(false); onChange(d.hours); }}>
            <span className="choice-title">{d.label}</span>
          </button>
        ))}
        <button type="button" className="choice" aria-pressed={custom} onClick={() => { setCustom(true); applyCustom(amount, unit); }}>
          <span className="choice-title">Custom</span>
        </button>
      </div>
      {custom && (
        <div className="row">
          <Input type="number" min={1} max={unit === 'days' ? 90 : 72} value={amount} aria-label="Duration amount" style={{ width: 110 }}
            onChange={(e) => { const a = Number(e.target.value) || 1; setAmount(a); applyCustom(a, unit); }} />
          <Select value={unit} aria-label="Duration unit" style={{ width: 130 }} options={[{ value: 'hours', label: 'hours' }, { value: 'days', label: 'days' }]}
            onChange={(e) => { const u = e.target.value as 'hours' | 'days'; setUnit(u); applyCustom(amount, u); }} />
          <span className="small muted">= {durationLabel(hours)}</span>
        </div>
      )}
      <p className="xs subtle">Access ends automatically. You can revoke it earlier at any time.</p>
    </div>
  );
}
