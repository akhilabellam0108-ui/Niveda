-- "Taken" tokens on pushed reminders now expire 12 hours after the push's own time
-- (p_now) rather than the database clock. They're the same moment in production;
-- using one clock keeps the cleanup at the top of the function from deleting a
-- token it just created when the job is run for a given time (as the tests do).

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
