import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Eye, FilePlus2, PencilLine, ShieldCheck, ShieldOff, TimerOff, Inbox, LogIn, LogOut, KeyRound, FileUp, Trash2, Download, Siren, UserPlus, Ban, Check, X, UserRound, MonitorSmartphone, ScrollText, SlidersHorizontal, Smartphone, Link2, Unlink, Undo2, MessageSquareWarning, Baby, UsersRound, UserMinus, KeyRound as Key, HeartHandshake } from 'lucide-react';
import type { AuditAction, AuditLog } from '../../types';
import { auditService } from '../../services';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useSession } from '../../state/SessionContext';
import { brand } from '../../config/brand';
import { fmtLongDate, fmtTime } from '../../lib/dates';
import { Badge, Card, EmptyState, ErrorState, SkeletonList, Avatar } from '../../components/ui';

import { t } from '../../i18n';
import { tDuration, tServer } from '../../i18n/serverText';
export const ACTION_LABEL: Record<AuditAction, string> = {
  account_created: t('Created the account'),
  signed_in: t('Signed in'),
  signed_out: t('Signed out'),
  password_changed: t('Changed password'),
  access_granted: t('Granted access'),
  access_changed: t('Changed permissions'),
  access_revoked: t('Revoked access'),
  access_expired: t('Access expired'),
  access_requested: t('Requested access'),
  request_approved: t('Approved access request'),
  request_declined: t('Declined access request'),
  viewed_record: t('Opened an entry'),
  viewed_history: t('Viewed medical history'),
  viewed_document: t('Viewed a document'),
  record_added: t('Added to the record'),
  record_amended: t('Corrected an entry'),
  medication_discontinued: t('Stopped a medication'),
  document_uploaded: t('Uploaded a document'),
  document_deleted: t('Deleted a document'),
  export_created: t('Exported records'),
  emergency_viewed: t('Viewed emergency profile'),
  emergency_access: t('Used emergency access'),
  invite_sent: t('Invited a doctor'),
  sessions_revoked: t('Signed out a device'),
  phone_verified: t('Verified a phone number'),
  abha_linked: t('Linked ABHA'),
  abha_unlinked: t('Unlinked ABHA'),
  consent_given: t('Gave consent'),
  consent_withdrawn: t('Withdrew consent'),
  deletion_requested: t('Asked to delete the account'),
  deletion_cancelled: t('Cancelled account deletion'),
  grievance_filed: t('Raised a grievance'),
  profile_created: t('Created this child’s record'),
  guardian_invited: t('Invited a parent or guardian'),
  guardian_added: t('Joined as a parent or guardian'),
  guardian_left: t('Stopped managing the record'),
  handover_started: t('Made a handover code'),
  handover_completed: t('Took over the record'),
  carer_added: t('Let someone keep helping'),
};

const ICON: Record<AuditAction, [LucideIcon, string]> = {
  account_created: [UserRound, ''], signed_in: [LogIn, ''], signed_out: [LogOut, ''], password_changed: [KeyRound, 'tone-warn'],
  access_granted: [ShieldCheck, 'tone-ok'], access_changed: [SlidersHorizontal, 'tone-info'], access_revoked: [ShieldOff, 'tone-danger'], access_expired: [TimerOff, ''],
  access_requested: [Inbox, 'tone-info'], request_approved: [Check, 'tone-ok'], request_declined: [X, ''],
  viewed_record: [Eye, 'tone-info'], viewed_history: [Eye, 'tone-info'], viewed_document: [Eye, 'tone-info'],
  record_added: [FilePlus2, 'tone-accent'], record_amended: [PencilLine, 'tone-warn'], medication_discontinued: [Ban, ''],
  document_uploaded: [FileUp, 'tone-accent'], document_deleted: [Trash2, 'tone-danger'], export_created: [Download, ''],
  emergency_viewed: [Siren, 'tone-danger'], emergency_access: [Siren, 'tone-danger'], invite_sent: [UserPlus, ''], sessions_revoked: [MonitorSmartphone, 'tone-warn'],
  phone_verified: [Smartphone, 'tone-ok'], abha_linked: [Link2, 'tone-ok'], abha_unlinked: [Unlink, ''],
  consent_given: [ShieldCheck, 'tone-ok'], consent_withdrawn: [ShieldOff, 'tone-warn'],
  deletion_requested: [Trash2, 'tone-danger'], deletion_cancelled: [Undo2, ''], grievance_filed: [MessageSquareWarning, 'tone-warn'],
  profile_created: [Baby, 'tone-accent'], guardian_invited: [UserPlus, 'tone-info'], guardian_added: [UsersRound, 'tone-ok'], guardian_left: [UserMinus, ''],
  handover_started: [Key, 'tone-warn'], handover_completed: [Key, 'tone-ok'], carer_added: [HeartHandshake, 'tone-ok'],
};

