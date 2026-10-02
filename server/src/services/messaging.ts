/**
 * Outgoing messages. Email via SMTP (nodemailer); SMS via Twilio or MSG91 (REST, no SDK).
 * Without a provider in development, messages are printed to the server log.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { config, isProd, isTest } from '../config';

let transport: Transporter | null | undefined;

function mailer(): Transporter | null {
  if (transport !== undefined) return transport;
  const s = config.smtp;
  if (s.url) transport = nodemailer.createTransport(s.url);
  else if (s.host) transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: s.user ? { user: s.user, pass: s.pass } : undefined });
  else transport = null;
  return transport;
}

export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  const t = mailer();
  if (!t) {
    if (isProd) throw new Error('Email is not configured');
    if (!isTest) console.log(`\n[mail → ${to}] ${subject}\n${text}\n`);
    return;
  }
  await t.sendMail({ from: config.smtp.from, to, subject, text, html });
}

export async function sendSms(to: string, text: string, vars: Record<string, string> = {}) {
  const s = config.sms;
  const digits = to.replace(/\D/g, '');
  const e164 = to.trim().startsWith('+') ? `+${digits}` : `+91${digits.slice(-10)}`;
  if (s.provider === 'twilio') {
    const body = new URLSearchParams({ To: e164, From: s.twilioFrom, Body: text });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s.twilioSid}/Messages.json`, {
      method: 'POST', body,
      headers: { Authorization: `Basic ${Buffer.from(`${s.twilioSid}:${s.twilioToken}`).toString('base64')}` },
    });
    if (!r.ok) throw new Error(`Twilio error ${r.status}`);
    return;
  }
  if (s.provider === 'msg91') {
    // MSG91 requires a DLT-approved template in India; the code is passed as a template variable.
    const r = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST', headers: { authkey: s.msg91Key, 'content-type': 'application/json' },
      body: JSON.stringify({ template_id: s.msg91Template, recipients: [{ mobiles: e164.replace('+', ''), ...vars }] }),
    });
    if (!r.ok) throw new Error(`MSG91 error ${r.status}`);
    return;
  }
  if (isProd) throw new Error('SMS is not configured');
  if (!isTest) console.log(`\n[sms → ${e164}] ${text}\n`);
}
