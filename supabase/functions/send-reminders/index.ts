// Supabase Edge Function: sends due medicine reminders as Web Push notifications.
// Called every minute by pg_cron (see public.configure_push_reminders).
//
// Deploy:  supabase functions deploy send-reminders --no-verify-jwt
// No secrets to set: the cron secret is checked with the database, and the Web Push
// key pair is made on the first run and kept in the database (only the public half
// is handed out). CRON_SECRET / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
// set as function secrets still take priority.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendDueReminders, type DueMessage } from './reminders.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async (req) => {
  const url = env('SUPABASE_URL');
  const db = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  const given = req.headers.get('x-niveda-cron') ?? '';
  const ok = env('CRON_SECRET') ? given === env('CRON_SECRET') : (await db.rpc('_cron_secret_ok', { p_secret: given })).data === true;
  if (!ok) return new Response('Forbidden', { status: 403 });

  let keys = env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY')
    ? { publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY') }
    : ((await db.rpc('_push_vapid')).data as { publicKey: string; privateKey: string } | null);
  if (!keys) {
    const made = webpush.generateVAPIDKeys();
    const { data, error } = await db.rpc('_save_push_vapid', { p_public: made.publicKey, p_private: made.privateKey });
    if (error || !data) return new Response('Could not store the Web Push keys', { status: 500 });
    keys = data as { publicKey: string; privateKey: string };
  }
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:support@niveda.app', keys.publicKey, keys.privateKey);

  const result = await sendDueReminders({
    async due() {
      const { data, error } = await db.rpc('_due_push_reminders');
      if (error) throw new Error(error.message);
      return (data ?? []) as DueMessage[];
    },
    send: (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 900, urgency: 'high' }),
    gone: async (endpoint) => { await db.rpc('_push_gone', { p_endpoint: endpoint }); },
    takenUrl: `${url}/rest/v1/rpc/mark_dose_from_push`,
    publicKey: env('SUPABASE_ANON_KEY'),
  });
  return Response.json(result);
});
