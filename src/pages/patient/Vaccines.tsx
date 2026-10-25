import { useEffect, useMemo, useState } from 'react';
import { Syringe, Check, CalendarClock, TriangleAlert, Plus, Info } from 'lucide-react';
import type { MedicalRecord } from '../../types';
import { recordService } from '../../services';
import { friendlyError } from '../../services/core';
import { useSession } from '../../state/SessionContext';
import { useDocumentTitle, useLive } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { brand } from '../../config/brand';
import { fmtDate, todayISO } from '../../lib/dates';
import { AGE_GROUPS, doseLabel, nextDoses, onSchedule, scheduleFor, type DoseState } from '../../lib/immunization';
import { Badge, Button, Card, EmptyState, ErrorState, Field, InlineError, Input, Modal, SkeletonList } from '../../components/ui';
import { usePatientUI } from '../../components/layout/PatientShell';

import { t } from '../../i18n';

export const UIP_SOURCE = 'https://nhmodisha.gov.in/wp-content/uploads/2024/02/UIP.pdf';

function StatusChip({ d }: { d: DoseState }) {
  switch (d.status) {
    case 'given': return <Badge tone="ok" icon={Check}>{t('Given {date}', { date: fmtDate(d.record!.date) })}</Badge>;
    case 'due': return <Badge tone="accent" dot>{t('Due now')}</Badge>;
    case 'overdue': return <Badge tone="danger">{t('Overdue')}</Badge>;
    case 'missed': return <Badge>{t('Age limit passed — ask your doctor')}</Badge>;
    default: return <Badge tone="info">{t('Due {date}', { date: fmtDate(d.dueDate) })}</Badge>;
  }
}

