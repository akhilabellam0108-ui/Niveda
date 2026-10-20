// Builds and sends one SMS with a one-time code, through MSG91 or Twilio.
// Kept free of Deno APIs so it can be unit-tested in Node (tests/edge.test.mjs).

export interface SmsConfig {
  provider: 'msg91' | 'twilio' | 'log';
  appName: string;
  msg91AuthKey?: string;
  /** MSG91 Flow template id. In India every SMS template must be DLT-registered. */
  msg91TemplateId?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  /** A Twilio number or Messaging Service SID (MG…). */
  twilioFrom?: string;
}

export interface SmsRequest { url: string; init: { method: string; headers: Record<string, string>; body: string } }

export function configFromEnv(env: (k: string) => string): SmsConfig {
  const p = env('SMS_PROVIDER').toLowerCase();
  return {
    provider: p === 'msg91' || p === 'twilio' ? p : 'log',
    appName: env('SMS_APP_NAME') || 'Niveda',
    msg91AuthKey: env('MSG91_AUTH_KEY'),
    msg91TemplateId: env('MSG91_TEMPLATE_ID'),
    twilioAccountSid: env('TWILIO_ACCOUNT_SID'),
    twilioAuthToken: env('TWILIO_AUTH_TOKEN'),
    twilioFrom: env('TWILIO_FROM'),
  };
}

/** "+91 98765 43210", "919876543210" → "919876543210" (digits only, with country code). */
export function digitsOnly(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
}

export function messageText(cfg: SmsConfig, otp: string): string {
  return `${otp} is your ${cfg.appName} code. It expires in 10 minutes. Never share it — ${cfg.appName} staff will never ask for it.`;
}

/** Returns the HTTP request to make, or null when the provider is "log" (development). */
export function buildRequest(cfg: SmsConfig, phone: string, otp: string): SmsRequest | null {
  if (!/^\d{4,10}$/.test(otp)) throw new Error('Invalid code');
  const to = digitsOnly(phone);
  if (to.length < 11 || to.length > 15) throw new Error('Invalid phone number');

  if (cfg.provider === 'msg91') {
    if (!cfg.msg91AuthKey || !cfg.msg91TemplateId) throw new Error('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID must be set');
    // The DLT template must contain the variable ##otp## (and may use ##app##).
    return {
      url: 'https://control.msg91.com/api/v5/flow',
      init: {
        method: 'POST',
        headers: { authkey: cfg.msg91AuthKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ template_id: cfg.msg91TemplateId, short_url: '0', recipients: [{ mobiles: to, otp, app: cfg.appName }] }),
      },
    };
  }

  if (cfg.provider === 'twilio') {
    if (!cfg.twilioAccountSid || !cfg.twilioAuthToken || !cfg.twilioFrom) throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM must be set');
    const params = new URLSearchParams({ To: `+${to}`, Body: messageText(cfg, otp) });
    params.set(cfg.twilioFrom.startsWith('MG') ? 'MessagingServiceSid' : 'From', cfg.twilioFrom);
    return {
      url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.twilioAccountSid)}/Messages.json`,
      init: {
        method: 'POST',
        headers: { authorization: `Basic ${btoa(`${cfg.twilioAccountSid}:${cfg.twilioAuthToken}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      },
    };
  }
  return null;
}

/** Masks a number for logs: never write a full phone number or a code to a log. */
export const maskPhone = (phone: string) => `••••${digitsOnly(phone).slice(-4)}`;

export async function sendOtpSms(cfg: SmsConfig, phone: string, otp: string, fetcher: typeof fetch = fetch): Promise<void> {
  const req = buildRequest(cfg, phone, otp);
  if (!req) {
    console.log(`[send-sms] SMS_PROVIDER not set — would text a code to ${maskPhone(phone)}`);
    return;
  }
  const r = await fetcher(req.url, req.init);
  const text = await r.text();
  // MSG91 can answer 200 with {"type":"error"}.
  if (!r.ok || /"type"\s*:\s*"error"/.test(text)) throw new Error(`${cfg.provider} rejected the SMS (${r.status})`);
}
