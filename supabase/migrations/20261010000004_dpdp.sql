-- India's Digital Personal Data Protection Act 2023 and DPDP Rules 2025.
--
--   * Consent: a ledger of what each person agreed to, per purpose, with the
--     version of the privacy notice they saw. Withdrawing is as easy as giving.
--   * Erasure (s.12): a person can ask to delete their account. It is erased after
--     a 7-day window in which they can change their mind (well inside the 90 days
--     the Rules allow). The process-deletions Edge Function does the erasing.
--   * Grievances (s.13): complaints get a reference and must be answered within
--     90 days; the Niveda team (grievance officer) sees and answers them.
--   * Nominee (s.14): someone who can exercise these rights if the person dies or
--     can't act for themselves.
--   * Children (s.9): people under 18 can't open their own account; verifiable
--     parental consent (e.g. DigiLocker) comes with family accounts.
--   * Logs: the audit log is append-only and kept for the life of the account
--     (the Rules require at least one year).

create table public.consents (
  id text primary key default public.new_id('cns'),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('core_record', 'reminders', 'abdm_sharing', 'product_updates')),
  granted boolean not null,
  notice_version text not null check (length(notice_version) between 1 and 40),
  at timestamptz not null default now()
);
create index consents_user_idx on public.consents (user_id, purpose, at desc);
alter table public.consents enable row level security;
create policy "own consents" on public.consents for select to authenticated using (user_id = auth.uid());
create trigger consents_immutable before update or delete on public.consents for each row execute function public.forbid_change();

create table public.deletion_requests (
  id text primary key default public.new_id('del'),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  erase_after timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'cancelled', 'completed')),
  reason text check (reason is null or length(reason) <= 500)
);
create unique index deletion_requests_one_pending on public.deletion_requests (user_id) where status = 'pending';
alter table public.deletion_requests enable row level security;
create policy "own deletion requests" on public.deletion_requests for select to authenticated using (user_id = auth.uid());

