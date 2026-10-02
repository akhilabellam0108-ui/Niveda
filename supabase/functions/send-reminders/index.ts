// Supabase Edge Function: sends due medicine reminders as Web Push notifications.
// Called every minute by pg_cron (see public.configure_push_reminders).
//
// Deploy:  supabase functions deploy send-reminders --no-verify-jwt
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
//            VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=<long random string>
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendDueReminders, type DueMessage } from './reminders.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async (req) => {
  const secret = env('CRON_SECRET');
  if (!secret || req.headers.get('x-niveda-cron') !== secret) return new Response('Forbidden', { status: 403 });
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY')) return new Response('VAPID keys are not set', { status: 500 });

  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:support@niveda.app', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  const url = env('SUPABASE_URL');
  const db = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

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
