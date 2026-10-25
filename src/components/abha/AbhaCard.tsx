import { useState } from 'react';
import { BadgeCheck, Copy, ExternalLink, IdCard, Unlink } from 'lucide-react';
import { abhaService, formatAbhaNumber, friendlyError, type AbhaMethod, type AbhaVerifyResult } from '../../services';
import { useLive } from '../../state/hooks';
import { useToast } from '../../state/ToastContext';
import { fmtDate } from '../../lib/dates';
import { Badge, Button, Card, ConfirmDialog, Field, InlineError, Input, Modal, Tabs } from '../ui';
import { OtpInput } from '../ui/Otp';

import { t } from '../../i18n';
const CREATE_ABHA_URL = 'https://abha.abdm.gov.in/abha/v3/register';

/** Profile card: link the patient's ABHA (Ayushman Bharat Health Account). */
export function AbhaCard() {
  const toast = useToast();
  const link = useLive(() => abhaService.get(), []);
  const [open, setOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  if (!abhaService.available) return null;
  const l = link.data;
  return (
    <Card title={<span className="row" style={{ '--gap': '8px' } as React.CSSProperties}><IdCard size={18} aria-hidden />{t('ABHA — Ayushman Bharat Health Account')}</span>}
      action={l ? <Badge tone="ok" icon={BadgeCheck}>{t('Linked')}</Badge> : undefined}>
      <div className="card-pad stack" style={{ '--gap': '12px' } as React.CSSProperties}>
        {link.loading ? <div className="small muted">{t('Loading…')}</div> : l ? (
          <>
            <div className="form-grid">
              <div><div className="xs muted">{t('ABHA number')}</div><div className="strong num">{l.abhaNumber}</div></div>
              <div><div className="xs muted">{t('ABHA address')}</div><div className="strong">{l.abhaAddress || '—'}</div></div>
              <div><div className="xs muted">{t('Name on ABHA')}</div><div>{l.name}</div></div>
              <div><div className="xs muted">{t('Linked')}</div><div>{fmtDate(l.linkedAt)}</div></div>
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" icon={Copy} onClick={() => { void navigator.clipboard?.writeText(l.abhaAddress || l.abhaNumber); toast(t('Copied')); }}>{t('Copy ABHA address')}</Button>
              <Button size="sm" variant="danger-ghost" icon={Unlink} onClick={() => setUnlinkOpen(true)}>{t('Unlink')}</Button>
            </div>
          </>
        ) : (
          <>
            <p className="small muted">{t('Link your government health ID so hospitals on the Ayushman Bharat Digital Mission can recognise you, and your records can move between Niveda and other ABDM apps with your consent.')}</p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Button variant="primary" icon={IdCard} onClick={() => setOpen(true)}>{t('Link my ABHA')}</Button>
              <a className="btn btn-ghost btn-sm" href={CREATE_ABHA_URL} target="_blank" rel="noreferrer"><ExternalLink aria-hidden />{t('Don’t have one? Create it free')}</a>
            </div>
          </>
        )}
      </div>
      <LinkAbha open={open} onClose={() => setOpen(false)} />
      <ConfirmDialog open={unlinkOpen} onClose={() => setUnlinkOpen(false)} danger confirmLabel={t('Unlink ABHA')} title={t('Unlink your ABHA?')}
        body={t('Your Niveda record stays exactly as it is. You can link the ABHA again any time.')}
        onConfirm={async () => { await abhaService.unlink(); toast(t('ABHA unlinked')); }} />
    </Card>
  );
}

function LinkAbha({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [method, setMethod] = useState<AbhaMethod>('abha-number');
  const [value, setValue] = useState('');
  const [txn, setTxn] = useState<{ txnId: string; message: string; demoCode?: string }>();
  const [choose, setChoose] = useState<Extract<AbhaVerifyResult, { chooseAccount: true }>>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const reset = () => { setTxn(undefined); setChoose(undefined); setCode(''); setErr(undefined); setValue(''); };
  const close = () => { reset(); onClose(); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(undefined); try { await fn(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); } };
  const done = (r: AbhaVerifyResult) => {
    if ('linked' in r) { toast(t('ABHA linked to your record')); close(); } else setChoose(r);
  };
  const send = () => run(async () => setTxn(await abhaService.requestOtp(method, value)));
  const verify = (c = code) => run(async () => done(await abhaService.verifyOtp(method, txn!.txnId, c)));
  const pick = (abhaNumber: string) => run(async () => done(await abhaService.selectAccount(choose!.txnId, choose!.tToken, abhaNumber)));

  return (
    <Modal open={open} onClose={close} title={t('Link your ABHA')} size="sm"
      footer={choose ? <Button onClick={close}>{t('Cancel')}</Button> : <><Button onClick={close}>{t('Cancel')}</Button>{txn
        ? <Button variant="primary" loading={busy} onClick={() => verify()}>{t('Verify & link')}</Button>
        : <Button variant="primary" loading={busy} onClick={send}>{t('Send code')}</Button>}</>}>
      <div className="stack">
        {choose ? (
          <>
            <p className="small muted">{t('This mobile number has more than one ABHA. Choose yours:')}</p>
            <ul className="list">
              {choose.accounts.map((a) => (
                <li key={a.abhaNumber} className="list-item">
                  <div className="grow"><div className="strong small">{a.name}</div><div className="xs muted num">{a.abhaNumber}</div></div>
                  <Button size="sm" loading={busy} onClick={() => pick(a.abhaNumber)}>{t('This is me')}</Button>
                </li>
              ))}
            </ul>
          </>
        ) : !txn ? (
          <>
            <Tabs label={t('Link with')} value={method} onChange={(m) => { setMethod(m); setValue(''); }} tabs={[{ value: 'abha-number', label: t('ABHA number') }, { value: 'mobile', label: t('Mobile number') }]} />
            {method === 'abha-number'
              ? <Field label={t('ABHA number')} help={t('14 digits, on your ABHA card.')}>{(p) => <Input {...p} inputMode="numeric" placeholder="12-3456-7890-1234" value={value} onChange={(e) => setValue(formatAbhaNumber(e.target.value))} />}</Field>
              : <Field label={t('Mobile number linked to your ABHA')}>{(p) => <Input {...p} type="tel" inputMode="tel" value={value} onChange={(e) => setValue(e.target.value)} />}</Field>}
            <p className="xs muted">{t('ABDM (the government’s health mission) will text you a code to prove this ABHA is yours. The name and date of birth on it must match your Niveda profile.')}</p>
          </>
        ) : (
          <>
            <p className="small muted">{txn.message}</p>
            <OtpInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} disabled={busy} />
            {txn.demoCode && <div className="proto-code xs">{t('Demo code:')}{' '}<code>{txn.demoCode}</code> <Button size="sm" variant="ghost" onClick={() => { setCode(txn.demoCode!); void verify(txn.demoCode); }}>{t('Use it')}</Button></div>}
          </>
        )}
        <InlineError message={err} />
      </div>
    </Modal>
  );
}
