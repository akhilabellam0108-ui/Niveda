// Supabase Edge Function: link a patient's ABHA to their Niveda record.
//
// Called by the signed-in patient (supabase.functions.invoke('abdm', …)). ABDM
// tokens stay here; the browser only sees ABDM's transaction id. The link is
// written by the server after it reads the ABHA profile itself, so nobody can
// attach an ABHA they haven't proved they own.
//
// Deploy:  supabase functions deploy abdm
// Secrets: supabase secrets set ABDM_CLIENT_ID=... ABDM_CLIENT_SECRET=... \
//            [ABDM_SESSION_URL=...] [ABDM_ABHA_BASE=...] [ABDM_CM_ID=sbx]
// See docs/ABDM.md.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AbdmClient, configFromEnv, matchesPatient, type LoginMethod } from './abdm.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
const fail = (code: string, message: string, status = 400) => reply({ error: { code, message } }, status);

let abdm: AbdmClient | null = null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return fail('VALIDATION', 'Method not allowed', 405);

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await db.auth.getUser(jwt);
  if (!auth.user) return fail('NOT_SIGNED_IN', 'Please sign in to continue.', 401);

  const { data: patient } = await db.from('patients').select('id, full_name, date_of_birth').eq('user_id', auth.user.id).maybeSingle();
  if (!patient) return fail('ACCESS_DENIED', 'Only patients can link an ABHA.', 403);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return fail('VALIDATION', 'Bad request'); }

  try {
    abdm ??= new AbdmClient(configFromEnv(env));
    const method = (body.method === 'mobile' ? 'mobile' : 'abha-number') as LoginMethod;

    if (body.action === 'request-otp') {
      return reply(await abdm.requestOtp(method, body.value ?? ''));
    }

    if (body.action === 'verify-otp' || body.action === 'select-account') {
      let xToken: string;
      if (body.action === 'verify-otp') {
        const v = await abdm.verifyOtp(method, body.txnId ?? '', (body.otp ?? '').replace(/\D/g, ''));
        // A mobile number linked to several ABHAs: the patient picks one.
        if (v.tToken) return reply({ chooseAccount: true, txnId: v.txnId ?? body.txnId, tToken: v.tToken, accounts: v.accounts });
        xToken = v.xToken!;
      } else {
        xToken = await abdm.selectAccount(body.txnId ?? '', body.tToken ?? '', body.abhaNumber ?? '');
      }
      const profile = await abdm.profile(xToken);
      const match = matchesPatient(profile, { fullName: patient.full_name, dateOfBirth: patient.date_of_birth });
      if (!match.ok) return fail('VALIDATION', `${match.reason} Update your profile or use your own ABHA.`);
      const { data, error } = await db.rpc('_link_abha', { p_user: auth.user.id, p: profile });
      if (error) return fail(/^([A-Z_]+):/.exec(error.message)?.[1] ?? 'UNKNOWN', error.message.replace(/^[A-Z_]+: /, ''));
      return reply({ linked: data });
    }

    return fail('VALIDATION', 'Unknown action');
  } catch (e) {
    const msg = (e as Error).message;
    console.error('[abdm]', msg);
    if (/must be set/.test(msg)) return fail('UNKNOWN', 'ABHA linking isn’t set up on this server yet.', 503);
    return fail('VALIDATION', msg.length < 200 ? msg : 'ABDM couldn’t complete this. Please try again.');
  }
});
