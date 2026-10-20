-- Security hardening found by the automated audit in tests/db/backend.test.mjs.
--
-- Supabase grants every new table's privileges to anon and authenticated by
-- default. Row-level security stops INSERT/UPDATE/DELETE without a policy, but
-- TRUNCATE ignores row-level security. The REST API never issues TRUNCATE, so this
-- wasn't reachable, but no client role should hold privileges it doesn't use.

-- Nobody signed out writes anything directly; signed-in users never truncate.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Tables written only through security-definer functions.
revoke insert, update, delete on public.admins, public.doctor_applications, public.emergency_accesses,
  public.abha_links, public.consents, public.deletion_requests, public.grievances from authenticated;

-- And for tables created later.
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from anon;

-- Postgres lets everyone (PUBLIC) execute new functions unless told otherwise, so a
-- few functions added after the original privilege reset were callable without
-- signing in. Each checks permissions itself, but signed-out callers get nothing.
-- The only function meant for signed-out use is "Taken" from a push notification.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname <> 'mark_dose_from_push'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- Internal helpers aren't for signed-in clients either.
revoke execute on function public._application_json(doctor_applications), public._assert_registration_free(text, uuid),
  public._clean_application(jsonb), public._emergency_reason_label(text), public._is_sealed(jsonb) from authenticated;

-- New functions start private; each migration grants what clients need.
alter default privileges in schema public revoke execute on functions from public;