const FILTERS: { key: string; label: string; match: (a: AuditLog) => boolean }[] = [
  { key: 'all', label: t('Everything'), match: () => true },
  { key: 'doctors', label: t('Doctor activity'), match: (a) => a.actor.role === 'doctor' },
  { key: 'views', label: t('Views'), match: (a) => a.action.startsWith('viewed') || a.action === 'emergency_viewed' },
  { key: 'changes', label: t('Added & changed'), match: (a) => ['record_added', 'record_amended', 'medication_discontinued', 'document_uploaded', 'document_deleted'].includes(a.action) },
  { key: 'access', label: t('Access'), match: (a) => a.action.startsWith('access') || a.action.startsWith('request') || a.action === 'invite_sent' },
  { key: 'security', label: t('Sign-ins & security'), match: (a) => ['signed_in', 'signed_out', 'password_changed', 'sessions_revoked', 'account_created', 'export_created', 'phone_verified', 'abha_linked', 'abha_unlinked', 'consent_given', 'consent_withdrawn', 'deletion_requested', 'deletion_cancelled', 'grievance_filed'].includes(a.action) },
];

function metaBadges(a: AuditLog): string[] {
  const m = a.metadata ?? {};
  const out: string[] = [];
  if (Array.isArray(m.permissions)) out.push(...m.permissions.map((x) => tServer(String(x))));
  if (m.duration) out.push(t('for {duration}', { duration: tDuration(String(m.duration)) }));
  if (m.method) out.push(t('via {method}', { method: tServer(String(m.method)) }));
  if (Array.isArray(m.added) && m.added.length) out.push(`+ ${m.added.map((x) => tServer(String(x))).join(', ')}`);
  if (Array.isArray(m.removed) && m.removed.length) out.push(`− ${m.removed.map((x) => tServer(String(x))).join(', ')}`);
  if (m.attachments) out.push(Number(m.attachments) > 1 ? t('{n} attachments', { n: m.attachments }) : t('1 attachment'));
  if (m.version) out.push(t('now version {n}', { n: m.version }));
  if (m.records !== undefined) out.push(t('{records} records, {documents} documents', { records: m.records, documents: m.documents }));
  return out;
}

export function AuditRow({ a, showPatient }: { a: AuditLog & { patientName?: string }; showPatient?: boolean }) {
  const { family, managing } = useSession();
  const [Icon, tone] = ICON[a.action] ?? [ScrollText, ''];
  const selfId = family?.self.id;
  // A parent acting for a child is named; "You" only for the person reading.
  const who = a.actor.guardian
    ? (a.actor.guardian.id === selfId ? t('You') : a.actor.guardian.name)
    : a.actor.role === 'patient' ? (showPatient || managing || (selfId && a.actor.id !== selfId) ? a.actor.name : t('You')) : a.actor.name;
  const badges = metaBadges(a);
  return (
    <div className="audit-item">
      <span className={`type-icon sm ${tone}`} aria-hidden><Icon /></span>
      <div style={{ minWidth: 0 }}>
        <div className="small"><b>{who}</b>{a.actor.organization && a.actor.role === 'doctor' ? <span className="muted"> · {a.actor.organization}</span> : null}</div>
        <div className="small">{ACTION_LABEL[a.action]}{a.target?.label && <span className="muted"> — {tServer(a.target.label)}</span>}{showPatient && a.patientName ? <span className="muted"> · {a.patientName}</span> : null}</div>
        {a.metadata?.reason && <div className="xs muted" style={{ marginTop: 4 }}>{t('Reason:')}{' '}{tServer(String(a.metadata.reason))}</div>}
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
  useDocumentTitle(`${t('Access log')} · ${brand.name}`);
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
        <div><h1>{t('Access log')}</h1><p>{t('A permanent record of who looked at or changed your record, what they did and when. Entries can’t be edited or deleted.')}</p></div>
      </div>
      <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
        <div className="chip-scroll" role="group" aria-label={t('Filter activity')}>
          {FILTERS.map((f) => <button key={f.key} className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>)}
        </div>
        {doctors.length > 0 && (
          <div className="chip-scroll" role="group" aria-label={t('Filter by doctor')}>
            <button className="chip" aria-pressed={!who} onClick={() => setWho('')}>{t('All people')}</button>
            {doctors.map(([id, name]) => <button key={id} className="chip" aria-pressed={who === id} onClick={() => setWho(id)}><Avatar name={name} size="sm" doctor />{name}</button>)}
          </div>
        )}
      </div>
      {log.error ? <ErrorState error={log.error} onRetry={log.reload} /> : !log.data ? <SkeletonList rows={6} /> : shown.length === 0 ? (
        <div className="card"><EmptyState icon={ScrollText} title={t('Nothing here yet')} body={t('Activity on your record will appear here.')} /></div>
      ) : groupByDay(shown).map(([day, list]) => (
        <Card key={day} title={<span className="small">{day}</span>}>
          <ul className="list">{list.map((a) => <li key={a.id}><AuditRow a={a} /></li>)}</ul>
        </Card>
      ))}
    </>
  );
}
