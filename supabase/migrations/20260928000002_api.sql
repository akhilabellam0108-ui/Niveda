-- Niveda — server API
--
-- Every change to the record happens here, inside the database, in one
-- transaction: check who is asking, check their access, write the data with
-- attribution taken from the session (never from the request), write the audit
-- log and notify the other party. The browser can't skip any of these steps.
--
-- Functions starting with "_" are internal and can't be called by users (see
-- the privileges section at the end of the last migration).

/* ================================================================== */
/* Internal helpers                                                    */
/* ================================================================== */

create or replace function public._actor() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p patients; d doctors; h text;
begin
  select * into p from patients where user_id = auth.uid();
  if found then return jsonb_build_object('id', p.id, 'role', 'patient', 'name', p.full_name); end if;
  select * into d from doctors where user_id = auth.uid();
  if found then
    select name into h from hospitals where id = d.hospital_id;
    return jsonb_strip_nulls(jsonb_build_object('id', d.id, 'role', 'doctor', 'name', d.full_name, 'organization', h));
  end if;
  perform fail('NOT_SIGNED_IN', 'Please sign in to continue.');
end $$;

create or replace function public._system_actor() returns jsonb
language sql immutable as $$ select '{"id":"system","role":"system","name":"Niveda"}'::jsonb $$;

create or replace function public._require_patient() returns patients
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p patients;
begin
  select * into p from patients where user_id = auth.uid();
  if not found then perform fail('ACCESS_DENIED', 'This area isn’t available for your account.'); end if;
  return p;
end $$;

create or replace function public._require_doctor() returns doctors
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d doctors;
begin
  select * into d from doctors where user_id = auth.uid();
  if not found then perform fail('ACCESS_DENIED', 'This area isn’t available for your account.'); end if;
  return d;
end $$;

create or replace function public._patient_user(p text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$ select user_id from patients where id = p $$;
create or replace function public._doctor_user(d text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$ select user_id from doctors where id = d $$;

create or replace function public._perm_label(k text) returns text
language sql immutable as $$
  select case k when 'history' then 'Medical history' when 'medications' then 'Medications' when 'allergies' then 'Allergies'
    when 'labs' then 'Lab reports' when 'imaging' then 'Imaging' when 'surgeries' then 'Surgeries & procedures'
    when 'vaccinations' then 'Vaccinations' when 'mental_health' then 'Mental-health records'
    when 'sensitive' then 'Other sensitive records' else k end
$$;

create or replace function public._perm_labels(ks text[]) returns jsonb
language sql immutable as $$ select coalesce(jsonb_agg(public._perm_label(k)), '[]'::jsonb) from unnest(ks) k $$;

create or replace function public._duration_label(h int) returns text
language sql immutable as $$
  select case h when 1 then '1 hour' when 24 then '24 hours' when 72 then '3 days' when 168 then '7 days'
    else case when h % 24 = 0 then (h / 24) || ' days' else h || ' hours' end end
$$;

create or replace function public._a_or_an(w text) returns text
language sql immutable as $$ select case when w ~* '^[aeiou]' then 'an ' else 'a ' end || w $$;

create or replace function public._record_title(r records) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(trim(r.data ->> rt.title_key), ''), rt.label) from record_types rt where rt.type = r.type
$$;

create or replace function public._record_label(r records) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select rt.label || ': ' || public._record_title(r) from record_types rt where rt.type = r.type
$$;

create or replace function public._audit(p_patient text, p_actor jsonb, p_action text, p_target jsonb,
  p_metadata jsonb default null, p_at timestamptz default now()) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into audit_log (patient_id, actor, action, target, metadata, at)
  values (p_patient, p_actor, p_action, p_target, p_metadata, p_at)
$$;

-- Respects the recipient's notification settings.
create or replace function public._notify(p_user uuid, p_kind text, p_title text, p_body text,
  p_link text default null, p_at timestamptz default now()) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare prefs jsonb;
begin
  if p_user is null then return; end if;
  select pr.prefs into prefs from preferences pr where pr.user_id = p_user;
  prefs := coalesce(prefs, '{}');
  if p_kind = 'record' and prefs ->> 'notifyRecords' = 'false' then return; end if;
  if p_kind in ('access', 'request') and prefs ->> 'notifyAccess' = 'false' then return; end if;
  if p_kind = 'reminder' and prefs ->> 'notifyReminders' = 'false' then return; end if;
  insert into notifications (user_id, kind, title, body, link, created_at) values (p_user, p_kind, p_title, p_body, p_link, p_at);
end $$;

create or replace function public._recently_logged(p_actor text, p_action text, p_target text, p_patient text, p_minutes int) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from audit_log a where a.actor ->> 'id' = p_actor and a.action = p_action and a.patient_id = p_patient
    and coalesce(a.target ->> 'id', '') = coalesce(p_target, '') and a.at > now() - make_interval(mins => p_minutes))
$$;

/* ---------- grant expiry (also run every 5 minutes by pg_cron) ---------- */

