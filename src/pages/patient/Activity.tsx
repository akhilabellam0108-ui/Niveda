import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Eye, FilePlus2, PencilLine, ShieldCheck, ShieldOff, TimerOff, Inbox, LogIn, LogOut, KeyRound, FileUp, Trash2, Download, Siren, UserPlus, Ban, Check, X, UserRound, MonitorSmartphone, ScrollText, SlidersHorizontal } from 'lucide-react';
import type { AuditAction, AuditLog } from '../../types';
import { auditService } from '../../services';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { brand } from '../../config/brand';
import { fmtLongDate, fmtTime } from '../../lib/dates';
import { Badge, Card, EmptyState, ErrorState, SkeletonList, Avatar } from '../../components/ui';

export const ACTION_LABEL: Record<AuditAction, string> = {
  account_created: 'Created the account',
  signed_in: 'Signed in',
  signed_out: 'Signed out',
  password_changed: 'Changed password',
  access_granted: 'Granted access',
  access_changed: 'Changed permissions',
  access_revoked: 'Revoked access',
  access_expired: 'Access expired',
  access_requested: 'Requested access',
  request_approved: 'Approved access request',
  request_declined: 'Declined access request',
  viewed_record: 'Opened an entry',
  viewed_history: 'Viewed medical history',
  viewed_document: 'Viewed a document',
  record_added: 'Added to the record',
  record_amended: 'Corrected an entry',
  medication_discontinued: 'Stopped a medication',
  document_uploaded: 'Uploaded a document',
  document_deleted: 'Deleted a document',
  export_created: 'Exported records',
  emergency_viewed: 'Viewed emergency profile',
  emergency_access: 'Used emergency access',
  invite_sent: 'Invited a doctor',
  sessions_revoked: 'Signed out a device',
};

const ICON: Record<AuditAction, [LucideIcon, string]> = {
  account_created: [UserRound, ''], signed_in: [LogIn, ''], signed_out: [LogOut, ''], password_changed: [KeyRound, 'tone-warn'],
  access_granted: [ShieldCheck, 'tone-ok'], access_changed: [SlidersHorizontal, 'tone-info'], access_revoked: [ShieldOff, 'tone-danger'], access_expired: [TimerOff, ''],
  access_requested: [Inbox, 'tone-info'], request_approved: [Check, 'tone-ok'], request_declined: [X, ''],
  viewed_record: [Eye, 'tone-info'], viewed_history: [Eye, 'tone-info'], viewed_document: [Eye, 'tone-info'],
  record_added: [FilePlus2, 'tone-accent'], record_amended: [PencilLine, 'tone-warn'], medication_discontinued: [Ban, ''],
  document_uploaded: [FileUp, 'tone-accent'], document_deleted: [Trash2, 'tone-danger'], export_created: [Download, ''],
  emergency_viewed: [Siren, 'tone-danger'], emergency_access: [Siren, 'tone-danger'], invite_sent: [UserPlus, ''], sessions_revoked: [MonitorSmartphone, 'tone-warn'],
};

const FILTERS: { key: string; label: string; match: (a: AuditLog) => boolean }[] = [
  { key: 'all', label: 'Everything', match: () => true },
  { key: 'doctors', label: 'Doctor activity', match: (a) => a.actor.role === 'doctor' },
  { key: 'views', label: 'Views', match: (a) => a.action.startsWith('viewed') || a.action === 'emergency_viewed' },
  { key: 'changes', label: 'Added & changed', match: (a) => ['record_added', 'record_amended', 'medication_discontinued', 'document_uploaded', 'document_deleted'].includes(a.action) },
  { key: 'access', label: 'Access', match: (a) => a.action.startsWith('access') || a.action.startsWith('request') || a.action === 'invite_sent' },
  { key: 'security', label: 'Sign-ins & security', match: (a) => ['signed_in', 'signed_out', 'password_changed', 'sessions_revoked', 'account_created', 'export_created'].includes(a.action) },
];