create table public.grievances (
  id text primary key default public.new_id('grv'),
  user_id uuid references auth.users(id) on delete set null,
  reference text not null unique,
  category text not null check (category in ('access', 'correction', 'erasure', 'consent', 'security', 'other')),
  description text not null check (length(trim(description)) between 10 and 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now(),
  respond_by timestamptz not null,
  response text,
  resolved_at timestamptz,
  handled_by uuid
);
alter table public.grievances enable row level security;
create policy "own grievances" on public.grievances for select to authenticated using (user_id = auth.uid());

alter table public.patients add column if not exists nominee jsonb
  check (nominee is null or (jsonb_typeof(nominee) = 'object' and length(nominee::text) < 1000));

revoke insert, update, delete on public.consents, public.deletion_requests, public.grievances from anon, authenticated;
grant select on public.consents, public.deletion_requests, public.grievances to authenticated;

/* ---------- consent ---------- */

create or replace function public._consent_json(c consents) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', c.id, 'purpose', c.purpose, 'granted', c.granted, 'noticeVersion', c.notice_version, 'at', c.at)
$$;

create or replace function public._set_med_alarms(p_user uuid, p_on boolean) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into preferences (user_id, prefs) values (p_user, jsonb_build_object('medAlarms', p_on))
  on conflict (user_id) do update set prefs = preferences.prefs || jsonb_build_object('medAlarms', p_on)
$$;

create or replace function public.record_consent(p_purpose text, p_granted boolean, p_notice_version text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c consents;
begin
  if auth.uid() is null then perform fail('NOT_SIGNED_IN', 'Please sign in to continue.'); end if;
  if p_purpose = 'core_record' and not p_granted then
    perform fail('VALIDATION', 'Niveda can’t keep your record without this. To stop entirely, delete your account instead.');
  end if;
  insert into consents (user_id, purpose, granted, notice_version) values (auth.uid(), p_purpose, p_granted, coalesce(nullif(trim(p_notice_version), ''), 'unknown'))
  returning * into c;
  -- Withdrawing reminder consent stops the reminders (pushed ones check this setting).
  if p_purpose = 'reminders' then perform _set_med_alarms(auth.uid(), p_granted); end if;
  perform _audit(my_patient_id(), _actor(), case when p_granted then 'consent_given' else 'consent_withdrawn' end,
    jsonb_build_object('type', 'consent', 'id', c.id, 'label', p_purpose));
  return _consent_json(c);
end $$;

-- The latest decision per purpose.
create or replace function public.my_consents() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(_consent_json(c) order by c.purpose), '[]'::jsonb)
  from (select distinct on (purpose) * from consents where user_id = auth.uid() order by purpose, at desc) c
$$;

/* ---------- sign-up: consent required, under-18s can't sign up alone ---------- */

create or replace function public._signup_consents(p_user uuid, meta jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := coalesce(nullif(meta ->> 'privacy_notice_version', ''), 'unknown'); p text;
begin
  insert into consents (user_id, purpose, granted, notice_version) values (p_user, 'core_record', true, v);
  foreach p in array array['reminders', 'product_updates'] loop
    if meta ? ('consent_' || p) then
      insert into consents (user_id, purpose, granted, notice_version) values (p_user, p, coalesce((meta ->> ('consent_' || p))::boolean, false), v);
      if p = 'reminders' then perform _set_med_alarms(p_user, coalesce((meta ->> 'consent_reminders')::boolean, false)); end if;
    end if;
  end loop;
end $$;

create or replace function public.complete_signup() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare meta jsonb; v_email text; v_code text; v_pid text; v_name text; v_dob date; v_phone text; c jsonb;
begin
  if auth.uid() is null then perform fail('NOT_SIGNED_IN', 'Please sign in to continue.'); end if;
  if exists (select 1 from accounts where user_id = auth.uid()) then return my_account(); end if;
  select raw_user_meta_data, email into meta, v_email from auth.users where id = auth.uid();

  if coalesce((meta ->> 'privacy_consent')::boolean, false) is not true then
    perform fail('VALIDATION', 'Please read and accept the privacy notice to create your account.');
  end if;

  if meta ->> 'signup_kind' = 'doctor' then
    c := _clean_application(meta);
    perform _assert_registration_free(c ->> 'registrationNumber', auth.uid());
    insert into accounts (user_id, role, onboarded) values (auth.uid(), 'applicant', true);
    insert into doctor_applications (user_id, full_name, email, phone, registration_number, medical_council, registration_year,
      specialization, qualifications, years_of_practice, hospital_name, hospital_city, hospital_type)
    values (auth.uid(), c ->> 'fullName', v_email, c ->> 'phone', c ->> 'registrationNumber', c ->> 'medicalCouncil',
      (c ->> 'registrationYear')::int, c ->> 'specialization', c ->> 'qualifications', (c ->> 'yearsOfPractice')::int,
      c ->> 'hospitalName', c ->> 'hospitalCity', c ->> 'hospitalType');
    perform _signup_consents(auth.uid(), meta);
    insert into notifications (user_id, kind, title, body, link) values (auth.uid(), 'security', 'Application received',
      'The Niveda team will check your registration and let you know here. This usually takes 1–2 working days.', '/doctor-application');
    return my_account();
  end if;

  v_name := trim(coalesce(meta ->> 'full_name', ''));
  v_phone := trim(coalesce(meta ->> 'phone', ''));
  begin v_dob := (meta ->> 'date_of_birth')::date; exception when others then v_dob := null; end;
  if v_name = '' or v_dob is null or length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then
    perform fail('VALIDATION', 'Your sign-up details are incomplete. Please sign up again.');
  end if;
  if v_dob > current_date - interval '18 years' then
    perform fail('VALIDATION', 'You need to be 18 or older to create your own account. A parent or guardian can keep your records for now.');
  end if;
  if exists (select 1 from patients where right(regexp_replace(patients.phone, '\D', '', 'g'), 10) = right(regexp_replace(v_phone, '\D', '', 'g'), 10)) then
    perform fail('CONFLICT', 'This phone number is already linked to an account.');
  end if;
  loop
    v_code := 'NV-' || lpad((floor(random() * 10000))::int::text, 4, '0') || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from patients where patient_code = v_code);
  end loop;
  insert into accounts (user_id, role) values (auth.uid(), 'patient');
  insert into patients (user_id, patient_code, full_name, date_of_birth, email, phone)
  values (auth.uid(), v_code, v_name, v_dob, v_email, v_phone) returning id into v_pid;
  perform _audit(v_pid, jsonb_build_object('id', v_pid, 'role', 'patient', 'name', v_name), 'account_created', '{"type":"account","label":"Patient account"}');
  perform _signup_consents(auth.uid(), meta);
  insert into notifications (user_id, kind, title, body, link) values (auth.uid(), 'security', 'Welcome to Niveda',
    'Your record is private by default. Only doctors you grant access to can see it, and every view is logged.', '/app/privacy');
  return my_account();
end $$;

/* ---------- nominee ---------- */

create or replace function public.set_nominee(p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me text := my_patient_id(); n jsonb;
begin
  if me is null then perform fail('ACCESS_DENIED', 'Only patients can name a nominee.'); end if;
  if p is null or p = 'null'::jsonb then update patients set nominee = null where id = me; return; end if;
  n := jsonb_build_object('name', left(trim(coalesce(p ->> 'name', '')), 120), 'relationship', left(trim(coalesce(p ->> 'relationship', '')), 60),
    'phone', left(trim(coalesce(p ->> 'phone', '')), 20), 'email', left(trim(coalesce(p ->> 'email', '')), 120));
  if n ->> 'name' = '' or n ->> 'relationship' = '' or length(regexp_replace(n ->> 'phone', '\D', '', 'g')) < 10 then
    perform fail('VALIDATION', 'Give your nominee’s name, relationship and phone number.');
  end if;
  update patients set nominee = n where id = me;
end $$;

/* ---------- erasure ---------- */

create or replace function public._deletion_json(d deletion_requests) returns jsonb
language sql immutable as $$
  select case when d.id is null then null else jsonb_build_object('id', d.id, 'requestedAt', d.requested_at, 'eraseAfter', d.erase_after,
    'status', d.status, 'reason', d.reason) end
$$;

create or replace function public.request_deletion(p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare d deletion_requests;
begin
  if auth.uid() is null then perform fail('NOT_SIGNED_IN', 'Please sign in to continue.'); end if;
  perform _require_step_up();
  if exists (select 1 from deletion_requests where user_id = auth.uid() and status = 'pending') then
    perform fail('CONFLICT', 'Your account is already scheduled for deletion.');
  end if;
  insert into deletion_requests (user_id, erase_after, reason) values (auth.uid(), now() + interval '7 days', nullif(left(trim(coalesce(p_reason, '')), 500), ''))
  returning * into d;
  -- Nobody keeps access to a record that's about to be erased.
  update access_grants set status = 'revoked', revoked_at = now() where patient_id = my_patient_id() and status = 'active';
  perform _audit(my_patient_id(), _actor(), 'deletion_requested', jsonb_build_object('type', 'account', 'label', 'Erase on ' || to_char(d.erase_after at time zone 'Asia/Kolkata', 'DD Mon YYYY')));
  insert into notifications (user_id, kind, title, body, link) values (auth.uid(), 'security', 'Account deletion scheduled',
    'Your account and record will be erased on ' || to_char(d.erase_after at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '. You can cancel until then in Privacy & security.', '/app/privacy');
  return _deletion_json(d);
end $$;

create or replace function public.cancel_deletion() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update deletion_requests set status = 'cancelled' where user_id = auth.uid() and status = 'pending';
  if not found then perform fail('NOT_FOUND', 'There’s no deletion to cancel.'); end if;
  perform _audit(my_patient_id(), _actor(), 'deletion_cancelled', '{"type":"account","label":"Deletion cancelled"}');
end $$;

create or replace function public.my_deletion_request() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select _deletion_json(d) from deletion_requests d where d.user_id = auth.uid() and d.status = 'pending'
$$;

-- For the process-deletions Edge Function (service role): who is due, and their document folder.
create or replace function public._due_deletions() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('requestId', d.id, 'userId', d.user_id, 'patientId', p.id)), '[]'::jsonb)
  from deletion_requests d left join patients p on p.user_id = d.user_id
  where d.status = 'pending' and d.erase_after <= now()
$$;

-- Erases everything about the person. Grievances are kept, without the link to them.
create or replace function public._erase_account(p_request text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d deletion_requests;
begin
  select * into d from deletion_requests where id = p_request and status = 'pending' and erase_after <= now() for update;
  if d.id is null then perform fail('NOT_FOUND', 'No deletion is due for this request.'); end if;
  perform set_config('niveda.allow_erasure', 'on', true);
  delete from auth.users where id = d.user_id;
  perform set_config('niveda.allow_erasure', 'off', true);
end $$;

/* ---------- grievances ---------- */

create or replace function public._grievance_json(g grievances) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', g.id, 'reference', g.reference, 'category', g.category, 'description', g.description,
    'status', g.status, 'createdAt', g.created_at, 'respondBy', g.respond_by, 'response', g.response, 'resolvedAt', g.resolved_at)
$$;

create or replace function public.file_grievance(p_category text, p_description text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g grievances; ref text;
begin
  if auth.uid() is null then perform fail('NOT_SIGNED_IN', 'Please sign in to continue.'); end if;
  if length(trim(coalesce(p_description, ''))) < 10 then perform fail('VALIDATION', 'Tell us a little more (at least 10 characters).'); end if;
  if (select count(*) from grievances where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    perform fail('VALIDATION', 'You’ve raised several grievances today. We’ll respond to those first.');
  end if;
  loop
    ref := 'NV-GRV-' || to_char(now(), 'YYMM') || '-' || lpad((floor(random() * 100000))::int::text, 5, '0');
    exit when not exists (select 1 from grievances where reference = ref);
  end loop;
  insert into grievances (user_id, reference, category, description, respond_by)
  values (auth.uid(), ref, p_category, trim(p_description), now() + interval '90 days') returning * into g;
  perform _audit(my_patient_id(), _actor(), 'grievance_filed', jsonb_build_object('type', 'grievance', 'id', g.id, 'label', ref));
  return _grievance_json(g);
end $$;

create or replace function public.my_grievances() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(_grievance_json(g) order by g.created_at desc), '[]'::jsonb) from grievances g where g.user_id = auth.uid()
$$;

create or replace function public.admin_grievances(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then perform fail('ACCESS_DENIED', 'Only the Niveda team can see grievances.'); end if;
  return coalesce((select jsonb_agg(_grievance_json(g) order by (g.status = 'resolved'), g.respond_by) from grievances g
    where p_status is null or g.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.admin_respond_grievance(p_id text, p_status text, p_response text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g grievances;
begin
  if not is_admin() then perform fail('ACCESS_DENIED', 'Only the Niveda team can answer grievances.'); end if;
  if p_status not in ('in_progress', 'resolved') then perform fail('VALIDATION', 'Choose in progress or resolved.'); end if;
  if p_status = 'resolved' and length(trim(coalesce(p_response, ''))) < 10 then perform fail('VALIDATION', 'Write the response the person will see.'); end if;
  update grievances set status = p_status, response = nullif(trim(coalesce(p_response, '')), ''), handled_by = auth.uid(),
    resolved_at = case when p_status = 'resolved' then now() end
  where id = p_id returning * into g;
  if g.id is null then perform fail('NOT_FOUND', 'Grievance not found.'); end if;
  if g.user_id is not null then
    insert into notifications (user_id, kind, title, body, link) values (g.user_id, 'security',
      case when p_status = 'resolved' then 'Your grievance was answered' else 'We’re working on your grievance' end,
      g.reference || ': ' || coalesce(left(g.response, 200), 'The Niveda team is looking into it.'), '/app/privacy');
  end if;
end $$;

/* ---------- privileges ---------- */

revoke execute on function public._set_med_alarms(uuid, boolean), public._consent_json(consents), public._signup_consents(uuid, jsonb), public._deletion_json(deletion_requests),
  public._due_deletions(), public._erase_account(text), public._grievance_json(grievances) from public, anon, authenticated;
grant execute on function public._due_deletions(), public._erase_account(text) to service_role;
revoke execute on function public.record_consent(text, boolean, text), public.my_consents(), public.set_nominee(jsonb),
  public.request_deletion(text), public.cancel_deletion(), public.my_deletion_request(), public.file_grievance(text, text),
  public.my_grievances(), public.admin_grievances(text), public.admin_respond_grievance(text, text, text) from public, anon;
grant execute on function public.record_consent(text, boolean, text), public.my_consents(), public.set_nominee(jsonb),
  public.request_deletion(text), public.cancel_deletion(), public.my_deletion_request(), public.file_grievance(text, text),
  public.my_grievances(), public.admin_grievances(text), public.admin_respond_grievance(text, text, text) to authenticated;

/* ---------- daily erasure job ---------- */

-- select public.configure_deletions('https://<project>.supabase.co/functions/v1/process-deletions', '<CRON_SECRET>');
create or replace function public.configure_deletions(p_function_url text, p_secret text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(p_function_url, '') !~ '^https?://' or length(coalesce(p_secret, '')) < 16 then
    perform fail('VALIDATION', 'Give the process-deletions function URL and a secret of at least 16 characters.');
  end if;
  create extension if not exists pg_net;
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'niveda-process-deletions';
  perform cron.schedule('niveda-process-deletions', '17 * * * *', format(
    'select net.http_post(url := %L, headers := jsonb_build_object(%L, %L, %L, %L), body := %L::jsonb)',
    p_function_url, 'content-type', 'application/json', 'x-niveda-cron', p_secret, '{}'));
  return 'Account deletions will be processed every hour.';
end $$;
revoke execute on function public.configure_deletions(text, text) from public, anon, authenticated;
