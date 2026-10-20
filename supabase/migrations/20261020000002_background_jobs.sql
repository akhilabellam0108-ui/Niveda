-- Background jobs without hand-copied secrets.
--
-- The send-reminders and process-deletions Edge Functions are called by pg_cron with
-- a shared secret. Instead of someone generating that secret and pasting it into
-- both the database and the functions' settings, the database now makes it and the
-- functions check it with the database. Likewise the Web Push (VAPID) key pair is
-- made by the send-reminders function the first time it runs and kept here; only
-- the public half is ever handed out.
--
-- Turn everything on once, in the SQL Editor:
--   select public.setup_background_jobs('https://<project-ref>.supabase.co');
-- (Setting CRON_SECRET / VAPID_* as function secrets still works and takes priority.)

create table if not exists public.push_vapid (
  id boolean primary key default true check (id),
  public_key text not null check (length(public_key) between 80 and 100),
  private_key text not null check (length(private_key) between 40 and 50),
  created_at timestamptz not null default now()
);
alter table public.push_vapid enable row level security;
revoke all on public.push_vapid from public, anon, authenticated;

-- For the Edge Functions (service role): is this the cron secret?
create or replace function public._cron_secret_ok(p_secret text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(length(p_secret) >= 32 and p_secret = (select secret from push_config), false);
$$;

-- For send-reminders (service role): the stored key pair, if any.
create or replace function public._push_vapid()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('publicKey', public_key, 'privateKey', private_key) from push_vapid;
$$;

-- For send-reminders (service role): keep the first key pair ever made; return what's kept.
create or replace function public._save_push_vapid(p_public text, p_private text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into push_vapid (id, public_key, private_key) values (true, p_public, p_private) on conflict (id) do nothing;
  return public._push_vapid();
end $$;

-- For the app: the public key devices subscribe with (null until the job has run once).
create or replace function public.push_public_key()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select public_key from push_vapid;
$$;

-- For the project owner, once: schedules reminders (every minute) and erasures (hourly).
create or replace function public.setup_background_jobs(p_project_url text)
returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare base text := rtrim(coalesce(p_project_url, ''), '/'); s text; r1 text; r2 text;
begin
  if base !~ '^https://[a-z0-9-]+\.supabase\.(co|in|net)$' then
    perform fail('VALIDATION', 'Give the project URL, like https://abcd.supabase.co');
  end if;
  select secret into s from push_config;
  if s is null or length(s) < 32 then s := encode(extensions.gen_random_bytes(32), 'hex'); end if;
  r1 := public.configure_push_reminders(base || '/functions/v1/send-reminders', s);
  begin
    r2 := public.configure_deletions(base || '/functions/v1/process-deletions', s);
  exception when others then
    r2 := 'Account deletions were not scheduled (' || sqlerrm || '). Enable pg_cron and pg_net under Database → Extensions and run this again.';
  end;
  return r1 || ' ' || r2;
end $$;

revoke execute on function public._cron_secret_ok(text), public._push_vapid(), public._save_push_vapid(text, text),
  public.push_public_key(), public.setup_background_jobs(text) from public, anon, authenticated;
grant execute on function public._cron_secret_ok(text), public._push_vapid(), public._save_push_vapid(text, text) to service_role;
grant execute on function public.push_public_key() to anon, authenticated;