/** India's national vaccination schedule for a child, with what's been given. */
export function VaccinesPage() {
  const { patient } = useSession();
  useDocumentTitle(`${t('Vaccinations')} · ${brand.name}`);
  const ui = usePatientUI();
  const records = useLive(() => recordService.list(), []);
  const [giving, setGiving] = useState<DoseState | null>(null);
  const today = todayISO();
  const states = useMemo(() => (patient && records.data ? scheduleFor(patient.dateOfBirth, records.data, today) : []), [patient, records.data, today]);
  const other = (records.data ?? []).filter((r) => r.type === 'vaccination' && !states.some((s) => s.record?.id === r.id)).sort((a, b) => b.date.localeCompare(a.date));
  if (!patient) return null;
  const child = onSchedule(patient.dateOfBirth, today);
  const next = nextDoses(states).filter((d) => !d.some);
  const name = patient.fullName.split(' ')[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Vaccinations')}</h1>
          <p>{child
            ? t('India’s national immunisation schedule (UIP) for {name}. Mark each dose when it’s given — reminders go out a week before the next one.', { name })
            : t('Vaccines in your record.')}</p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => ui.addRecord('vaccination')}>{t('Add another vaccine')}</Button>
      </div>

      {records.error ? <ErrorState error={records.error} onRetry={records.reload} /> : !records.data ? <SkeletonList rows={4} /> : (
        <>
          {child && next.length > 0 && (
            <div className={`alert ${next.some((d) => d.status === 'overdue') ? 'alert-warn' : 'alert-accent'}`}>
              {next.some((d) => d.status === 'overdue') ? <TriangleAlert aria-hidden /> : <CalendarClock aria-hidden />}
              <div>
                <div className="alert-title">{next[0].status === 'upcoming' ? t('Next: {date}', { date: fmtDate(next[0].dueDate) }) : next.some((d) => d.status === 'overdue') ? t('Some doses are overdue') : t('Due now')}</div>
                {next.map((d) => `${d.vaccine} (${doseLabel(d.dose)})`).join(' · ')}
              </div>
            </div>
          )}

          {child && AGE_GROUPS.map((label, g) => {
            const rows = states.filter((s) => s.group === g);
            if (!rows.length) return null;
            return (
              <Card key={label} title={t(label)}>
                <div className="vax-list">
                  {rows.map((d) => (
                    <div key={d.key} className={`vax-row vax-${d.status}`}>
                      <span className={`type-icon sm ${d.status === 'given' ? 'tone-ok' : d.status === 'overdue' ? 'tone-danger' : 'tone-accent'}`} aria-hidden>{d.status === 'given' ? <Check /> : <Syringe />}</span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="strong small">{d.vaccine} <span className="muted">· {doseLabel(d.dose)}</span></div>
                        <div className="xs muted">
                          {d.status === 'given' ? [d.record?.data.facility, d.record?.data.batch && t('Batch {batch}', { batch: d.record.data.batch })].filter(Boolean).join(' · ') || t('Recorded')
                            : t('Due {date}', { date: fmtDate(d.dueDate) })}
                          {d.some && <> · {t(d.some)}</>}
                        </div>
                      </div>
                      <StatusChip d={d} />
                      {d.status === 'given'
                        ? <Button size="sm" variant="ghost" onClick={() => ui.openRecord(d.record!.id)}>{t('Details')}</Button>
                        : <Button size="sm" onClick={() => setGiving(d)}>{t('Mark as given')}</Button>}
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}

          {(other.length > 0 || !child) && (
            <Card title={child ? t('Other vaccines') : t('Your vaccines')}>
              {other.length === 0 ? <EmptyState compact icon={Syringe} title={t('No vaccines recorded')} body={t('Add vaccines with their date, so doctors can see them.')} /> : (
                <div className="vax-list">
                  {other.map((r: MedicalRecord) => (
                    <button key={r.id} className="vax-row as-button" onClick={() => ui.openRecord(r.id)}>
                      <span className="type-icon sm tone-ok" aria-hidden><Syringe /></span>
                      <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                        <div className="strong small">{String(r.data.vaccine ?? '')} {r.data.dose ? <span className="muted">· {doseLabel(String(r.data.dose))}</span> : null}</div>
                        <div className="xs muted">{fmtDate(r.date)}{r.data.facility ? ` · ${r.data.facility}` : ''}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}

          {child && (
            <p className="xs subtle" style={{ display: 'flex', gap: 6 }}>
              <Info size={14} aria-hidden style={{ flex: 'none', marginTop: 1 }} />
              <span>
                {t('Schedule from the Ministry of Health’s Universal Immunization Programme. Private clinics often follow the IAP schedule, which adds vaccines such as Hepatitis A, typhoid and chickenpox — add those with “Add another vaccine”. Always follow your child’s doctor.')}{' '}
                <a href={UIP_SOURCE} target="_blank" rel="noreferrer">{t('Source')}</a>
              </span>
            </p>
          )}
        </>
      )}

      <GiveDialog dose={giving} dob={patient.dateOfBirth} onClose={() => setGiving(null)} onSaved={() => { setGiving(null); records.reload(); }} />
    </>
  );
}

function GiveDialog({ dose, dob, onClose, onSaved }: { dose: DoseState | null; dob: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [facility, setFacility] = useState('');
  const [batch, setBatch] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (dose) { setDate(todayISO()); setFacility(''); setBatch(''); setErr(undefined); } }, [dose]);
  if (!dose) return null;
  const save = async () => {
    if (!date || date < dob || date > todayISO()) { setErr(t('Choose the date it was given (between birth and today).')); return; }
    setBusy(true); setErr(undefined);
    try {
      await recordService.create({ type: 'vaccination', date, data: { vaccine: dose.vaccine, dose: dose.dose, facility: facility.trim() || undefined, batch: batch.trim() || undefined, uipKey: dose.key } });
      toast(t('{vaccine} recorded', { vaccine: `${dose.vaccine} (${doseLabel(dose.dose)})` }));
      onSaved();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={() => !busy && onClose()} title={t('{vaccine} given', { vaccine: `${dose.vaccine} · ${doseLabel(dose.dose)}` })} size="sm"
      footer={<><Button onClick={onClose} disabled={busy}>{t('Cancel')}</Button><Button variant="primary" icon={Check} onClick={save} loading={busy}>{t('Save to record')}</Button></>}>
      <div className="stack">
        <Field label={t('Date given')} required>{(p) => <Input {...p} type="date" min={dob} max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label={t('Where')}>{(p) => <Input {...p} value={facility} onChange={(e) => setFacility(e.target.value)} placeholder={t('Hospital, clinic or Anganwadi centre')} />}</Field>
        <Field label={t('Batch number')} help={t('On the vaccination card, if written')}>{(p) => <Input {...p} value={batch} onChange={(e) => setBatch(e.target.value)} />}</Field>
        {err && <InlineError message={err} />}
      </div>
    </Modal>
  );
}
