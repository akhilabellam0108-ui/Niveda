// Supabase Edge Function: erases accounts whose 7-day deletion window has passed
// (DPDP Act 2023, s.12). Called every hour by pg_cron (public.configure_deletions).
//
// For each due request it deletes the person's uploaded documents from Storage
// (which SQL can't do), then erases the account and everything linked to it.
//
// Deploy:  supabase functions deploy process-deletions --no-verify-jwt
// Secrets: supabase secrets set CRON_SECRET=<long random string>   (same one as send-reminders is fine)
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';
const BUCKET = 'documents';

Deno.serve(async (req) => {
  const secret = env('CRON_SECRET');
  if (!secret || req.headers.get('x-niveda-cron') !== secret) return new Response('Forbidden', { status: 403 });
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  const { data: due, error } = await db.rpc('_due_deletions');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const result = { erased: 0, failed: 0 };
  for (const d of (due ?? []) as { requestId: string; userId: string; patientId: string | null }[]) {
    try {
      if (d.patientId) {
        // List and remove every file in the patient's folder, page by page.
        for (;;) {
          const { data: files, error: e } = await db.storage.from(BUCKET).list(d.patientId, { limit: 100 });
          if (e) throw e;
          if (!files?.length) break;
          const { error: rm } = await db.storage.from(BUCKET).remove(files.map((f) => `${d.patientId}/${f.name}`));
          if (rm) throw rm;
          if (files.length < 100) break;
        }
      }
      const { error: e } = await db.rpc('_erase_account', { p_request: d.requestId });
      if (e) throw e;
      result.erased++;
    } catch (e) {
      // Never log who it was; the request stays pending and is retried next hour.
      console.error(`[process-deletions] request ${d.requestId} failed: ${(e as Error).message}`);
      result.failed++;
    }
  }
  return Response.json(result);
});