create or replace function public._sweep_grants(p_patient text default null, p_doctor text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g access_grants; dname text; pname text;
begin
  for g in select * from access_grants
           where status = 'active' and (p_patient is null or patient_id = p_patient) and (p_doctor is null or doctor_id = p_doctor)
           for update skip locked loop
    select full_name into dname from doctors where id = g.doctor_id;
    select full_name into pname from patients where id = g.patient_id;
    if g.expires_at <= now() then
      update access_grants set status = 'expired', expiry_logged = true where id = g.id;
      if not g.expiry_logged then
        perform _audit(g.patient_id, _system_actor(), 'access_expired', jsonb_build_object('type', 'doctor', 'id', g.doctor_id, 'label', dname), null, g.expires_at);
        perform _notify(_patient_user(g.patient_id), 'access', 'Access expired', dname || ' can no longer see your records.', '/app/access?tab=history', g.expires_at);
        perform _notify(_doctor_user(g.doctor_id), 'access', 'Access ended', 'Your access to ' || pname || '’s records has expired.', null, g.expires_at);
      end if;
    elsif not g.reminder_sent and g.expires_at - now() < interval '24 hours' then
      update access_grants set reminder_sent = true where id = g.id;
      perform _notify(_patient_user(g.patient_id), 'reminder', 'Access ends soon', dname || '’s access to your records ends within 24 hours.', '/app/access');
    end if;
  end loop;
end $$;

create or replace function public._require_grant(p_patient text, p_perm text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _sweep_grants(p_patient, my_doctor_id());
  if not has_grant(p_patient) then
    perform fail('ACCESS_DENIED', 'You no longer have access to this patient’s records. Ask the patient to grant access again.');
  end if;
  if p_perm is not null and not has_grant(p_patient, p_perm) then
    perform fail('ACCESS_DENIED', 'The patient hasn’t shared this part of their record with you.');
  end if;
end $$;

/* ---------- step-up verification ---------- */

-- Sensitive actions need a fresh one-time code. Supabase records how a session
-- was created in the token's "amr" claim; a code verified in the last 10
-- minutes counts once, then it's spent.
create or replace function public._require_step_up() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare ts bigint; sid uuid;
begin
  select max((a ->> 'timestamp')::bigint) into ts
  from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
  where a ->> 'method' in ('otp', 'magiclink', 'email/signup');
  if ts is null or to_timestamp(ts) < now() - interval '10 minutes' then
    perform fail('OTP_EXPIRED', 'Please confirm with the code we email you, then try again.');
  end if;
  sid := coalesce(nullif(auth.jwt() ->> 'session_id', '')::uuid, '00000000-0000-0000-0000-000000000000');
  insert into step_up_uses (session_id, verified_at) values (sid, ts) on conflict do nothing;
  if not found then perform fail('OTP_EXPIRED', 'That code has already been used. Request a new one.'); end if;
end $$;

/* ---------- record building ---------- */

-- Keeps only known fields with scalar, non-empty values (strings trimmed).
create or replace function public._clean_data(p_type text, p_data jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(e.key, case when jsonb_typeof(e.value) = 'string' then to_jsonb(trim(e.value #>> '{}')) else e.value end), '{}'::jsonb)
  from record_types rt, jsonb_each(coalesce(p_data, '{}'::jsonb)) e
  where rt.type = p_type
    and (e.key = any (rt.field_keys) or e.key in ('medStatus', 'discontinuedOn', 'discontinueReason', 'resultRecordId', 'orderRecordId'))
    and jsonb_typeof(e.value) in ('string', 'number')
    and not (jsonb_typeof(e.value) = 'string' and trim(e.value #>> '{}') = '')
$$;

create or replace function public._validate_data(p_type text, p_data jsonb) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare missing text[];
begin
  select array_agg(k) into missing from record_types rt, unnest(rt.required_keys) k
  where rt.type = p_type and not (p_data ? k);
  if missing is not null then perform fail('VALIDATION', 'Please fill in the required fields (' || array_to_string(missing, ', ') || ').'); end if;
end $$;

create or replace function public._assert_can_write(p_patient text, p_type text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare rt record_types; me_patient text := my_patient_id(); me_doctor text := my_doctor_id();
begin
  select * into rt from record_types where type = p_type;
  if not found then perform fail('VALIDATION', 'Unknown kind of record.'); end if;
  if me_patient is not null then
    if p_patient is distinct from me_patient then perform fail('ACCESS_DENIED', 'You can only add to your own record.'); end if;
    if not rt.patient_can_add then perform fail('VALIDATION', rt.label || ' entries are added by your doctor.'); end if;
  elsif me_doctor is not null then
    if not rt.doctor_can_add then perform fail('VALIDATION', rt.label || ' entries can only be added by the patient.'); end if;
    perform _require_grant(p_patient, rt.permission);
  else
    perform fail('NOT_SIGNED_IN', 'Please sign in to continue.');
  end if;
end $$;

-- Inserts an entry and its first version. Attribution comes from the session.
create or replace function public._insert_record(p_patient text, p_type text, p_date date, p_data jsonb, p_parent text default null)
returns records
language plpgsql security definer set search_path = public, pg_temp as $$
declare r records; clean jsonb; actor jsonb := _actor(); org jsonb;
begin
  clean := _clean_data(p_type, p_data);
  perform _validate_data(p_type, clean);
  if p_date is null then perform fail('VALIDATION', 'Date is required.'); end if;
  if p_date > current_date + 366 then perform fail('VALIDATION', 'That date is too far in the future.'); end if;
  if p_parent is not null and not exists (select 1 from records where id = p_parent and patient_id = p_patient) then
    perform fail('NOT_FOUND', 'The entry this belongs to could not be found.');
  end if;
  if actor ->> 'role' = 'doctor' then
    select jsonb_build_object('id', h.id, 'name', h.name) into org from doctors d join hospitals h on h.id = d.hospital_id where d.id = actor ->> 'id';
  end if;
  insert into records (patient_id, type, date, data, created_by, organization, parent_id, source)
  values (p_patient, p_type, p_date, clean, actor, org, p_parent, case when actor ->> 'role' = 'doctor' then 'doctor' else 'patient' end)
  returning * into r;
  insert into record_versions (record_id, version, date, data, changed_at, changed_by, change_type)
  values (r.id, 1, r.date, r.data, r.created_at, actor, 'created');
  return r;
end $$;

create or replace function public._push_version(p_id text, p_change text, p_data jsonb, p_date date, p_reason text) returns records
language plpgsql security definer set search_path = public, pg_temp as $$
declare r records; actor jsonb := _actor();
begin
  update records set version = version + 1, data = p_data, date = p_date, updated_at = now() where id = p_id returning * into r;
  insert into record_versions (record_id, version, date, data, changed_by, change_type, reason)
  values (r.id, r.version, p_date, p_data, actor, p_change, p_reason);
  return r;
end $$;

create or replace function public._sync_attachments(p_record text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update records set attachments = array(select d.id from documents d where d.record_id = p_record order by d.uploaded_at, d.id) where id = p_record
$$;

create or replace function public._link_docs(p_record text, p_docs text[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; old_records text[];
begin
  if p_docs is null or cardinality(p_docs) = 0 then return 0; end if;
  select array_agg(distinct record_id) into old_records from documents where id = any (p_docs) and record_id is not null;
  update documents set record_id = p_record
  where id = any (p_docs) and patient_id = (select patient_id from records where id = p_record);
  get diagnostics n = row_count;
  perform _sync_attachments(x) from unnest(coalesce(old_records, '{}') || p_record) x;
  return n;
end $$;

create or replace function public._default_times(freq text) returns text[]
language sql immutable as $$
  select case freq when 'Once daily' then array['08:00'] when 'Twice daily' then array['08:00', '20:00']
    when 'Three times daily' then array['08:00', '14:00', '20:00'] when 'Four times daily' then array['08:00', '12:00', '16:00', '20:00']
    when 'Every night' then array['21:00'] when 'Weekly' then array['09:00'] else array[]::text[] end
$$;

create or replace function public._normalise_times(ts text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct t order by t), '{}') from (select trim(x) t from unnest(coalesce(ts, '{}')) x) s
  where t ~ '^([01]\d|2[0-3]):[0-5]\d$'
$$;

create or replace function public._ensure_reminder(r records, p_times text[] default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t text[];
begin
  if r.type <> 'medication' or exists (select 1 from medication_reminders where record_id = r.id) then return; end if;
  t := _normalise_times(coalesce(p_times, _default_times(r.data ->> 'frequency')));
  insert into medication_reminders (record_id, patient_id, times, enabled) values (r.id, r.patient_id, t, cardinality(t) > 0);
end $$;

create or replace function public._log_added(p_ids text[], p_headline text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r records; actor jsonb := _actor(); first_rec records; rt_label text;
begin
  for r in select * from records where id = any (p_ids) order by array_position(p_ids, id) loop
    if first_rec.id is null then first_rec := r; end if;
    perform _audit(r.patient_id, actor, 'record_added',
      jsonb_build_object('type', r.type, 'id', r.id, 'label', _record_label(r)),
      jsonb_build_object('recordDate', r.date) || case when cardinality(r.attachments) > 0 then jsonb_build_object('attachments', cardinality(r.attachments)) else '{}'::jsonb end);
  end loop;
  if actor ->> 'role' = 'doctor' and first_rec.id is not null then
    select label into rt_label from record_types where type = first_rec.type;
    perform _notify(_patient_user(first_rec.patient_id), 'record', 'New entry in your record',
      coalesce(p_headline, (actor ->> 'name') || ' added ' || _a_or_an(lower(rt_label)) || ' to your medical record.'),
      '/app/timeline?record=' || first_rec.id);
  end if;
end $$;

/* ================================================================== */
/* Accounts and sessions                                               */
/* ================================================================== */

-- The signed-in user, shaped like the app's User type.
create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', a.user_id, 'role', a.role, 'onboarded', a.onboarded, 'createdAt', a.created_at,
    'profileId', coalesce(p.id, d.id), 'email', coalesce(p.email, d.email, u.email), 'phone', coalesce(p.phone, d.phone, ''))
  from accounts a
  join auth.users u on u.id = a.user_id
  left join patients p on p.user_id = a.user_id
  left join doctors d on d.user_id = a.user_id
  where a.user_id = auth.uid()
$$;

-- Called once the email code from sign-up is verified. Creates the patient's
-- profile from the details given at sign-up. Safe to call again.
create or replace function public.complete_signup() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare meta jsonb; v_email text; v_code text; v_pid text; v_name text; v_dob date; v_phone text;
begin
  if auth.uid() is null then perform fail('NOT_SIGNED_IN', 'Please sign in to continue.'); end if;
  if exists (select 1 from accounts where user_id = auth.uid()) then return my_account(); end if;
  select raw_user_meta_data, email into meta, v_email from auth.users where id = auth.uid();
  v_name := trim(coalesce(meta ->> 'full_name', ''));
  v_phone := trim(coalesce(meta ->> 'phone', ''));
  begin v_dob := (meta ->> 'date_of_birth')::date; exception when others then v_dob := null; end;
  if v_name = '' or v_dob is null or length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then
    perform fail('VALIDATION', 'Your sign-up details are incomplete. Please sign up again.');
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
  insert into notifications (user_id, kind, title, body, link) values (auth.uid(), 'security', 'Welcome to Niveda',
    'Your record is private by default. Only doctors you grant access to can see it, and every view is logged.', '/app/privacy');
  return my_account();
end $$;

create or replace function public.log_session_event(p_action text, p_device text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_action not in ('signed_in', 'signed_out') then perform fail('VALIDATION', 'Unknown event.'); end if;
  perform _audit(my_patient_id(), _actor(), p_action,
    jsonb_build_object('type', 'session', 'id', auth.jwt() ->> 'session_id', 'label', left(coalesce(p_device, 'Unknown device'), 80)));
end $$;

create or replace function public.log_password_changed(p_label text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _audit(my_patient_id(), _actor(), 'password_changed', jsonb_build_object('type', 'account', 'label', left(coalesce(p_label, 'Password changed'), 80)));
end $$;

create or replace function public.list_my_sessions() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'createdAt', s.created_at, 'lastActiveAt', coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
      'expiresAt', coalesce(s.not_after, s.created_at + interval '30 days'), 'userAgent', s.user_agent, 'ip', host(s.ip),
      'current', s.id::text = auth.jwt() ->> 'session_id')
    order by (s.id::text = auth.jwt() ->> 'session_id') desc, coalesce(s.refreshed_at::timestamptz, s.updated_at) desc), '[]'::jsonb)
  from auth.sessions s where s.user_id = auth.uid()
$$;

create or replace function public.revoke_session(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_id::text = auth.jwt() ->> 'session_id' then perform fail('VALIDATION', 'Use “Log out” to end this session.'); end if;
  delete from auth.sessions where id = p_id and user_id = auth.uid();
  if found then
    perform _audit(my_patient_id(), _actor(), 'sessions_revoked', jsonb_build_object('type', 'session', 'id', p_id, 'label', 'Signed out a device'));
  end if;
end $$;

-- Signs out every other device (their refresh tokens stop working at once).
create or replace function public.revoke_other_sessions() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  delete from auth.sessions where user_id = auth.uid() and id::text is distinct from auth.jwt() ->> 'session_id';
  get diagnostics n = row_count;
  perform _audit(my_patient_id(), _actor(), 'sessions_revoked',
    jsonb_build_object('type', 'session', 'label', 'Signed out ' || n || ' other device' || case when n = 1 then '' else 's' end));
  return n;
end $$;

/* ================================================================== */
/* Patient profile and onboarding                                      */
/* ================================================================== */

create or replace function public._valid_contact(c jsonb) returns boolean
language sql immutable as $$
  select c is not null and jsonb_typeof(c) = 'object'
    and coalesce(trim(c ->> 'name'), '') <> '' and coalesce(trim(c ->> 'relationship'), '') <> ''
    and length(regexp_replace(coalesce(c ->> 'phone', ''), '\D', '', 'g')) >= 10
$$;

-- Email is changed through sign-in settings (it must be re-verified), not here.
create or replace function public.update_patient_profile(p_patch jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p patients := _require_patient();
begin
  if p_patch ? 'fullName' and coalesce(trim(p_patch ->> 'fullName'), '') = '' then perform fail('VALIDATION', 'Name can’t be empty.'); end if;
  if p_patch ? 'emergencyContact' and not _valid_contact(p_patch -> 'emergencyContact') then
    perform fail('VALIDATION', 'An emergency contact with name, relationship and a valid phone number is required.');
  end if;
  if p_patch ? 'phone' and length(regexp_replace(coalesce(p_patch ->> 'phone', ''), '\D', '', 'g')) < 10 then
    perform fail('VALIDATION', 'Enter a valid phone number.');
  end if;
  update patients set
    full_name = case when p_patch ? 'fullName' then trim(p_patch ->> 'fullName') else full_name end,
    phone = case when p_patch ? 'phone' then trim(p_patch ->> 'phone') else phone end,
    date_of_birth = case when p_patch ? 'dateOfBirth' then (p_patch ->> 'dateOfBirth')::date else date_of_birth end,
    blood_group = case when p_patch ? 'bloodGroup' then nullif(p_patch ->> 'bloodGroup', '') else blood_group end,
    photo_data_url = case when p_patch ? 'photoDataUrl' then nullif(p_patch ->> 'photoDataUrl', '') else photo_data_url end,
    emergency_contact = case when p_patch ? 'emergencyContact' then p_patch -> 'emergencyContact' else emergency_contact end,
    important_notes = case when p_patch ? 'importantNotes' then nullif(trim(p_patch ->> 'importantNotes'), '') else important_notes end,
    sex = case when p_patch ? 'sex' then coalesce(p_patch ->> 'sex', '') else sex end,
    emergency_card_enabled = case when p_patch ? 'emergencyCardEnabled' then (p_patch ->> 'emergencyCardEnabled')::boolean else emergency_card_enabled end
  where id = p.id;
end $$;

-- Turns the compulsory setup answers into entries in one transaction. Every
-- section must be answered (entries, or an explicit "none"), and at least one
-- medical document must already be uploaded (register_document).
create or replace function public.complete_onboarding(p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me patients := _require_patient();
  ids jsonb := '{}'; r records; item jsonb; i int; doc jsonb; added text[] := '{}';
  sections text[][] := array[['allergies', 'noAllergies', 'allergies'], ['conditions', 'noConditions', 'ongoing conditions'],
                             ['medications', 'noMedications', 'current medicines'], ['history', 'noHistory', 'past surgeries or hospital stays']];
  s text[];
begin
  if exists (select 1 from accounts where user_id = auth.uid() and onboarded) then perform fail('CONFLICT', 'Your record is already set up.'); end if;
  if coalesce(p ->> 'bloodGroup', '') = '' then perform fail('VALIDATION', 'Choose your blood group (or “Not sure”).'); end if;
  if not _valid_contact(p -> 'emergencyContact') then perform fail('VALIDATION', 'Add an emergency contact with name, relationship and phone.'); end if;
  foreach s slice 1 in array sections loop
    if jsonb_array_length(coalesce(p -> s[1], '[]')) = 0 and not coalesce((p ->> s[2])::boolean, false) then
      perform fail('VALIDATION', 'Add your ' || s[3] || ', or confirm you have none.');
    end if;
    if jsonb_array_length(coalesce(p -> s[1], '[]')) > 0 and coalesce((p ->> s[2])::boolean, false) then
      perform fail('VALIDATION', 'You added ' || s[3] || ' but also ticked “none”. Remove one.');
    end if;
  end loop;
  if jsonb_array_length(coalesce(p -> 'documents', '[]')) = 0 then
    perform fail('VALIDATION', 'Upload at least one medical document — a lab report, prescription, scan or discharge summary.');
  end if;

  for item, i in select value, ordinality - 1 from jsonb_array_elements(p -> 'allergies') with ordinality loop
    r := _insert_record(me.id, 'allergy', current_date, item || '{"notes":"Added during account setup"}');
    ids := ids || jsonb_build_object('allergy:' || i, r.id); added := added || r.id;
  end loop;
  for item, i in select value, ordinality - 1 from jsonb_array_elements(p -> 'conditions') with ordinality loop
    r := _insert_record(me.id, 'diagnosis', coalesce(nullif(item ->> 'since', '')::date, current_date),
      jsonb_build_object('condition', item ->> 'condition', 'status', 'Active', 'notes', 'Added during account setup'));
    ids := ids || jsonb_build_object('condition:' || i, r.id); added := added || r.id;
  end loop;
  for item, i in select value, ordinality - 1 from jsonb_array_elements(p -> 'medications') with ordinality loop
    if item ->> 'frequency' <> 'As needed' and jsonb_array_length(coalesce(item -> 'times', '[]')) = 0 then
      perform fail('VALIDATION', 'Set at least one reminder time for each regular medicine.');
    end if;
    r := _insert_record(me.id, 'medication', current_date, jsonb_build_object('name', item ->> 'name', 'dosage', item ->> 'dosage', 'frequency', item ->> 'frequency'));
    perform _ensure_reminder(r, array(select jsonb_array_elements_text(coalesce(item -> 'times', '[]'))));
    ids := ids || jsonb_build_object('medication:' || i, r.id); added := added || r.id;
  end loop;
  for item, i in select value, ordinality - 1 from jsonb_array_elements(p -> 'history') with ordinality loop
    if coalesce(item ->> 'date', '') = '' or coalesce(trim(item ->> 'hospital'), '') = '' then
      perform fail('VALIDATION', 'Each surgery or hospital stay needs what it was, the date and the hospital.');
    end if;
    if item ->> 'kind' = 'surgery' then
      r := _insert_record(me.id, 'surgery', (item ->> 'date')::date, jsonb_build_object('procedure', item ->> 'name', 'facility', item ->> 'hospital'));
    else
      r := _insert_record(me.id, 'hospitalization', (item ->> 'date')::date, jsonb_build_object('reason', item ->> 'name', 'facility', item ->> 'hospital'));
    end if;
    ids := ids || jsonb_build_object('history:' || i, r.id); added := added || r.id;
  end loop;

  for doc in select value from jsonb_array_elements(p -> 'documents') loop
    if not exists (select 1 from documents where id = doc ->> 'documentId' and patient_id = me.id) then
      perform fail('NOT_FOUND', 'One of your uploaded documents could not be found. Please upload it again.');
    end if;
    if coalesce(doc ->> 'linkTo', '') <> '' and ids ? (doc ->> 'linkTo') then
      perform _link_docs(ids ->> (doc ->> 'linkTo'), array[doc ->> 'documentId']);
    end if;
  end loop;

  perform _log_added(added);
  update patients set
    photo_data_url = coalesce(nullif(p ->> 'photoDataUrl', ''), photo_data_url),
    blood_group = case when p ->> 'bloodGroup' = 'Unknown' then null else p ->> 'bloodGroup' end,
    emergency_contact = jsonb_build_object('name', trim(p -> 'emergencyContact' ->> 'name'), 'relationship', trim(p -> 'emergencyContact' ->> 'relationship'), 'phone', trim(p -> 'emergencyContact' ->> 'phone')),
    emergency_card_enabled = true,
    important_notes = coalesce(nullif(trim(p ->> 'importantNotes'), ''), important_notes),
    declarations = jsonb_strip_nulls(jsonb_build_object(
      'noAllergies', nullif(coalesce((p ->> 'noAllergies')::boolean, false), false),
      'noConditions', nullif(coalesce((p ->> 'noConditions')::boolean, false), false),
      'noMedications', nullif(coalesce((p ->> 'noMedications')::boolean, false), false),
      'noSurgeries', nullif(coalesce((p ->> 'noHistory')::boolean, false), false),
      'confirmedAt', now()))
  where id = me.id;
  update accounts set onboarded = true where user_id = auth.uid();
end $$;

-- Blood group, allergies, current medicines and conditions. A doctor needs an
-- active grant (any category) and every view is logged.
create or replace function public.emergency_profile(p_patient text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pid text := coalesce(p_patient, my_patient_id()); pat patients; actor jsonb := _actor();
begin
  if pid is null then perform fail('VALIDATION', 'Choose a patient.'); end if;
  if actor ->> 'role' = 'patient' and pid <> my_patient_id() then perform fail('ACCESS_DENIED', 'You can only view your own record.'); end if;
  if actor ->> 'role' = 'doctor' then
    perform _require_grant(pid);
    if not _recently_logged(actor ->> 'id', 'emergency_viewed', null, pid, 10) then
      perform _audit(pid, actor, 'emergency_viewed', '{"type":"emergency","label":"Emergency profile"}');
    end if;
  end if;
  select * into pat from patients where id = pid;
  return jsonb_build_object(
    'patient', to_jsonb(pat) || case when actor ->> 'role' = 'doctor' then '{"email":""}'::jsonb else '{}'::jsonb end,
    'records', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('record_versions', '[]'::jsonb)) from records r
                          where r.patient_id = pid and r.type in ('allergy', 'medication', 'diagnosis')), '[]'::jsonb));
end $$;

/* ================================================================== */
/* Records                                                             */
/* ================================================================== */

create or replace function public.create_record(p_patient text, p_type text, p_date date, p_data jsonb,
  p_parent text default null, p_documents text[] default '{}', p_reminder_times text[] default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare pid text := coalesce(p_patient, my_patient_id()); r records;
begin
  if pid is null then perform fail('VALIDATION', 'Choose a patient.'); end if;
  perform _assert_can_write(pid, p_type);
  r := _insert_record(pid, p_type, p_date, p_data, p_parent);
  perform _link_docs(r.id, p_documents);
  perform _ensure_reminder(r, p_reminder_times);
  perform _log_added(array[r.id]);
  return r.id;
end $$;

-- The doctor's "Add to medical record": one visit becomes a consultation plus
-- linked diagnosis, prescriptions, lab orders and follow-up, all at once.
-- p_items: [{type, date, data}], the first must be the consultation.
create or replace function public.add_visit(p_patient text, p_items jsonb, p_documents text[] default '{}') returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d doctors := _require_doctor(); item jsonb; r records; consult records; ids text[] := '{}'; t text;
  n_rx int := 0; n_lab int := 0; has_dx boolean := false; n_docs int; parts text[] := array['a consultation']; list text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or p_items -> 0 ->> 'type' <> 'consultation' then
    perform fail('VALIDATION', 'A visit starts with the consultation.');
  end if;
  for t in select distinct value ->> 'type' from jsonb_array_elements(p_items) loop
    if t not in ('consultation', 'diagnosis', 'medication', 'lab_test', 'follow_up') then perform fail('VALIDATION', 'Unexpected entry in a visit.'); end if;
    perform _assert_can_write(p_patient, t);
  end loop;
  for item in select value from jsonb_array_elements(p_items) loop
    r := _insert_record(p_patient, item ->> 'type', (item ->> 'date')::date, item -> 'data', consult.id);
    if consult.id is null then consult := r; end if;
    perform _ensure_reminder(r);
    ids := ids || r.id;
    if r.type = 'medication' then n_rx := n_rx + 1; elsif r.type = 'lab_test' then n_lab := n_lab + 1; elsif r.type = 'diagnosis' then has_dx := true; end if;
  end loop;
  n_docs := _link_docs(consult.id, p_documents);
  if has_dx then parts := parts || 'a diagnosis'::text; end if;
  if n_rx > 0 then parts := parts || (n_rx || ' prescription' || case when n_rx > 1 then 's' else '' end); end if;
  if n_lab > 0 then parts := parts || (n_lab || ' lab order' || case when n_lab > 1 then 's' else '' end); end if;
  if n_docs > 0 then parts := parts || (n_docs || ' attachment' || case when n_docs > 1 then 's' else '' end); end if;
  list := case when cardinality(parts) > 1 then array_to_string(parts[1:cardinality(parts) - 1], ', ') || ' and ' || parts[cardinality(parts)] else parts[1] end;
  perform _log_added(ids, d.full_name || ' added ' || list || ' to your medical record.'
    || case when n_rx > 0 then ' Reminders are set for the new medicines — you can change the times in Medications.' else '' end);
  return ids;
end $$;

-- Corrections never overwrite history: the old version stays, the new one
-- records who changed what, when and why. Attribution is untouched.
create or replace function public.amend_record(p_id text, p_date date, p_data jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r records; nxt jsonb; changed text[]; actor jsonb := _actor(); internal jsonb;
begin
  if coalesce(trim(p_reason), '') = '' then perform fail('VALIDATION', 'Give a reason for the correction.'); end if;
  select * into r from records where id = p_id for update;
  if not found then perform fail('NOT_FOUND', 'This record could not be found.'); end if;
  if actor ->> 'role' = 'patient' then
    if r.patient_id <> my_patient_id() then perform fail('ACCESS_DENIED', 'You can only change your own record.'); end if;
    if r.created_by ->> 'role' = 'doctor' then
      perform fail('ACCESS_DENIED', 'Entries added by a doctor can only be corrected by a doctor. You can add a note as a new record.');
    end if;
  else
    perform _require_grant(r.patient_id, perm_for_type(r.type));
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}') into internal from jsonb_each(r.data)
  where key in ('medStatus', 'discontinuedOn', 'discontinueReason', 'resultRecordId', 'orderRecordId');
  nxt := _clean_data(r.type, coalesce(p_data, '{}') || internal);
  perform _validate_data(r.type, nxt);
  select array_agg(k order by k) into changed from (select jsonb_object_keys(r.data) k union select jsonb_object_keys(nxt)) keys
  where (r.data -> k) is distinct from (nxt -> k);
  if changed is null and p_date = r.date then perform fail('VALIDATION', 'Nothing has changed.'); end if;
  if p_date is distinct from r.date then changed := coalesce(changed, '{}') || 'date'::text; end if;
  r := _push_version(r.id, 'amended', nxt, coalesce(p_date, r.date), trim(p_reason));
  perform _audit(r.patient_id, actor, 'record_amended', jsonb_build_object('type', r.type, 'id', r.id, 'label', _record_label(r)),
    jsonb_build_object('reason', trim(p_reason), 'fields', to_jsonb(changed), 'version', r.version));
  if actor ->> 'role' = 'doctor' then
    perform _notify(_patient_user(r.patient_id), 'record', 'Record corrected',
      (actor ->> 'name') || ' amended “' || _record_title(r) || '”. The original is kept in its history.', '/app/timeline?record=' || r.id);
  end if;
end $$;

create or replace function public.discontinue_medication(p_id text, p_reason text, p_date date default current_date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r records; actor jsonb := _actor();
begin
  select * into r from records where id = p_id and type = 'medication' for update;
  if not found then perform fail('NOT_FOUND', 'Medication not found.'); end if;
  if actor ->> 'role' = 'patient' and r.patient_id <> my_patient_id() then perform fail('ACCESS_DENIED', 'You can only change your own record.'); end if;
  if actor ->> 'role' = 'doctor' then perform _require_grant(r.patient_id, 'medications'); end if;
  if r.data ->> 'medStatus' = 'discontinued' or (r.data ? 'endDate' and (r.data ->> 'endDate')::date < current_date) then
    perform fail('VALIDATION', 'This medication is already stopped.');
  end if;
  r := _push_version(r.id, 'discontinued',
    r.data || jsonb_build_object('medStatus', 'discontinued', 'discontinuedOn', p_date) || coalesce(jsonb_build_object('discontinueReason', nullif(trim(p_reason), '')), '{}') ,
    r.date, coalesce(nullif(trim(p_reason), ''), 'Stopped'));
  perform _audit(r.patient_id, actor, 'medication_discontinued', jsonb_build_object('type', 'medication', 'id', r.id, 'label', _record_title(r)),
    jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), '—'), 'date', to_char(p_date, 'FMDD Mon YYYY')));
  if actor ->> 'role' = 'doctor' then
    perform _notify(_patient_user(r.patient_id), 'record', 'Medication stopped', (actor ->> 'name') || ' stopped ' || _record_title(r) || '.', '/app/medications');
  end if;
end $$;

-- Adds the result for an ordered lab test and marks the order completed.
create or replace function public.add_lab_result(p_order text, p_data jsonb, p_date date, p_documents text[] default '{}') returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare o records; r records; actor jsonb := _actor();
begin
  select * into o from records where id = p_order and type = 'lab_test' for update;
  if not found then perform fail('NOT_FOUND', 'Lab order not found.'); end if;
  perform _assert_can_write(o.patient_id, 'lab_result');
  r := _insert_record(o.patient_id, 'lab_result', p_date,
    jsonb_strip_nulls(jsonb_build_object('laboratory', o.data ->> 'laboratory')) || coalesce(p_data, '{}')
      || jsonb_build_object('test', coalesce(nullif(p_data ->> 'test', ''), o.data ->> 'test')), p_order);
  perform _link_docs(r.id, p_documents);
  perform _push_version(o.id, 'result_added', o.data || jsonb_build_object('status', 'Completed', 'resultRecordId', r.id), o.date, 'Result added');
  select * into r from records where id = r.id;
  perform _log_added(array[r.id], (actor ->> 'name') || ' added your ' || _record_title(r) || ' result.');
  return r.id;
end $$;

create or replace function public.log_record_view(p_id text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r records; actor jsonb := _actor();
begin
  if actor ->> 'role' <> 'doctor' then return; end if;
  select * into r from records where id = p_id;
  if not found then return; end if;
  perform _require_grant(r.patient_id, perm_for_type(r.type));
  if not _recently_logged(actor ->> 'id', 'viewed_record', r.id, r.patient_id, 10) then
    perform _audit(r.patient_id, actor, 'viewed_record', jsonb_build_object('type', r.type, 'id', r.id, 'label', _record_label(r)));
  end if;
end $$;

create or replace function public.log_history_view(p_patient text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor jsonb := _actor();
begin
  perform _require_doctor();
  perform _require_grant(p_patient);
  if not _recently_logged(actor ->> 'id', 'viewed_history', null, p_patient, 30) then
    perform _audit(p_patient, actor, 'viewed_history', '{"type":"record","label":"Medical history"}');
  end if;
end $$;

/* ================================================================== */
/* Documents                                                           */
/* ================================================================== */

-- The file is uploaded to the private "documents" bucket first, at
-- "<patient id>/<document id>"; this then records it after checking access.
create or replace function public.register_document(p_patient text, p_id text, p_name text, p_mime text, p_size bigint,
  p_category text, p_date date, p_record text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare pid text := coalesce(p_patient, my_patient_id()); actor jsonb := _actor(); path text;
begin
  if pid is null then perform fail('VALIDATION', 'Choose a patient.'); end if;
  if p_id !~ '^doc_[a-z0-9]{8,32}$' then perform fail('VALIDATION', 'Invalid document id.'); end if;
  if p_size > 15 * 1024 * 1024 then perform fail('VALIDATION', p_name || ' is larger than 15 MB.'); end if;
  if p_mime not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'text/plain') and p_mime not like 'image/%' then
    perform fail('VALIDATION', p_name || ': use PDF, image or text files.');
  end if;
  if actor ->> 'role' = 'doctor' then perform _require_grant(pid, doc_perm(null, p_category));
  elsif pid <> my_patient_id() then perform fail('ACCESS_DENIED', 'You can only upload to your own record.'); end if;
  path := pid || '/' || p_id;
  if to_regclass('storage.objects') is not null
     and not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = path) then
    perform fail('NOT_FOUND', 'The file didn’t finish uploading. Please try again.');
  end if;
  insert into documents (id, patient_id, name, mime_type, size, category, date, uploaded_by, storage_path)
  values (p_id, pid, left(p_name, 200), p_mime, p_size, p_category, coalesce(p_date, current_date), actor, path);
  perform _audit(pid, actor, 'document_uploaded', jsonb_build_object('type', 'document', 'id', p_id, 'label', left(p_name, 200)));
  if p_record is not null then perform attach_document(p_id, p_record); end if;
  return p_id;
end $$;

create or replace function public.attach_document(p_doc text, p_record text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d documents; actor jsonb := _actor(); old text;
begin
  select * into d from documents where id = p_doc for update;
  if not found then perform fail('NOT_FOUND', 'Document not found.'); end if;
  if actor ->> 'role' = 'patient' and d.patient_id <> my_patient_id() then perform fail('ACCESS_DENIED', 'Not your document.'); end if;
  if actor ->> 'role' = 'doctor' then perform _require_grant(d.patient_id); end if;
  if p_record is not null and not exists (select 1 from records where id = p_record and patient_id = d.patient_id) then
    perform fail('NOT_FOUND', 'Record not found.');
  end if;
  old := d.record_id;
  update documents set record_id = p_record where id = p_doc;
  if old is not null then perform _sync_attachments(old); end if;
  if p_record is not null then perform _sync_attachments(p_record); end if;
end $$;

-- Patients can remove documents they uploaded; a doctor's documents stay with
-- the entry they belong to. Returns the storage path so the file can be deleted.
create or replace function public.delete_document(p_doc text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare d documents; me patients := _require_patient();
begin
  select * into d from documents where id = p_doc and patient_id = me.id for update;
  if not found then perform fail('NOT_FOUND', 'This document could not be found.'); end if;
  if d.uploaded_by ->> 'role' = 'doctor' then perform fail('ACCESS_DENIED', 'Documents added by a doctor stay with the record they belong to.'); end if;
  delete from documents where id = p_doc;
  if d.record_id is not null then perform _sync_attachments(d.record_id); end if;
  perform _audit(me.id, _actor(), 'document_deleted', jsonb_build_object('type', 'document', 'id', d.id, 'label', d.name));
  return d.storage_path;
end $$;

create or replace function public.log_document_view(p_doc text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d documents; actor jsonb := _actor();
begin
  if actor ->> 'role' <> 'doctor' then return; end if;
  select * into d from documents where id = p_doc;
  if not found then return; end if;
  perform _require_grant(d.patient_id, doc_perm(d.record_id, d.category));
  if not _recently_logged(actor ->> 'id', 'viewed_document', d.id, d.patient_id, 10) then
    perform _audit(d.patient_id, actor, 'viewed_document', jsonb_build_object('type', 'document', 'id', d.id, 'label', d.name));
  end if;
end $$;

/* ================================================================== */
/* Access: patient side                                                */
/* ================================================================== */

create or replace function public.sweep_my_grants() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if my_patient_id() is not null then perform _sweep_grants(my_patient_id(), null);
  elsif my_doctor_id() is not null then perform _sweep_grants(null, my_doctor_id()); end if;
end $$;

create or replace function public.find_doctor_by_code(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_row jsonb;
begin
  perform _require_patient();
  select to_jsonb(dd) into v_row from doctor_directory dd join doctors d on d.id = dd.id
  where replace(upper(d.access_code), '-', '') = replace(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), '-', '');
  if v_row is null then perform fail('NOT_FOUND', 'No doctor matches that code. Check it with your doctor.'); end if;
  return v_row;
end $$;

create or replace function public._create_grant(me patients, p_doctor text, p_permissions text[], p_hours int, p_method text, p_request text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare g access_grants; dname text; valid text[] := array['history','medications','allergies','labs','imaging','surgeries','vaccinations','mental_health','sensitive'];
  method_label text;
begin
  if p_permissions is null or cardinality(p_permissions) = 0 then perform fail('VALIDATION', 'Choose at least one part of your record to share.'); end if;
  if not p_permissions <@ valid then perform fail('VALIDATION', 'Unknown permission.'); end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 * 90 then perform fail('VALIDATION', 'Access can last between 1 hour and 90 days.'); end if;
  select full_name into dname from doctors where id = p_doctor;
  if dname is null then perform fail('NOT_FOUND', 'We couldn’t find that doctor.'); end if;
  -- One active grant per doctor: a new grant replaces the old one.
  update access_grants set status = 'revoked', revoked_at = now() where patient_id = me.id and doctor_id = p_doctor and status = 'active';
  insert into access_grants (patient_id, doctor_id, permissions, expires_at, method, verification, request_id)
  values (me.id, p_doctor, array(select distinct unnest(p_permissions)), now() + make_interval(hours => p_hours), p_method,
          jsonb_build_object('method', 'otp', 'verifiedAt', now()), p_request)
  returning * into g;
  method_label := case p_method when 'directory' then 'Doctor directory' when 'code' then 'Doctor access code' when 'qr' then 'QR code'
    when 'invite' then 'Invitation' else 'Approved request' end;
  perform _audit(me.id, jsonb_build_object('id', me.id, 'role', 'patient', 'name', me.full_name), 'access_granted',
    jsonb_build_object('type', 'doctor', 'id', p_doctor, 'label', dname),
    jsonb_build_object('permissions', _perm_labels(g.permissions), 'duration', _duration_label(p_hours), 'method', method_label));
  perform _notify(_doctor_user(p_doctor), 'access', 'Access granted',
    me.full_name || ' gave you access to their records for ' || _duration_label(p_hours) || '.', '/doctor/patients/' || me.id);
  return g.id;
end $$;

create or replace function public.grant_access(p_doctor text, p_permissions text[], p_hours int, p_method text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients := _require_patient();
begin
  if p_method not in ('directory', 'code', 'qr', 'invite') then perform fail('VALIDATION', 'Unknown way of granting access.'); end if;
  perform _require_step_up();
  return _create_grant(me, p_doctor, p_permissions, p_hours, p_method);
end $$;

-- Narrowing or keeping permissions needs no code; sharing more does.
create or replace function public.update_grant_permissions(p_grant text, p_permissions text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients := _require_patient(); g access_grants; dname text;
begin
  select * into g from access_grants where id = p_grant and patient_id = me.id for update;
  if not found or g.status <> 'active' or g.expires_at <= now() then perform fail('NOT_FOUND', 'This access is no longer active.'); end if;
  if p_permissions is null or cardinality(p_permissions) = 0 then perform fail('VALIDATION', 'Keep at least one permission, or revoke access instead.'); end if;
  if not p_permissions <@ array['history','medications','allergies','labs','imaging','surgeries','vaccinations','mental_health','sensitive'] then
    perform fail('VALIDATION', 'Unknown permission.');
  end if;
  if not p_permissions <@ g.permissions then perform _require_step_up(); end if;
  update access_grants set permissions = array(select distinct unnest(p_permissions)) where id = g.id;
  select full_name into dname from doctors where id = g.doctor_id;
  perform _audit(me.id, _actor(), 'access_changed', jsonb_build_object('type', 'doctor', 'id', g.doctor_id, 'label', dname),
    jsonb_build_object('added', _perm_labels(array(select unnest(p_permissions) except select unnest(g.permissions))),
                       'removed', _perm_labels(array(select unnest(g.permissions) except select unnest(p_permissions)))));
  perform _notify(_doctor_user(g.doctor_id), 'access', 'Permissions changed', me.full_name || ' changed what you can see.', '/doctor/patients/' || me.id);
end $$;

create or replace function public.revoke_grant(p_grant text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients := _require_patient(); g access_grants; dname text;
begin
  select * into g from access_grants where id = p_grant and patient_id = me.id for update;
  if not found or g.status <> 'active' then perform fail('NOT_FOUND', 'This access has already ended.'); end if;
  update access_grants set status = 'revoked', revoked_at = now() where id = g.id;
  select full_name into dname from doctors where id = g.doctor_id;
  perform _audit(me.id, _actor(), 'access_revoked', jsonb_build_object('type', 'doctor', 'id', g.doctor_id, 'label', dname));
  perform _notify(auth.uid(), 'access', 'Access revoked', dname || ' can no longer see your records.', '/app/access?tab=history');
  perform _notify(_doctor_user(g.doctor_id), 'access', 'Access revoked', me.full_name || ' ended your access to their records.');
end $$;

create or replace function public.approve_request(p_request text, p_permissions text[], p_hours int) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients := _require_patient(); rq access_requests; dname text;
begin
  perform _require_step_up();
  select * into rq from access_requests where id = p_request and patient_id = me.id for update;
  if not found or rq.status <> 'pending' then perform fail('NOT_FOUND', 'This request has already been answered.'); end if;
  update access_requests set status = 'approved', responded_at = now() where id = rq.id;
  select full_name into dname from doctors where id = rq.doctor_id;
  perform _audit(me.id, _actor(), 'request_approved', jsonb_build_object('type', 'request', 'id', rq.id, 'label', dname));
  return _create_grant(me, rq.doctor_id, p_permissions, p_hours, 'request', rq.id);
end $$;

create or replace function public.decline_request(p_request text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients := _require_patient(); rq access_requests; dname text;
begin
  select * into rq from access_requests where id = p_request and patient_id = me.id for update;
  if not found or rq.status <> 'pending' then perform fail('NOT_FOUND', 'This request has already been answered.'); end if;
  update access_requests set status = 'declined', responded_at = now() where id = rq.id;
  select full_name into dname from doctors where id = rq.doctor_id;
  perform _audit(me.id, _actor(), 'request_declined', jsonb_build_object('type', 'request', 'id', rq.id, 'label', dname));
  perform _notify(_doctor_user(rq.doctor_id), 'request', 'Request declined', me.full_name || ' declined your access request.');
end $$;

-- Records the invitation. Sending it (email/SMS) is a separate delivery step.
create or replace function public.invite_doctor(p_name text, p_contact text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients := _require_patient(); v_id text;
begin
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_contact), '') = '' then perform fail('VALIDATION', 'Enter the doctor’s name and email or phone.'); end if;
  insert into doctor_invites (patient_id, doctor_name, contact) values (me.id, trim(p_name), trim(p_contact)) returning doctor_invites.id into v_id;
  perform _audit(me.id, _actor(), 'invite_sent', jsonb_build_object('type', 'invite', 'id', v_id, 'label', trim(p_name)));
  return v_id;
end $$;

create or replace function public.cancel_invite(p_invite text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update doctor_invites set status = 'cancelled' where id = p_invite and patient_id = (_require_patient()).id;
end $$;

/* ================================================================== */
/* Access: doctor side                                                 */
/* ================================================================== */

create or replace function public._mask_name(n text) returns text
language sql immutable as $$
  select string_agg(case when length(w) <= 1 then w else left(w, 1) || repeat('•', least(5, length(w) - 1)) end, ' ')
  from regexp_split_to_table(trim(n), '\s+') w
$$;

-- Active grants, the latest ended grant per patient (names masked), and pending requests.
create or replace function public.doctor_access_overview() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare d doctors := _require_doctor();
begin
  perform _sweep_grants(null, d.id);
  return jsonb_build_object(
    'active', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object('patient', jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'patient_code', p.patient_code, 'date_of_birth', p.date_of_birth, 'blood_group', p.blood_group, 'sex', p.sex))
        order by g.granted_at desc)
      from access_grants g join patients p on p.id = g.patient_id
      where g.doctor_id = d.id and g.status = 'active' and g.expires_at > now()), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(x.j order by x.granted_at desc) from (
        select distinct on (g.patient_id) g.granted_at, to_jsonb(g) || jsonb_build_object('patient', jsonb_build_object(
          'id', p.id, 'full_name', _mask_name(p.full_name), 'patient_code', p.patient_code)) j
        from access_grants g join patients p on p.id = g.patient_id
        where g.doctor_id = d.id and (g.status <> 'active' or g.expires_at <= now())
          and not exists (select 1 from access_grants a where a.doctor_id = d.id and a.patient_id = g.patient_id and a.status = 'active' and a.expires_at > now())
        order by g.patient_id, g.granted_at desc) x), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('patient_name', _mask_name(p.full_name), 'patient_code', p.patient_code) order by r.created_at desc)
      from access_requests r join patients p on p.id = r.patient_id
      where r.doctor_id = d.id and r.status = 'pending'), '[]'::jsonb));
end $$;

-- Doctors look patients up by the ID the patient shares. Without access they
-- get only a masked name — enough to confirm, not to browse.
create or replace function public.lookup_patient(p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare d doctors := _require_doctor(); p patients; active boolean; pending boolean;
begin
  select * into p from patients where replace(patient_code, '-', '') = replace(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), '-', '');
  if not found then perform fail('NOT_FOUND', 'No patient matches that ID. Check the ID or ask the patient to show their QR code.'); end if;
  perform _sweep_grants(p.id, d.id);
  active := has_grant(p.id);
  pending := exists (select 1 from access_requests where doctor_id = d.id and patient_id = p.id and status = 'pending');
  return jsonb_build_object('patientId', p.id, 'patientCode', p.patient_code,
    'maskedName', case when active then p.full_name else _mask_name(p.full_name) end,
    'status', case when active then 'active' when pending then 'pending' else 'none' end);
end $$;

create or replace function public.request_access(p_patient text, p_permissions text[], p_hours int, p_reason text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare d doctors := _require_doctor(); v_id text; hname text; perms text;
begin
  if coalesce(trim(p_reason), '') = '' then perform fail('VALIDATION', 'Tell the patient why you need access.'); end if;
  if p_permissions is null or cardinality(p_permissions) = 0 then perform fail('VALIDATION', 'Choose at least one part of the record.'); end if;
  if not p_permissions <@ array['history','medications','allergies','labs','imaging','surgeries','vaccinations','mental_health','sensitive'] then
    perform fail('VALIDATION', 'Unknown permission.');
  end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 * 90 then perform fail('VALIDATION', 'Access can last between 1 hour and 90 days.'); end if;
  if not exists (select 1 from patients where id = p_patient) then perform fail('NOT_FOUND', 'Patient not found.'); end if;
  if exists (select 1 from access_requests where doctor_id = d.id and patient_id = p_patient and status = 'pending') then
    perform fail('CONFLICT', 'You already have a pending request with this patient.');
  end if;
  insert into access_requests (patient_id, doctor_id, permissions, duration_hours, reason)
  values (p_patient, d.id, p_permissions, p_hours, trim(p_reason)) returning access_requests.id into v_id;
  select string_agg(_perm_label(k), ', ') into perms from unnest(p_permissions) k;
  perform _audit(p_patient, _actor(), 'access_requested', jsonb_build_object('type', 'request', 'id', v_id, 'label', perms || ' · ' || _duration_label(p_hours)));
  select name into hname from hospitals where hospitals.id = d.hospital_id;
  perform _notify(_patient_user(p_patient), 'request', 'Access request',
    d.full_name || ' (' || hname || ') requested access to your ' || lower(perms) || ' for ' || _duration_label(p_hours) || '.', '/app/access?tab=requests');
  return v_id;
end $$;

create or replace function public.cancel_request(p_request text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update access_requests set status = 'cancelled' where id = p_request and doctor_id = (_require_doctor()).id and status = 'pending';
end $$;

create or replace function public.doctor_update_profile(p_patch jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d doctors := _require_doctor();
begin
  update doctors set
    phone = case when p_patch ? 'phone' then trim(p_patch ->> 'phone') else phone end,
    qualifications = case when p_patch ? 'qualifications' then trim(p_patch ->> 'qualifications') else qualifications end,
    specialization = case when p_patch ? 'specialization' and trim(p_patch ->> 'specialization') <> '' then trim(p_patch ->> 'specialization') else specialization end
  where id = d.id;
end $$;

-- A doctor's own professional activity log, with the patient's name.
create or replace function public.doctor_activity() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d doctors := _require_doctor();
begin
  return coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('patient_name', p.full_name) order by a.at desc)
    from audit_log a left join patients p on p.id = a.patient_id
    where a.actor ->> 'id' = d.id), '[]'::jsonb);
end $$;

/* ================================================================== */
/* Misc                                                                */
/* ================================================================== */

create or replace function public.mark_notifications_read(p_id text default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  update notifications set read = true where user_id = auth.uid() and (p_id is null or id = p_id) and not read
$$;

create or replace function public.log_export(p_label text, p_records int, p_documents int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients := _require_patient();
begin
  perform _audit(me.id, _actor(), 'export_created', jsonb_build_object('type', 'export', 'label', left(p_label, 200)),
    jsonb_build_object('records', p_records, 'documents', p_documents));
end $$;

/* ---------- administration (service role only) ---------- */

-- Links a verified clinician's login to a doctor profile. Used by scripts/create-doctor.mjs.
create or replace function public.admin_create_doctor(p_user uuid, p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text; v_code text;
begin
  loop
    v_code := 'DR-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists (select 1 from doctors where access_code = v_code);
  end loop;
  insert into accounts (user_id, role, onboarded) values (p_user, 'doctor', true) on conflict (user_id) do nothing;
  insert into doctors (user_id, full_name, specialization, registration_number, hospital_id, email, phone, access_code,
                       years_of_practice, qualifications, verified_at)
  values (p_user, p ->> 'fullName', p ->> 'specialization', p ->> 'registrationNumber', p ->> 'hospitalId', p ->> 'email',
          coalesce(p ->> 'phone', ''), coalesce(p ->> 'accessCode', v_code), coalesce((p ->> 'yearsOfPractice')::int, 0),
          coalesce(p ->> 'qualifications', ''), now())
  returning doctors.id into v_id;
  return v_id;
end $$;
