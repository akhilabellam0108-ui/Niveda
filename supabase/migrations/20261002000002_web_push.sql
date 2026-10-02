-- Medicine reminders as push notifications on iPhone, iPad, laptops and desktop
-- browsers, even when Niveda is closed (the Android app rings its own alarms).
--
--   * The browser registers a push subscription (save_push_subscription), with the
--     device's time zone so doses ring at the right local time.
--   * Every minute pg_cron calls the "send-reminders" Edge Function, which asks
--     _due_push_reminders() for doses that fell due in the last 10 minutes and are
--     not yet marked, and sends each one (grouped by time) with Web Push.
--   * "Taken" on the notification calls mark_dose_from_push with a single-use,
--     12-hour token, so it works without the app being open or signed in.
--
-- Turn it on with configure_push_reminders(...) — see docs/SUPABASE_SETUP.md.

create table public.push_subscriptions (
  id text primary key default public.new_id('psub'),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) < 1000),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth text not null check (length(auth) between 10 and 100),
  time_zone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- One push per device per dose time, however often the job runs.
create table public.push_sent (
  subscription_id text not null references public.push_subscriptions(id) on delete cascade,
  slot text not null,              -- 'YYYY-MM-DD HH:MM' in the device's time zone
  sent_at timestamptz not null default now(),
  primary key (subscription_id, slot)
);

create table public.dose_push_tokens (
  token text primary key,
  patient_id text not null references public.patients(id) on delete cascade,
  doses jsonb not null,            -- [{recordId, date, time}]
  expires_at timestamptz not null
);

create table public.push_config (
  id boolean primary key default true check (id),
  function_url text not null,
  secret text not null
);

alter table public.push_subscriptions enable row level security;
alter table public.push_sent enable row level security;
alter table public.dose_push_tokens enable row level security;
alter table public.push_config enable row level security;
-- No policies: these tables are reached only through the functions below.
revoke all on public.push_subscriptions, public.push_sent, public.dose_push_tokens, public.push_config from public, anon, authenticated;

