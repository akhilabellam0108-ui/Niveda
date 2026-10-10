// Supabase "Send SMS" auth hook: Supabase Auth calls this whenever it needs to text
// a one-time code (phone sign-in codes and phone-number confirmation).
//
// Deploy:  supabase functions deploy send-sms --no-verify-jwt
// Secrets: supabase secrets set SEND_SMS_HOOK_SECRET="v1,whsec_..." SMS_PROVIDER=msg91 \
//            MSG91_AUTH_KEY=... MSG91_TEMPLATE_ID=...
//      or: SMS_PROVIDER=twilio TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+1...
// Then:    Authentication → Hooks → Send SMS hook → HTTPS → this function's URL.
// See docs/SUPABASE_SETUP.md, "SMS codes".
import { Webhook } from 'npm:standardwebhooks@1.0.0';
import { configFromEnv, maskPhone, sendOtpSms } from './sms.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const fail = (status: number, message: string) =>
  Response.json({ error: { http_code: status, message } }, { status });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail(405, 'Method not allowed');
  const secret = env('SEND_SMS_HOOK_SECRET').replace('v1,whsec_', '');
  if (!secret) return fail(500, 'SEND_SMS_HOOK_SECRET is not set');

  const body = await req.text();
  let payload: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    // Only Supabase Auth knows the secret, so nobody else can make Niveda send texts.
    payload = new Webhook(secret).verify(body, Object.fromEntries(req.headers)) as typeof payload;
  } catch {
    return fail(401, 'Invalid signature');
  }

  const phone = payload.user?.phone ?? '';
  const otp = payload.sms?.otp ?? '';
  try {
    await sendOtpSms(configFromEnv(env), phone, otp);
    return Response.json({});
  } catch (e) {
    console.error(`[send-sms] failed for ${maskPhone(phone)}: ${(e as Error).message}`);
    return fail(502, 'We couldn’t send the text message. Please try again in a minute.');
  }
});