function metaBadges(a: AuditLog): string[] {
  const m = a.metadata ?? {};
  const out: string[] = [];
  if (Array.isArray(m.permissions)) out.push(...m.permissions.map(String));
  if (m.duration) out.push(`for ${m.duration}`);
  if (m.method) out.push(`via ${m.method}`);
  if (Array.isArray(m.added) && m.added.length) out.push(`+ ${m.added.join(', ')}`);
  if (Array.isArray(m.removed) && m.removed.length) out.push(`− ${m.removed.join(', ')}`);
  if (m.attachments) out.push(`${m.attachments} attachment${Number(m.attachments) > 1 ? 's' : ''}`);
  if (m.version) out.push(`now v${m.version}`);
  if (m.records !== undefined) out.push(`${m.records} records, ${m.documents} documents`);
  return out;
}

export function AuditRow({ a, showPatient }: { a: AuditLog & { patientName?: string }; showPatient?: boolean }) {
  const [Icon, tone] = ICON[a.action];
  const who = a.actor.role === 'patient' ? (showPatient ? a.actor.name : 'You') : a.actor.name;
  const badges = metaBadges(a);
  return (
    <div className="audit-item">
      <span className={`type-icon sm ${tone}`} aria-hidden><Icon /></span>
      <div style={{ minWidth: 0 }}>
        <div className="small"><b>{who}</b>{a.actor.organization && a.actor.role === 'doctor' ? <span className="muted"> · {a.actor.organization}</span> : null}</div>
        <div className="small">{ACTION_LABEL[a.action]}{a.target?.label && <span className="muted"> — {a.target.label}</span>}{showPatient && a.patientName ? <span className="muted"> · {a.patientName}</span> : null}</div>
        {a.metadata?.reason && <div className="xs muted" style={{ marginTop: 4 }}>Reason: {String(a.metadata.reason)}</div>}
        {badges.length > 0 && <div className="audit-meta">{badges.map((b) => <Badge key={b}>{b}</Badge>)}</div>}
      </div>
      <div className="audit-when"><div>{fmtTime(a.timestamp)}</div></div>
    </div>
  );
}

export function groupByDay<T extends { timestamp: string }>(list: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const a of list) {
    const k = fmtLongDate(a.timestamp);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(a);
  }
  return [...m.entries()];
}

export function ActivityPage() {
  useDocumentTitle(`Access log · ${brand.name}`);
  const log = useLive(() => auditService.forPatient(), []);
  const [filter, setFilter] = useState('all');
  const [who, setWho] = useState('');
  const doctors = useMemo(() => [...new Map((log.data ?? []).filter((a) => a.actor.role === 'doctor').map((a) => [a.actor.id, a.actor.name])).entries()], [log.data]);
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    return (log.data ?? []).filter((a) => f.match(a) && (!who || a.actor.id === who));
  }, [log.data, filter, who]);

  return (
    <>
      <div className="page-head">
        <div><h1>Access log</h1><p>A permanent record of who looked at or changed your record, what they did and when. Entries can’t be edited or deleted.</p></div>
      </div>
      <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
        <div className="chip-scroll" role="group" aria-label="Filter activity">
          {FILTERS.map((f) => <button key={f.key} className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>)}
        </div>
        {doctors.length > 0 && (
          <div className="chip-scroll" role="group" aria-label="Filter by doctor">
            <button className="chip" aria-pressed={!who} onClick={() => setWho('')}>All people</button>
            {doctors.map(([id, name]) => <button key={id} className="chip" aria-pressed={who === id} onClick={() => setWho(id)}><Avatar name={name} size="sm" doctor />{name}</button>)}
          </div>
        )}
      </div>
      {log.error ? <ErrorState error={log.error} onRetry={log.reload} /> : !log.data ? <SkeletonList rows={6} /> : shown.length === 0 ? (
        <div className="card"><EmptyState icon={ScrollText} title="Nothing here yet" body="Activity on your record will appear here." /></div>
      ) : groupByDay(shown).map(([day, list]) => (
        <Card key={day} title={<span className="small">{day}</span>}>
          <ul className="list">{list.map((a) => <li key={a.id}><AuditRow a={a} /></li>)}</ul>
        </Card>
      ))}
    </>
  );
}
