import { useState, type ReactNode } from 'react';
import { CalendarClock, ClipboardList, FlaskConical, HeartPulse, History, Lock, Pill, ScanLine, Stethoscope, TriangleAlert, Users } from 'lucide-react';
import type { Patient, PermissionKey } from '../../types';
import type { BriefLine, Flag, PreVisitBrief as Brief } from '../../lib/brief';
import { fmtDate } from '../../lib/dates';
import { Badge } from '../ui';

import { opt } from '../../lib/recordMeta';
import { t as tr } from '../../i18n';
const TONE: Record<Exclude<Flag, undefined>, 'danger' | 'warn' | 'ok' | 'info'> = { danger: 'danger', warn: 'warn', ok: 'ok', info: 'info' };

/**
 * The doctor's one-screen brief. Each line opens the entry it came from, so a
 * summary is never the only evidence — the source is one tap away.
 */
export function PreVisitBrief({ brief, permissions, patient, onOpen }: { brief: Brief; permissions: PermissionKey[]; patient: Patient; onOpen: (id: string) => void }) {
  const shared = (k: PermissionKey) => permissions.includes(k);
  const empty = (k: PermissionKey, none: string, confirmed?: string) => (!shared(k) ? tr('Not shared with you') : confirmed ?? none);
  const d = patient.declarations;
  const b = brief;
  const since = b.stats.since ? new Date(`${b.stats.since}T00:00:00`).getFullYear() : undefined;

  return (
    <section className="card brief" aria-labelledby="brief-title">
      <div className="card-head">
        <h2 id="brief-title" className="row" style={{ '--gap': '8px' } as React.CSSProperties}><ClipboardList aria-hidden />{tr('Pre-visit brief')}</h2>
        <span className="xs muted">{since ? tr('From {n} entries since {since}', { n: b.stats.entries, since }) : tr('From {n} entries', { n: b.stats.entries })} · {tr('{n} doctors', { n: b.stats.doctors })} · {tr('{n} hospitals/labs', { n: b.stats.facilities })}
        </span>
      </div>

      <div className="brief-grid">
        <div className="brief-col">
          {b.openItems.length > 0 && (
            <BriefSection icon={CalendarClock} title={tr('Needs attention')}>
              {b.openItems.map((i) => <Line key={`${i.kind}${i.recordId}`} line={i} onOpen={onOpen} dateLabel={fmtDate(i.date)} />)}
            </BriefSection>
          )}

          <BriefSection icon={TriangleAlert} title={tr('Allergies')} empty={b.allergies.length ? undefined : empty('allergies', tr('None recorded'), d?.noAllergies ? tr('No known allergies — confirmed by patient') : undefined)}>
            {b.allergies.map((l) => <Line key={l.recordId} line={l} onOpen={onOpen} />)}
          </BriefSection>

          <BriefSection icon={HeartPulse} title={tr('Active problems')} empty={b.activeProblems.length ? undefined : empty('history', tr('None recorded'), d?.noConditions ? tr('No ongoing conditions — confirmed by patient') : undefined)}>
            {b.activeProblems.map((l) => <Line key={l.recordId} line={l} onOpen={onOpen} dateLabel={tr('since {value}', { value: fmtDate(l.date) })} />)}
          </BriefSection>

          <BriefSection icon={Pill} title={tr('Current medicines')} empty={b.currentMeds.length ? undefined : empty('medications', 'None', d?.noMedications ? tr('Takes no regular medicines — confirmed by patient') : undefined)}>
            {b.currentMeds.map((l) => <Line key={l.recordId} line={l} onOpen={onOpen} dateLabel={tr('from {value}', { value: fmtDate(l.date) })} />)}
          </BriefSection>

          {b.stoppedMeds.length > 0 && (
            <BriefSection icon={Pill} title={tr('Stopped recently')} subtle>
              {b.stoppedMeds.map((l) => <Line key={l.recordId} line={l} onOpen={onOpen} dateLabel={tr('stopped {value}', { value: fmtDate(l.date) })} />)}
            </BriefSection>
          )}

          <BriefSection icon={FlaskConical} title={tr('Lab results')} empty={b.labs.length ? undefined : empty('labs', tr('No results recorded'))} limit={6} count={b.labs.length}>
            {b.labs.map((t) => (
              <div key={t.latest.recordId} className="brief-lab">
                <Line line={t.latest} onOpen={onOpen} />
                {t.earlier.length > 0 && (
                  <div className="brief-trend xs muted">{tr('Earlier:')}{' '}
                    {t.earlier.slice(0, 3).map((e, i) => (
                      <span key={e.recordId}>{i > 0 && ' · '}<button type="button" className="link-btn" onClick={() => onOpen(e.recordId)}>{e.result}</button> ({fmtDate(e.date)}{e.status && e.status !== 'Normal' ? `, ${opt(e.status)}` : ''})</span>
                    ))}
                    {t.earlier.length > 3 && ` ${tr('+{n} more', { n: t.earlier.length - 3 })}`}
                  </div>
                )}
              </div>
            ))}
          </BriefSection>
        </div>

        <div className="brief-col">
          <BriefSection icon={Stethoscope} title={tr('Last visit')} empty={b.lastVisit ? undefined : empty('history', tr('No earlier visits recorded'))}>
            {b.lastVisit && (
              <button type="button" className="brief-line" onClick={() => onOpen(b.lastVisit!.recordId)}>
                <span className="brief-main">
                  <span className="strong">{b.lastVisit.title}</span>
                  {b.lastVisit.detail && <span className="small"> → {b.lastVisit.detail}</span>}
                </span>
                <span className="xs muted">{[fmtDate(b.lastVisit.date), b.lastVisit.doctor, b.lastVisit.facility].filter(Boolean).join(' · ')}</span>
                {b.lastVisit.handoverNote && <span className="brief-note small">“{b.lastVisit.handoverNote}”</span>}
              </button>
            )}
          </BriefSection>

          <BriefSection icon={History} title={tr('Surgeries & hospital stays')} empty={b.surgeriesAndStays.length ? undefined : (!shared('surgeries') && !shared('history') ? tr('Not shared with you') : d?.noSurgeries ? tr('None — confirmed by patient') : tr('None recorded'))} limit={4} count={b.surgeriesAndStays.length}>
            {b.surgeriesAndStays.map((l) => <Line key={l.recordId} line={l} onOpen={onOpen} />)}
          </BriefSection>

          <BriefSection icon={ScanLine} title={tr('Imaging')} empty={b.imaging.length ? undefined : empty('imaging', tr('None recorded'))} limit={3} count={b.imaging.length}>
            {b.imaging.map((l) => <Line key={l.recordId} line={l} onOpen={onOpen} />)}
          </BriefSection>

          {b.pastProblems.length > 0 && (
            <BriefSection icon={History} title={tr('Past problems')} subtle limit={4} count={b.pastProblems.length}>
              {b.pastProblems.map((l) => <Line key={l.recordId} line={l} onOpen={onOpen} />)}
            </BriefSection>
          )}

          {b.familyHistory.length > 0 && (
            <BriefSection icon={Users} title={tr('Family history')} subtle>
              {b.familyHistory.map((l) => <Line key={l.recordId} line={l} onOpen={onOpen} hideDate />)}
            </BriefSection>
          )}
        </div>
      </div>

      <div className="card-foot xs muted brief-foot">
        {b.notShared.length > 0 && <span className="row" style={{ '--gap': '6px' } as React.CSSProperties}><Lock aria-hidden size={13} />{tr('Not shared with you:')}{' '}{b.notShared.join(', ')}.</span>}
        <span>{tr('Built from the entries in this record. Tap any line to open the original entry and its documents.')}</span>
      </div>
    </section>
  );
}

