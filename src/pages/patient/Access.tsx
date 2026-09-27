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

type Tab = 'active' | 'requests' | 'history';

export function AccessPage() {
  useDocumentTitle(`Doctors & access · ${brand.name}`);
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

  return (
    <>
      <div className="page-head">
        <div><h1>Doctors & access</h1><p>You decide who sees your record, what they see and for how long. Doctors can add to your record only while they have access.</p></div>
        <div className="actions">
          <Button icon={IdCard} onClick={() => setShowId(true)}>Show my patient ID</Button>
          <Button variant="primary" icon={ShieldCheck} onClick={ui.grantAccess}>Grant access</Button>
        </div>
      </div>
      <Tabs label="Access" value={tab} onChange={setTab} tabs={[
        { value: 'active', label: 'Active', count: d?.active.length },
        { value: 'requests', label: 'Requests', count: d?.requests.length },
        { value: 'history', label: 'Previous', count: d?.past.length },
      ]} />

      {data.error ? <ErrorState error={data.error} title="Unable to load doctor access" onRetry={data.reload} /> : !d ? <SkeletonList rows={3} /> : tab === 'active' ? (
        d.active.length === 0 ? (
          <div className="card"><EmptyState icon={ShieldCheck} title="No doctor has access right now" body="Your record is completely private. When you visit a doctor, grant access here — it ends automatically." action={<Button variant="primary" icon={ShieldCheck} onClick={ui.grantAccess}>Grant doctor access</Button>} /></div>
        ) : (
          <div className="grid-2">
            {d.active.map((g) => <ActiveCard key={g.id} g={g} onView={() => setView(g)} onEdit={() => setEdit(g)} onRevoke={() => setRevoke(g)} />)}
          </div>
        )
      ) : tab === 'requests' ? (
        d.requests.length === 0 && d.invites.length === 0 ? (
          <div className="card"><EmptyState icon={Inbox} title="No pending requests" body="When a doctor asks to see your record, the request appears here for you to approve or decline." /></div>
        ) : (
          <div className="stack">
            {d.requests.map((r) => (
              <section key={r.id} className="card access-card">
                <div className="access-top">
                  <Avatar name={r.doctor.fullName} doctor />
                  <div className="grow">
                    <div className="strong">{r.doctor.fullName}</div>
                    <div className="small muted">{r.doctor.specialization} · <Building2 size={12} aria-hidden style={{ verticalAlign: -1 }} /> {r.hospital?.name}</div>
                    <div className="xs subtle">Reg. {r.doctor.registrationNumber} · requested {relativeTime(r.createdAt)}</div>
                  </div>
                  <Badge tone="info" dot>Pending</Badge>
                </div>
                <div className="inset stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                  <div className="small"><span className="subtle">Reason: </span>{r.reason}</div>
                  <div className="small subtle">Requesting access to</div>
                  <PermissionBadges value={r.permissions} />
                  <div className="small"><span className="subtle">For </span><b>{durationLabel(r.durationHours)}</b></div>
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <Button onClick={() => setDecline(r)}>Decline</Button>
                  <Button variant="primary" icon={ShieldCheck} onClick={() => setApprove(r)}>Review & approve</Button>
                </div>
              </section>
            ))}
            {d.invites.map((i) => (
              <div key={i.id} className="card list-item">
                <span className="type-icon"><UserPlus aria-hidden /></span>
                <div className="grow"><div className="strong">{i.doctorName}</div><div className="xs muted">Invited {fmtDate(i.createdAt)} · {i.contact}</div></div>
                <Badge>Invitation sent</Badge>
                <Button size="sm" variant="ghost" iconOnly icon={X} aria-label="Cancel invitation" onClick={async () => { await accessService.cancelInvite(i.id); toast('Invitation cancelled'); }} />
              </div>
            ))}
          </div>
        )
      ) : d.past.length === 0 ? (
        <div className="card"><EmptyState icon={History} title="No previous access" body="Doctors whose access has ended or been revoked will be listed here." /></div>
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Doctor</th><th>Access</th><th>Duration</th><th>Status</th><th>Dates</th></tr></thead>
              <tbody>
                {d.past.map((g) => (
                  <tr key={g.id}>
                    <td><div className="strong">{g.doctor.fullName}</div><div className="xs muted">{g.hospital?.name}</div></td>
                    <td style={{ maxWidth: 280 }}><PermissionBadges value={g.permissions} max={3} /></td>
                    <td className="nowrap">{durationLabel(Math.round((parseDate(g.expiresAt).getTime() - parseDate(g.grantedAt).getTime()) / 3600000))}</td>
                    <td>{g.status === 'revoked' ? <Badge tone="danger">Revoked</Badge> : <Badge>Expired</Badge>}</td>
                    <td className="nowrap xs"><div>Granted {fmtDate(g.grantedAt)}</div><div className="muted">{g.status === 'revoked' ? `Revoked ${fmtDateTime(g.revokedAt)}` : `Ended ${fmtDateTime(g.expiresAt)}`}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="alert alert-accent">
        <ScrollText aria-hidden />
        <div>Every time a doctor opens your record or adds to it, it’s logged. <Link to="/app/activity">See your access log</Link>.</div>
      </div>

      <ConfirmDialog open={!!revoke} onClose={() => setRevoke(undefined)} danger confirmLabel="Revoke access" title={`Revoke ${revoke?.doctor.fullName}’s access?`}
        body={<>They will immediately lose access to your record, including anything they were viewing. Entries they already added stay in your record with their name.</>}
        onConfirm={async () => { await accessService.revoke(revoke!.id); toast('Access revoked'); }} />
      <ConfirmDialog open={!!decline} onClose={() => setDecline(undefined)} confirmLabel="Decline request" title="Decline this request?"
        body={`${decline?.doctor.fullName} will be told the request was declined. They can’t see anything in your record.`}
        onConfirm={async () => { await accessService.declineRequest(decline!.id); toast('Request declined'); }} />
      {edit && <ChangePermissions grant={edit} onClose={() => setEdit(undefined)} />}
      {approve && <ApproveRequest request={approve} onClose={() => setApprove(undefined)} />}
      {view && <AccessDetails grant={view} onClose={() => setView(undefined)} />}
      <Modal open={showId} onClose={() => setShowId(false)} title="Your patient ID" description="Show this to a doctor so they can find you and request access. It doesn’t reveal anything in your record.">
        {patient && (
          <div className="stack" style={{ alignItems: 'center' }}>
            <QrCode value={patient.patientCode} size={200} label={`QR code for patient ID ${patient.patientCode}`} />
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
    <section className="card access-card" aria-label={`Access for ${g.doctor.fullName}`}>
      <div className="access-top">
        <Avatar name={g.doctor.fullName} doctor />
        <div className="grow">
          <div className="strong">{g.doctor.fullName}</div>
          <div className="small muted">{g.doctor.specialization} · {g.hospital?.name}</div>
        </div>
        <Badge tone="ok" dot>Active</Badge>
      </div>
      <PermissionBadges value={g.permissions} />
      <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
        <div className={`expiry-bar ${low ? 'low' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Time remaining"><div style={{ width: `${pct}%` }} /></div>
        <dl className="access-dates" style={{ margin: 0 }}>
          <div><dt>Granted</dt><dd>{fmtDate(g.grantedAt)}</dd></div>
          <div><dt>Expires</dt><dd>{fmtDateTime(g.expiresAt)}</dd></div>
          <div><dt>Remaining</dt><dd style={{ color: low ? 'var(--warn)' : undefined }}>{timeLeft(g.expiresAt)}</dd></div>
        </dl>
      </div>
      <div className="row-wrap">
        <Button size="sm" variant="ghost" icon={Eye} onClick={onView}>View access</Button>
        <Button size="sm" variant="ghost" icon={SlidersHorizontal} onClick={onEdit}>Change permissions</Button>
        <Button size="sm" variant="danger-ghost" icon={ShieldOff} onClick={onRevoke} style={{ marginLeft: 'auto' }}>Revoke</Button>
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
    try { await accessService.updatePermissions(grant.id, perms); toast('Permissions updated'); onClose(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <Modal open={!otp} onClose={onClose} title="Change permissions" description={`What ${grant.doctor.fullName} can see and add to.`}
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!perms.length} onClick={save}>{widening ? 'Continue' : 'Save'}</Button></>}>
        <div className="stack">
          <PermissionSelector value={perms} onChange={setPerms} />
          {widening && <p className="xs muted">You’re sharing more, so we’ll ask you to verify.</p>}
          {err && <div className="field-error">{err}</div>}
        </div>
      </Modal>
      <OtpDialog open={otp} onClose={() => setOtp(false)} title="Verify to share more" request={() => accessService.requestVerification('change_permissions')}
        onVerify={async (c, code) => { await accessService.updatePermissions(grant.id, perms, { challengeId: c.id, code }); toast('Permissions updated'); onClose(); }} />
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
      <Modal open={!otp} onClose={onClose} title={`Approve ${request.doctor.fullName}?`} description="You can share less than they asked for, or for a shorter time."
        footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={ShieldCheck} disabled={!perms.length} onClick={() => setOtp(true)}>Approve</Button></>}>
        <div className="stack">
          <div className="inset small"><span className="subtle">Reason given: </span>{request.reason}</div>
          <PermissionSelector value={perms} onChange={setPerms} />
          <div className="xs subtle strong" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>For how long</div>
          <DurationPicker hours={hours} onChange={setHours} />
        </div>
      </Modal>
      <OtpDialog open={otp} onClose={() => setOtp(false)} title="Verify to approve" confirmLabel="Approve access"
        summary={<div className="inset small">{request.doctor.fullName} · {durationLabel(hours)} · {perms.length} permission{perms.length === 1 ? '' : 's'}</div>}
        request={() => accessService.requestVerification('approve_request')}
        onVerify={async (c, code) => { await accessService.approveRequest(request.id, perms, hours, { challengeId: c.id, code }); toast(`${request.doctor.fullName} now has access`); onClose(); }} />
    </>
  );
}

function AccessDetails({ grant, onClose }: { grant: GrantView; onClose: () => void }) {
  const log = useLive(() => auditService.forPatient(), []);
  const events = useMemo(() => log.data?.filter((a) => a.actor.id === grant.doctorId || a.target?.id === grant.doctorId), [log.data, grant.doctorId]);
  const methodLabel = useMemo(() => ({ directory: 'Doctor directory', code: 'Doctor access code', qr: 'QR code', invite: 'Invitation', request: 'You approved their request' })[grant.method], [grant.method]);
  return (
    <Modal open onClose={onClose} size="lg" title={grant.doctor.fullName} description={`${grant.doctor.specialization} · ${grant.hospital?.name} · Reg. ${grant.doctor.registrationNumber}`}>
      <div className="stack">
        <dl className="kv">
          <dt>Granted by</dt><dd>You, via {methodLabel}</dd>
          <dt>Verified</dt><dd>One-time code · {fmtDateTime(grant.verification.verifiedAt)}</dd>
          <dt>Granted</dt><dd>{fmtDateTime(grant.grantedAt)}</dd>
          <dt>Expires</dt><dd>{fmtDateTime(grant.expiresAt)} ({timeLeft(grant.expiresAt)})</dd>
        </dl>
        <PermissionBadges value={grant.permissions} />
        <h3 className="small strong" style={{ marginTop: 8 }}>Their activity on your record</h3>
        {!events ? <SkeletonList rows={3} card={false} /> : events.length === 0 ? <p className="small subtle">No activity yet.</p> : (
          <div className="card"><ul className="list">{events.slice(0, 20).map((a) => <li key={a.id}><AuditRow a={a} /></li>)}</ul></div>
        )}
      </div>
    </Modal>
  );
}
