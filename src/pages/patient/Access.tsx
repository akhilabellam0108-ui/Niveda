import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ShieldCheck, ShieldOff, SlidersHorizontal, Eye, Inbox, History, UserPlus, Building2, IdCard, ScrollText, X } from 'lucide-react';
import type { PermissionKey } from '../../types';
import { accessService, auditService, durationLabel, friendlyError, type GrantView, type RequestView } from '../../services';
import { useLive, useDocumentTitle } from '../../state/hooks';
import { useSession } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { brand } from '../../config/brand';
import { fmtDate, fmtDateTime, relativeTime, timeLeft, parseDate, now } from '../../lib/dates';
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, SkeletonList, Tabs } from '../../components/ui';
import { OtpDialog } from '../../components/ui/Otp';
import { DurationPicker, PermissionBadges, PermissionSelector } from '../../components/access/PermissionSelector';
import { QrCode } from '../../components/access/Qr';
import { usePatientUI } from '../../components/layout/PatientShell';
import { AuditRow } from './Activity';

import { t } from '../../i18n';
type Tab = 'active' | 'requests' | 'history';

export function AccessPage() {
  useDocumentTitle(`${t('Doctors & access')} · ${brand.name}`);
  const ui = usePatientUI();
  const toast = useToast();
  const { patient } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'active';
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const data = useLive(() => accessService.listForPatient(), []);
  const [revoke, setRevoke] = useState<GrantView>();
  const [edit, setEdit] = useState<GrantView>();
  const [view, setView] = useState<GrantView>();
  const [approve, setApprove] = useState<RequestView>();
  const [decline, setDecline] = useState<RequestView>();
  const [showId, setShowId] = useState(false);
  const d = data.data;
  const everyone = d ? [...d.active, ...d.past].sort((a, b) => b.grantedAt.localeCompare(a.grantedAt)) : [];

  return (
    <>
      <div className="page-head">
        <div><h1>{t('Doctors & access')}</h1><p>{t('You decide who sees your record, what they see and for how long. Doctors can add to your record only while they have access.')}</p></div>
        <div className="actions">
          <Button icon={IdCard} onClick={() => setShowId(true)}>{t('Show my patient ID')}</Button>
          <Button variant="primary" icon={ShieldCheck} onClick={ui.grantAccess}>{t('Grant access')}</Button>
        </div>
      </div>
      <Tabs label={t('Access')} value={tab} onChange={setTab} tabs={[
        { value: 'active', label: t('Active'), count: d?.active.length },
        { value: 'requests', label: t('Requests'), count: d?.requests.length },
        { value: 'history', label: t('Access history'), count: d ? d.active.length + d.past.length : undefined },
      ]} />

      {data.error ? <ErrorState error={data.error} title={t('Unable to load doctor access')} onRetry={data.reload} /> : !d ? <SkeletonList rows={3} /> : tab === 'active' ? (
        d.active.length === 0 ? (
          <div className="card"><EmptyState icon={ShieldCheck} title={t('No doctor has access right now')} body={t('Your record is completely private. When you visit a doctor, grant access here — it ends automatically.')} action={<Button variant="primary" icon={ShieldCheck} onClick={ui.grantAccess}>{t('Grant doctor access')}</Button>} /></div>
        ) : (
          <div className="grid-2">
            {d.active.map((g) => <ActiveCard key={g.id} g={g} onView={() => setView(g)} onEdit={() => setEdit(g)} onRevoke={() => setRevoke(g)} />)}
          </div>
        )
      ) : tab === 'requests' ? (
        d.requests.length === 0 && d.invites.length === 0 ? (
          <div className="card"><EmptyState icon={Inbox} title={t('No pending requests')} body={t('When a doctor asks to see your record, the request appears here for you to approve or decline.')} /></div>
        ) : (
          <div className="stack">
            {d.requests.map((r) => (
              <section key={r.id} className="card access-card">
                <div className="access-top">
                  <Avatar name={r.doctor.fullName} doctor />
                  <div className="grow">
                    <div className="strong">{r.doctor.fullName}</div>
                    <div className="small muted">{r.doctor.specialization} · <Building2 size={12} aria-hidden style={{ verticalAlign: -1 }} /> {r.hospital?.name}</div>
                    <div className="xs subtle">{t('Reg. {number}', { number: r.doctor.registrationNumber })} · {t('requested {time}', { time: relativeTime(r.createdAt) })}</div>
                  </div>
                  <Badge tone="info" dot>{t('Pending')}</Badge>
                </div>
                <div className="inset stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                  <div className="small"><span className="subtle">{t('Reason:')}{' '}</span>{r.reason}</div>
                  <div className="small subtle">{t('Requesting access to')}</div>
                  <PermissionBadges value={r.permissions} />
                  <div className="small"><span className="subtle">{t('For')}{' '}</span><b>{durationLabel(r.durationHours)}</b></div>
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <Button onClick={() => setDecline(r)}>{t('Decline')}</Button>
                  <Button variant="primary" icon={ShieldCheck} onClick={() => setApprove(r)}>{t('Review & approve')}</Button>
                </div>
              </section>
            ))}
            {d.invites.map((i) => (
              <div key={i.id} className="card list-item">
                <span className="type-icon"><UserPlus aria-hidden /></span>
                <div className="grow"><div className="strong">{i.doctorName}</div><div className="xs muted">{t('Invited {date}', { date: fmtDate(i.createdAt) })} · {i.contact}</div></div>
                <Badge>{t('Invitation sent')}</Badge>
                <Button size="sm" variant="ghost" iconOnly icon={X} aria-label={t('Cancel invitation')} onClick={async () => { await accessService.cancelInvite(i.id); toast(t('Invitation cancelled')); }} />
              </div>
            ))}
          </div>
        )
      ) : everyone.length === 0 ? (
        <div className="card"><EmptyState icon={History} title={t('No one has had access yet')} body={t('Every doctor you grant access to is kept here permanently — active, expired or revoked.')} /></div>
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Doctor')}</th><th>{t('What they could see')}</th><th>{t('Duration')}</th><th>{t('Status')}</th><th>{t('Dates')}</th></tr></thead>
              <tbody>
                {everyone.map((g) => (
                  <tr key={g.id}>
                    <td><div className="strong">{g.doctor.fullName}</div><div className="xs muted">{g.hospital?.name}</div></td>
                    <td style={{ maxWidth: 280 }}><PermissionBadges value={g.permissions} max={3} /></td>
                    <td className="nowrap">{durationLabel(Math.round((parseDate(g.expiresAt).getTime() - parseDate(g.grantedAt).getTime()) / 3600000))}</td>
                    <td>{g.status === 'active' ? <Badge tone="ok" dot>{t('Active')}</Badge> : g.status === 'revoked' ? <Badge tone="danger">{t('Revoked')}</Badge> : <Badge>{t('Expired')}</Badge>}</td>
                    <td className="nowrap xs"><div>{t('Granted {date}', { date: fmtDate(g.grantedAt) })}</div><div className="muted">{g.status === 'active' ? t('Ends {value}', { value: fmtDateTime(g.expiresAt) }) : g.status === 'revoked' ? t('Revoked {value}', { value: fmtDateTime(g.revokedAt) }) : t('Ended {value}', { value: fmtDateTime(g.expiresAt) })}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="alert alert-accent">
        <ScrollText aria-hidden />
        <div>{t('Every time a doctor opens your record or adds to it, it’s logged.')}{' '}<Link to="/app/activity">{t('See your access log')}</Link>.</div>
      </div>

      <ConfirmDialog open={!!revoke} onClose={() => setRevoke(undefined)} danger confirmLabel={t('Revoke access')} title={t('Revoke {fullName}’s access?', { fullName: revoke?.doctor.fullName })}
        body={<>{t('They will immediately lose access to your record, including anything they were viewing. Entries they already added stay in your record with their name.')}</>}
        onConfirm={async () => { await accessService.revoke(revoke!.id); toast(t('Access revoked')); }} />
      <ConfirmDialog open={!!decline} onClose={() => setDecline(undefined)} confirmLabel={t('Decline request')} title={t('Decline this request?')}
        body={t('{fullName} will be told the request was declined. They can’t see anything in your record.', { fullName: decline?.doctor.fullName })}
        onConfirm={async () => { await accessService.declineRequest(decline!.id); toast(t('Request declined')); }} />
      {edit && <ChangePermissions grant={edit} onClose={() => setEdit(undefined)} />}
      {approve && <ApproveRequest request={approve} onClose={() => setApprove(undefined)} />}
      {view && <AccessDetails grant={view} onClose={() => setView(undefined)} />}
      <Modal open={showId} onClose={() => setShowId(false)} title={t('Your patient ID')} description={t('Show this to a doctor so they can find you and request access. It doesn’t reveal anything in your record.')}>
        {patient && (
          <div className="stack" style={{ alignItems: 'center' }}>
            <QrCode value={patient.patientCode} size={200} label={t('QR code for patient ID {patientCode}', { patientCode: patient.patientCode })} />
            <div className="num strong" style={{ fontSize: 22, letterSpacing: '.08em' }}>{patient.patientCode}</div>
          </div>
        )}
      </Modal>
    </>
  );
}

function ActiveCard({ g, onView, onEdit, onRevoke }: { g: GrantView; onView: () => void; onEdit: () => void; onRevoke: () => void }) {
  const total = parseDate(g.expiresAt).getTime() - parseDate(g.grantedAt).getTime();
  const left = Math.max(0, parseDate(g.expiresAt).getTime() - now().getTime());
  const pct = Math.max(2, Math.round((left / total) * 100));
  const low = left < 24 * 3600000;
  return (
    <section className="card access-card" aria-label={t('Access for {fullName}', { fullName: g.doctor.fullName })}>
      <div className="access-top">
        <Avatar name={g.doctor.fullName} doctor />
        <div className="grow">
          <div className="strong">{g.doctor.fullName}</div>
          <div className="small muted">{g.doctor.specialization} · {g.hospital?.name}</div>
        </div>
        <Badge tone="ok" dot>{t('Active')}</Badge>
      </div>
      <PermissionBadges value={g.permissions} />
      <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
        <div className={`expiry-bar ${low ? 'low' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('Time remaining')}><div style={{ width: `${pct}%` }} /></div>
        <dl className="access-dates" style={{ margin: 0 }}>
          <div><dt>{t('Granted')}</dt><dd>{fmtDate(g.grantedAt)}</dd></div>
          <div><dt>{t('Expires')}</dt><dd>{fmtDateTime(g.expiresAt)}</dd></div>
          <div><dt>{t('Remaining')}</dt><dd style={{ color: low ? 'var(--warn)' : undefined }}>{timeLeft(g.expiresAt)}</dd></div>
        </dl>
      </div>
      <div className="row-wrap">
        <Button size="sm" variant="ghost" icon={Eye} onClick={onView}>{t('View access')}</Button>
        <Button size="sm" variant="ghost" icon={SlidersHorizontal} onClick={onEdit}>{t('Change permissions')}</Button>
        <Button size="sm" variant="danger-ghost" icon={ShieldOff} onClick={onRevoke} style={{ marginLeft: 'auto' }}>{t('Revoke')}</Button>
      </div>
    </section>
  );
}

function ChangePermissions({ grant, onClose }: { grant: GrantView; onClose: () => void }) {
  const toast = useToast();
  const [perms, setPerms] = useState<PermissionKey[]>(grant.permissions);
  const [otp, setOtp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const widening = perms.some((p) => !grant.permissions.includes(p));
  const save = async () => {
    if (widening) { setOtp(true); return; }
    setBusy(true);
    try { await accessService.updatePermissions(grant.id, perms); toast(t('Permissions updated')); onClose(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <Modal open={!otp} onClose={onClose} title={t('Change permissions')} description={t('What {fullName} can see and add to.', { fullName: grant.doctor.fullName })}
        footer={<><Button onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" loading={busy} disabled={!perms.length} onClick={save}>{widening ? t('Continue') : t('Save')}</Button></>}>
        <div className="stack">
          <PermissionSelector value={perms} onChange={setPerms} />
          {widening && <p className="xs muted">{t('You’re sharing more, so we’ll ask you to verify.')}</p>}
          {err && <div className="field-error">{err}</div>}
        </div>
      </Modal>
      <OtpDialog open={otp} onClose={() => setOtp(false)} title={t('Verify to share more')} request={() => accessService.requestVerification('change_permissions')}
        onVerify={async (c, code) => { await accessService.updatePermissions(grant.id, perms, { challengeId: c.id, code }); toast(t('Permissions updated')); onClose(); }} />
    </>
  );
}

function ApproveRequest({ request, onClose }: { request: RequestView; onClose: () => void }) {
  const toast = useToast();
  const [perms, setPerms] = useState<PermissionKey[]>(request.permissions);
  const [hours, setHours] = useState(request.durationHours);
  const [otp, setOtp] = useState(false);
  return (
    <>
      <Modal open={!otp} onClose={onClose} title={t('Approve {fullName}?', { fullName: request.doctor.fullName })} description={t('You can share less than they asked for, or for a shorter time.')}
        footer={<><Button onClick={onClose}>{t('Cancel')}</Button><Button variant="primary" icon={ShieldCheck} disabled={!perms.length} onClick={() => setOtp(true)}>{t('Approve')}</Button></>}>
        <div className="stack">
          <div className="inset small"><span className="subtle">{t('Reason given:')}{' '}</span>{request.reason}</div>
          <PermissionSelector value={perms} onChange={setPerms} />
          <div className="xs subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t('For how long')}</div>
          <DurationPicker hours={hours} onChange={setHours} />
        </div>
      </Modal>
      <OtpDialog open={otp} onClose={() => setOtp(false)} title={t('Verify to approve')} confirmLabel={t('Approve access')}
        summary={<div className="inset small">{request.doctor.fullName} · {durationLabel(hours)} · {perms.length === 1 ? t('1 permission') : t('{n} permissions', { n: perms.length })}</div>}
        request={() => accessService.requestVerification('approve_request')}
        onVerify={async (c, code) => { await accessService.approveRequest(request.id, perms, hours, { challengeId: c.id, code }); toast(t('{fullName} now has access', { fullName: request.doctor.fullName })); onClose(); }} />
    </>
  );
}

function AccessDetails({ grant, onClose }: { grant: GrantView; onClose: () => void }) {
  const log = useLive(() => auditService.forPatient(), []);
  const events = useMemo(() => log.data?.filter((a) => a.actor.id === grant.doctorId || a.target?.id === grant.doctorId), [log.data, grant.doctorId]);
  const methodLabel = useMemo(() => ({ directory: t('Doctor directory'), code: t('Doctor access code'), qr: t('QR code'), invite: t('Invitation'), request: t('You approved their request'), emergency: t('emergency access — you couldn’t consent') })[grant.method], [grant.method]);
  return (
    <Modal open onClose={onClose} size="lg" title={grant.doctor.fullName} description={t('{specialization} · {name} · Reg. {registrationNumber}', { specialization: grant.doctor.specialization, name: grant.hospital?.name, registrationNumber: grant.doctor.registrationNumber })}>
      <div className="stack">
        <dl className="kv">
          <dt>{t('Granted by')}</dt><dd>{t('You, via {method}', { method: methodLabel })}</dd>
          <dt>{t('Verified')}</dt><dd>{t('One-time code ·')}{' '}{fmtDateTime(grant.verification.verifiedAt)}</dd>
          <dt>{t('Granted')}</dt><dd>{fmtDateTime(grant.grantedAt)}</dd>
          <dt>{t('Expires')}</dt><dd>{fmtDateTime(grant.expiresAt)} ({timeLeft(grant.expiresAt)})</dd>
        </dl>
        <PermissionBadges value={grant.permissions} />
        <h3 className="small strong" style={{ marginTop: 8 }}>{t('Their activity on your record')}</h3>
        {!events ? <SkeletonList rows={3} card={false} /> : events.length === 0 ? <p className="small subtle">{t('No activity yet.')}</p> : (
          <div className="card"><ul className="list">{events.slice(0, 20).map((a) => <li key={a.id}><AuditRow a={a} /></li>)}</ul></div>
        )}
      </div>
    </Modal>
  );
}