function BriefSection({ icon: Icon, title, children, empty, subtle, limit, count }: { icon: typeof Pill; title: string; children?: ReactNode; empty?: string; subtle?: boolean; limit?: number; count?: number }) {
  const [all, setAll] = useState(false);
  const items = Array.isArray(children) ? children.flat() : children ? [children] : [];
  const shown = limit && !all ? items.slice(0, limit) : items;
  return (
    <div className={`brief-section ${subtle ? 'quiet' : ''}`}>
      <h3 className="brief-h"><Icon aria-hidden />{title}</h3>
      {empty ? <p className="small subtle">{empty}</p> : (
        <div className="brief-lines">
          {shown}
          {limit && count !== undefined && count > limit && (
            <button type="button" className="link-btn xs" onClick={() => setAll(!all)}>{all ? tr('Show fewer') : tr('Show {value} more', { value: count - limit })}</button>
          )}
        </div>
      )}
    </div>
  );
}

function Line({ line, onOpen, dateLabel, hideDate }: { line: BriefLine; onOpen: (id: string) => void; dateLabel?: string; hideDate?: boolean }) {
  return (
    <button type="button" className="brief-line" onClick={() => onOpen(line.recordId)}>
      <span className="brief-main">
        <span className="strong" style={{ color: line.flag === 'danger' ? 'var(--danger)' : undefined }}>{line.title}</span>
        {line.flagLabel && <Badge tone={line.flag ? TONE[line.flag] : undefined}>{opt(line.flagLabel)}</Badge>}
      </span>
      {(line.detail || !hideDate) && (
        <span className="xs muted">{[line.detail, hideDate ? undefined : dateLabel ?? fmtDate(line.date)].filter(Boolean).join(' · ')}</span>
      )}
    </button>
  );
}