/* ---------- called by the app ---------- */

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_time_zone text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare tz text := coalesce(nullif(trim(p_time_zone), ''), 'Asia/Kolkata');
begin
  if auth.uid() is null then perform fail('NOT_SIGNED_IN', 'Please sign in again.'); end if;
  if not exists (select 1 from pg_timezone_names where name = tz) then tz := 'Asia/Kolkata'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' then perform fail('VALIDATION', 'This browser gave an invalid notification address.'); end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, time_zone)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, tz)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, time_zone = excluded.time_zone, updated_at = now();
  -- Keep the 10 most recent devices per person.
  delete from push_subscriptions where user_id = auth.uid() and id not in (
    select id from push_subscriptions where user_id = auth.uid() order by updated_at desc limit 10);
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- "Taken" pressed on a notification. The token is the only credential: random,
-- single-use, tied to specific doses of one patient, and valid for 12 hours.
create or replace function public.mark_dose_from_push(p_token text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare t dose_push_tokens; d jsonb; n int := 0;
begin
  delete from dose_push_tokens where token = coalesce(p_token, '') and expires_at > now() returning * into t;
  if t.token is null then return 0; end if;
  for d in select value from jsonb_array_elements(t.doses) loop
    insert into dose_logs (patient_id, record_id, date, time, status)
    select t.patient_id, r.id, (d ->> 'date')::date, d ->> 'time', 'taken'
    from records r where r.id = d ->> 'recordId' and r.patient_id = t.patient_id
    on conflict (record_id, date, time) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

/* ---------- called by the send-reminders Edge Function (service role) ---------- */

-- Doses due now on each subscribed device: reminder on, course running that day,
-- time reached within the last 10 minutes, not yet marked taken or skipped, and
-- not already pushed to that device. Marks them as sent and returns one message
-- per device and dose time.
create or replace function public._due_push_reminders(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare out jsonb := '[]'; s record; tok text; names text;
begin
  delete from push_sent where sent_at < p_now - interval '2 days';
  delete from dose_push_tokens where expires_at < p_now;
  for s in
    with subs as (
      select ps.id, ps.endpoint, ps.p256dh, ps.auth, pt.id as patient_id, (p_now at time zone ps.time_zone) as local_now
      from push_subscriptions ps
      join patients pt on pt.user_id = ps.user_id
      left join preferences pr on pr.user_id = ps.user_id
      where coalesce(pr.prefs ->> 'medAlarms', 'true') <> 'false'
    ), due as (
      select subs.id as sub_id, subs.endpoint, subs.p256dh, subs.auth, subs.patient_id,
             subs.local_now::date as d, t.time, r.id as record_id, r.data
      from subs
      join medication_reminders mr on mr.patient_id = subs.patient_id and mr.enabled
      join records r on r.id = mr.record_id and r.type = 'medication'
      cross join lateral unnest(mr.times) as t(time)
      where subs.local_now::date >= r.date
        and (coalesce(r.data ->> 'endDate', '') = '' or subs.local_now::date <= (r.data ->> 'endDate')::date)
        and (coalesce(r.data ->> 'discontinuedOn', '') = '' or subs.local_now::date < (r.data ->> 'discontinuedOn')::date)
        and (r.data ->> 'frequency' is distinct from 'Weekly' or extract(dow from subs.local_now) = extract(dow from r.date))
        and subs.local_now >= subs.local_now::date + t.time::time
        and subs.local_now < subs.local_now::date + t.time::time + interval '10 minutes'
        and not exists (select 1 from dose_logs dl where dl.record_id = r.id and dl.date = subs.local_now::date and dl.time = t.time)
    )
    select sub_id, endpoint, p256dh, auth, patient_id, d, time,
           jsonb_agg(jsonb_build_object('recordId', record_id, 'date', d, 'time', time,
                     'label', trim(coalesce(data ->> 'name', 'Medicine') || ' ' || coalesce(data ->> 'dosage', ''))) order by data ->> 'name') as doses
    from due group by sub_id, endpoint, p256dh, auth, patient_id, d, time
  loop
    insert into push_sent (subscription_id, slot) values (s.sub_id, s.d || ' ' || s.time) on conflict do nothing;
    if not found then continue; end if;
    tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into dose_push_tokens (token, patient_id, doses, expires_at)
    values (tok, s.patient_id, (select jsonb_agg(x - 'label') from jsonb_array_elements(s.doses) x), p_now + interval '12 hours');
    select string_agg(x ->> 'label', ', ') into names from jsonb_array_elements(s.doses) x;
    out := out || jsonb_build_object(
      'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
      'title', 'Time for your medicine',
      'body', names || ' · ' || to_char(s.time::time, 'FMHH12:MI AM'),
      'tag', 'dose-' || s.d || '-' || s.time,
      'url', '#/app/medications',
      'token', tok);
  end loop;
  return out;
end $$;

-- The push service says this device is gone (uninstalled, permission removed).
create or replace function public._push_gone(p_endpoint text)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from push_subscriptions where endpoint = p_endpoint;
$$;

/* ---------- scheduling (run once by the project owner in the SQL editor) ---------- */

create or replace function public._ping_push_reminders()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c push_config;
begin
  select * into c from push_config;
  if c.function_url is null then return; end if;
  perform net.http_post(url := c.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-niveda-cron', c.secret),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
end $$;

-- select public.configure_push_reminders('https://<project>.supabase.co/functions/v1/send-reminders', '<CRON_SECRET>');
create or replace function public.configure_push_reminders(p_function_url text, p_secret text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(p_function_url, '') !~ '^https?://' or length(coalesce(p_secret, '')) < 16 then
    perform fail('VALIDATION', 'Give the send-reminders function URL and a secret of at least 16 characters.');
  end if;
  insert into push_config (id, function_url, secret) values (true, p_function_url, p_secret)
  on conflict (id) do update set function_url = excluded.function_url, secret = excluded.secret;
  begin
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'niveda-push-reminders';
    perform cron.schedule('niveda-push-reminders', '* * * * *', 'select public._ping_push_reminders()');
  exception when others then
    return 'Saved, but scheduling failed (' || sqlerrm || '). Enable pg_cron and pg_net under Database → Extensions and run this again.';
  end;
  return 'Push reminders are on: the send-reminders function runs every minute.';
end $$;

revoke execute on function public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text),
  public.mark_dose_from_push(text), public._due_push_reminders(timestamptz), public._push_gone(text),
  public._ping_push_reminders(), public.configure_push_reminders(text, text) from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text) to authenticated;
grant execute on function public.mark_dose_from_push(text) to anon, authenticated;
grant execute on function public._due_push_reminders(timestamptz), public._push_gone(text) to service_role;
