-- Children's records, kept by their parents from birth and handed over at 18.
--
-- * A parent creates a profile for their child. The child has no sign-in: the profile's
--   patients.user_id stays empty until the handover.
-- * Several parents or guardians can manage the profile (guardianships). Each one picks
--   which profile they are working on with switch_profile(); the choice is kept per
--   sign-in session (active_profiles), and my_patient_id() returns it. Every access rule
--   and API function already goes through my_patient_id(), so a guardian can do for the
--   child exactly what a patient can do for themselves — nothing more — and the access
--   log names the guardian (actor.guardian).
-- * At 18 a guardian makes a one-time handover code. The young adult signs up with it
--   (and their date of birth); their new account takes over the same profile and every
--   guardian's access ends. They can then ask a former guardian to keep helping (a carer).
-- * Messages about a child's record go to all of its guardians, marked with the child's
--   name, and pushed medicine reminders for a child reach the guardians' devices.
-- * Vaccines: India's UIP schedule (uip_schedule, the same as src/lib/immunization.ts)
--   drives a daily job that reminds guardians a week before each dose and when one is overdue.

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

alter table public.patients alter column user_id drop not null;
alter table public.patients add column if not exists birth_details jsonb
  check (birth_details is null or (jsonb_typeof(birth_details) = 'object' and length(birth_details::text) < 2000));
-- Children have no phone of their own: only real numbers must be unique.
drop index if exists public.patients_phone_key;
create unique index patients_phone_key on public.patients (right(regexp_replace(phone, '\D', '', 'g'), 10))
  where length(regexp_replace(phone, '\D', '', 'g')) >= 10;

create table public.guardianships (
  id text primary key default public.new_id('gdn'),
  child_id text not null references public.patients(id) on delete cascade,
  guardian_id text not null references public.patients(id) on delete cascade,
  relationship text not null check (relationship in ('mother', 'father', 'parent', 'legal_guardian', 'grandparent', 'relative')),
  kind text not null default 'guardian' check (kind in ('guardian', 'carer')),
  status text not null check (status in ('invited', 'active', 'ended')),
  invited_by text references public.patients(id) on delete set null,
  declared_at timestamptz,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  end_reason text check (end_reason in ('handover', 'left', 'removed', 'declined')),
  check (child_id <> guardian_id)
);
create unique index guardianships_open on public.guardianships (child_id, guardian_id) where status <> 'ended';
create index guardianships_by_guardian on public.guardianships (guardian_id) where status = 'active';

create table public.handover_codes (
  child_id text primary key references public.patients(id) on delete cascade,
  code_hash text not null,
  created_by text references public.patients(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Which profile each sign-in session is working on (absent = the person's own).
create table public.active_profiles (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id text not null references public.patients(id) on delete cascade,
  set_at timestamptz not null default now()
);

alter table public.notifications add column if not exists profile_id text references public.patients(id) on delete cascade;
alter table public.notifications add column if not exists profile_name text;

create table public.uip_schedule (
  key text primary key,
  vaccine text not null,
  dose text not null,
  at_days int,
  at_months int,
  at_years int,
  grp int not null,
  only_some text,
  until_days int
);

create table public.vaccine_notices (
  child_id text not null references public.patients(id) on delete cascade,
  dose_key text not null,
  kind text not null check (kind in ('soon', 'overdue')),
  sent_at timestamptz not null default now(),
  primary key (child_id, dose_key, kind)
);

-- Same as UIP_SCHEDULE in src/lib/immunization.ts (the database tests compare them).
insert into public.uip_schedule (key, vaccine, dose, at_days, at_months, at_years, grp, only_some, until_days) values
  ('bcg', 'BCG', 'Single dose', 0, null, null, 0, null, 365),
  ('opv0', 'OPV', 'Zero dose', 0, null, null, 0, null, 15),
  ('hepb0', 'Hepatitis B', 'Birth dose', 0, null, null, 0, null, 1),
  ('opv1', 'OPV', 'Dose 1', 42, null, null, 1, null, null),
  ('penta1', 'Pentavalent', 'Dose 1', 42, null, null, 1, null, 365),
  ('rota1', 'Rotavirus', 'Dose 1', 42, null, null, 1, null, 365),
  ('fipv1', 'fIPV', 'Dose 1', 42, null, null, 1, null, null),
  ('pcv1', 'PCV', 'Dose 1', 42, null, null, 1, null, null),
  ('opv2', 'OPV', 'Dose 2', 70, null, null, 2, null, null),
  ('penta2', 'Pentavalent', 'Dose 2', 70, null, null, 2, null, 365),
  ('rota2', 'Rotavirus', 'Dose 2', 70, null, null, 2, null, 365),
  ('opv3', 'OPV', 'Dose 3', 98, null, null, 3, null, null),
  ('penta3', 'Pentavalent', 'Dose 3', 98, null, null, 3, null, 365),
  ('rota3', 'Rotavirus', 'Dose 3', 98, null, null, 3, null, 365),
  ('fipv2', 'fIPV', 'Dose 2', 98, null, null, 3, null, null),
  ('pcv2', 'PCV', 'Dose 2', 98, null, null, 3, null, null),
  ('mr1', 'MR', 'Dose 1', null, 9, null, 4, null, null),
  ('je1', 'JE', 'Dose 1', null, 9, null, 4, 'Only in districts where Japanese encephalitis occurs', null),
  ('fipv3', 'fIPV', 'Dose 3', null, 9, null, 4, null, null),
  ('pcvb', 'PCV', 'Booster', null, 9, null, 4, null, null),
  ('vita1', 'Vitamin A', 'Dose 1', null, 9, null, 4, null, null),
  ('mr2', 'MR', 'Dose 2', null, 16, null, 5, null, null),
  ('je2', 'JE', 'Dose 2', null, 16, null, 5, 'Only in districts where Japanese encephalitis occurs', null),
  ('dptb1', 'DPT', 'Booster 1', null, 16, null, 5, null, null),
  ('opvb', 'OPV', 'Booster', null, 16, null, 5, null, null),
  ('vita2', 'Vitamin A', 'Dose 2', null, 16, null, 5, null, null),
  ('vita3', 'Vitamin A', 'Dose 3', null, 22, null, 6, null, null),
  ('vita4', 'Vitamin A', 'Dose 4', null, 28, null, 6, null, null),
  ('vita5', 'Vitamin A', 'Dose 5', null, 34, null, 6, null, null),
  ('vita6', 'Vitamin A', 'Dose 6', null, 40, null, 6, null, null),
  ('vita7', 'Vitamin A', 'Dose 7', null, 46, null, 6, null, null),
  ('vita8', 'Vitamin A', 'Dose 8', null, 52, null, 6, null, null),
  ('vita9', 'Vitamin A', 'Dose 9', null, 58, null, 6, null, null),
  ('dptb2', 'DPT', 'Booster 2', null, null, 5, 7, null, null),
  ('td10', 'Td', 'At 10 years', null, null, 10, 8, null, null),
  ('td16', 'Td', 'At 16 years', null, null, 16, 9, null, null);

alter table public.guardianships enable row level security;
alter table public.handover_codes enable row level security;
alter table public.active_profiles enable row level security;
alter table public.uip_schedule enable row level security;
alter table public.vaccine_notices enable row level security;
-- Read and changed only through the functions below.
revoke all on public.guardianships, public.handover_codes, public.active_profiles, public.uip_schedule, public.vaccine_notices
  from public, anon, authenticated;

/* ------------------------------------------------------------------ */
/* Who am I working for?                                               */
/* ------------------------------------------------------------------ */

create or replace function public.my_own_patient_id() returns text
language sql stable security definer set search_path = '' as $$
  select p.id from public.patients p where p.user_id = auth.uid()
$$;

-- The profile the signed-in person is working on: a child's they manage, if they chose one
-- for this session, otherwise their own. Every access rule goes through this.
create or replace function public.my_patient_id() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select ap.patient_id
       from public.active_profiles ap
       join public.patients me on me.user_id = auth.uid()
       join public.guardianships g on g.child_id = ap.patient_id and g.guardian_id = me.id and g.status = 'active'
      where ap.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid and ap.user_id = auth.uid()
      limit 1),
    (select p.id from public.patients p where p.user_id = auth.uid()))
$$;

-- True if the signed-in person manages this profile (as a parent, guardian or carer).
create or replace function public.manages_profile(p_patient text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.guardianships g join public.patients me on me.id = g.guardian_id
    where g.child_id = p_patient and g.status = 'active' and me.user_id = auth.uid()
  )
$$;

create or replace function public._acting_for_other() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select my_patient_id() is distinct from my_own_patient_id()
$$;

-- Who did it, for the access log. A parent working on a child's record is logged as
-- the child's profile with the parent named, so the child later sees who did what.
create or replace function public._actor() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p patients; me patients; d doctors; h text;
begin
  select * into me from patients where user_id = auth.uid();
  if found then
    select * into p from patients where id = my_patient_id();
    if p.id is distinct from me.id then
      return jsonb_build_object('id', p.id, 'role', 'patient', 'name', p.full_name, 'guardian', jsonb_build_object('id', me.id, 'name', me.full_name));
    end if;
    return jsonb_build_object('id', me.id, 'role', 'patient', 'name', me.full_name);
  end if;
  select * into d from doctors where user_id = auth.uid();
  if found then
    select name into h from hospitals where id = d.hospital_id;
    return jsonb_strip_nulls(jsonb_build_object('id', d.id, 'role', 'doctor', 'name', d.full_name, 'organization', h));
  end if;
  perform fail('NOT_SIGNED_IN', 'Please sign in to continue.');
end $$;

-- The signed-in person themselves (for things about the account, not the record).
create or replace function public._own_actor() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', p.id, 'role', 'patient', 'name', p.full_name) from patients p where p.user_id = auth.uid()
$$;

create or replace function public._require_patient() returns patients
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p patients;
begin
  select * into p from patients where id = my_patient_id();
  if not found then perform fail('ACCESS_DENIED', 'This area isn’t available for your account.'); end if;
  return p;
end $$;

create or replace function public._require_own_profile() returns patients
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p patients;
begin
  select * into p from patients where user_id = auth.uid();
  if not found then perform fail('ACCESS_DENIED', 'This area isn’t available for your account.'); end if;
  if _acting_for_other() then perform fail('ACCESS_DENIED', 'Switch back to your own profile to do this.'); end if;
  return p;
end $$;

drop policy if exists "own profile or granted patient" on public.patients;
create policy "own profile, managed profile or granted patient" on public.patients for select to authenticated
  using (user_id = auth.uid() or id = (select public.my_patient_id()) or public.manages_profile(id) or public.has_grant(id));

/* ------------------------------------------------------------------ */
/* Messages about a child's record go to the child's guardians         */
/* ------------------------------------------------------------------ */

create or replace function public._notify_one(p_user uuid, p_kind text, p_title text, p_body text,
  p_link text default null, p_at timestamptz default now(), p_profile text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare prefs jsonb;
begin
  if p_user is null then return; end if;
  select pr.prefs into prefs from preferences pr where pr.user_id = p_user;
  prefs := coalesce(prefs, '{}');
  if p_kind = 'record' and prefs ->> 'notifyRecords' = 'false' then return; end if;
  if p_kind in ('access', 'request') and prefs ->> 'notifyAccess' = 'false' then return; end if;
  if p_kind = 'reminder' and prefs ->> 'notifyReminders' = 'false' then return; end if;
  insert into notifications (user_id, kind, title, body, link, created_at, profile_id, profile_name)
  values (p_user, p_kind, p_title, p_body, p_link, p_at, p_profile, (select full_name from patients where id = p_profile));
end $$;

-- To a patient: their own account, and everyone who manages their record (marked with
-- whose record it is). A child's profile has no account, so only its guardians hear.
create or replace function public._notify_patient(p_patient text, p_kind text, p_title text, p_body text,
  p_link text default null, p_at timestamptz default now()) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid; g record;
begin
  select user_id into u from patients where id = p_patient;
  perform _notify_one(u, p_kind, p_title, p_body, p_link, p_at);
  for g in
    select me.user_id from guardianships gd join patients me on me.id = gd.guardian_id
    where gd.child_id = p_patient and gd.status = 'active' and me.user_id is not null
  loop
    perform _notify_one(g.user_id, p_kind, p_title, p_body, p_link, p_at, p_patient);
  end loop;
end $$;

-- Existing code tells a patient with _notify(_patient_user(patient), ...). _patient_user
-- remembers which patient it was asked about, so _notify can reach that patient's
-- guardians too (and, for a child, only them). Anything else behaves as before.
create or replace function public._patient_user(p text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid;
begin
  select user_id into u from patients where id = p;
  perform set_config('niveda.notify_patient', coalesce(p, ''), true);
  return u;
end $$;

create or replace function public._notify(p_user uuid, p_kind text, p_title text, p_body text,
  p_link text default null, p_at timestamptz default now()) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pid text := nullif(current_setting('niveda.notify_patient', true), '');
begin
  perform set_config('niveda.notify_patient', '', true);
  if pid is not null and p_user is not distinct from (select user_id from patients where id = pid) then
    perform _notify_patient(pid, p_kind, p_title, p_body, p_link, p_at);
  else
    perform _notify_one(p_user, p_kind, p_title, p_body, p_link, p_at);
  end if;
end $$;

/* ------------------------------------------------------------------ */
/* Account and profile switching                                       */
/* ------------------------------------------------------------------ */

-- profileId is the profile being worked on (so every screen shows it); ownProfileId is the person's own.
create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', a.user_id, 'role', a.role, 'onboarded', a.onboarded, 'createdAt', a.created_at,
    'profileId', coalesce(case when p.id is not null then my_patient_id() end, d.id, ap.id),
    'ownProfileId', coalesce(p.id, d.id, ap.id),
    'email', coalesce(p.email, d.email, ap.email, u.email),
    'phone', coalesce(p.phone, d.phone, ap.phone, ''), 'isAdmin', is_admin())
  from accounts a
  join auth.users u on u.id = a.user_id
  left join patients p on p.user_id = a.user_id
  left join doctors d on d.user_id = a.user_id
  left join doctor_applications ap on ap.user_id = a.user_id
  where a.user_id = auth.uid()
$$;

create or replace function public.switch_profile(p_patient text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid; me text := my_own_patient_id();
begin
  if me is null then perform fail('ACCESS_DENIED', 'This area isn’t available for your account.'); end if;
  if sid is null then perform fail('SESSION_EXPIRED', 'Please sign in again.'); end if;
  if p_patient is null or p_patient = me then
    delete from active_profiles where session_id = sid;
    return;
  end if;
  if not manages_profile(p_patient) then perform fail('ACCESS_DENIED', 'You don’t manage this record.'); end if;
  insert into active_profiles (session_id, user_id, patient_id) values (sid, auth.uid(), p_patient)
  on conflict (session_id) do update set patient_id = excluded.patient_id, user_id = excluded.user_id, set_at = now();
end $$;

-- Things about the account itself are logged in the person's own record.
create or replace function public.log_session_event(p_action text, p_device text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_action not in ('signed_in', 'signed_out') then perform fail('VALIDATION', 'Unknown event.'); end if;
  perform _audit(my_own_patient_id(), coalesce(_own_actor(), _actor()), p_action,
    jsonb_build_object('type', 'session', 'id', auth.jwt() ->> 'session_id', 'label', left(coalesce(p_device, 'Unknown device'), 80)));
end $$;

create or replace function public.log_password_changed(p_label text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _audit(my_own_patient_id(), coalesce(_own_actor(), _actor()), 'password_changed', jsonb_build_object('type', 'account', 'label', left(coalesce(p_label, 'Password changed'), 80)));
end $$;

create or replace function public.revoke_session(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_id::text = auth.jwt() ->> 'session_id' then perform fail('VALIDATION', 'Use “Log out” to end this session.'); end if;
  delete from auth.sessions where id = p_id and user_id = auth.uid();
  if found then
    perform _audit(my_own_patient_id(), coalesce(_own_actor(), _actor()), 'sessions_revoked', jsonb_build_object('type', 'session', 'id', p_id, 'label', 'Signed out a device'));
  end if;
end $$;

create or replace function public.revoke_other_sessions() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  delete from auth.sessions where user_id = auth.uid() and id::text is distinct from auth.jwt() ->> 'session_id';
  get diagnostics n = row_count;
  perform _audit(my_own_patient_id(), coalesce(_own_actor(), _actor()), 'sessions_revoked',
    jsonb_build_object('type', 'session', 'label', 'Signed out ' || n || ' other device' || case when n = 1 then '' else 's' end));
  return n;
end $$;

-- A nominee is chosen by the record's owner.
create or replace function public.set_nominee(p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me text := my_own_patient_id(); n jsonb;
begin
  if me is null then perform fail('ACCESS_DENIED', 'Only patients can name a nominee.'); end if;
  if _acting_for_other() then perform fail('ACCESS_DENIED', 'A nominee is chosen by the record’s owner. Switch back to your own profile to name yours.'); end if;
  if p is null or p = 'null'::jsonb then update patients set nominee = null where id = me; return; end if;
  n := jsonb_build_object('name', left(trim(coalesce(p ->> 'name', '')), 120), 'relationship', left(trim(coalesce(p ->> 'relationship', '')), 60),
    'phone', left(trim(coalesce(p ->> 'phone', '')), 20), 'email', left(trim(coalesce(p ->> 'email', '')), 120));
  if n ->> 'name' = '' or n ->> 'relationship' = '' or length(regexp_replace(n ->> 'phone', '\D', '', 'g')) < 10 then
    perform fail('VALIDATION', 'Give your nominee’s name, relationship and phone number.');
  end if;
  update patients set nominee = n where id = me;
end $$;

-- Profile details. A child's profile has no phone or email of its own; it can hold birth details.
create or replace function public.update_patient_profile(p_patch jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p patients := _require_patient(); b jsonb;
begin
  if p_patch ? 'fullName' and coalesce(trim(p_patch ->> 'fullName'), '') = '' then perform fail('VALIDATION', 'Name can’t be empty.'); end if;
  if p_patch ? 'emergencyContact' and not _valid_contact(p_patch -> 'emergencyContact') then
    perform fail('VALIDATION', 'An emergency contact with name, relationship and a valid phone number is required.');
  end if;
  if p.user_id is null and (p_patch ? 'phone' or p_patch ? 'email') then
    perform fail('VALIDATION', 'A child’s profile has no email or phone of its own.');
  end if;
  if p_patch ? 'phone' and length(regexp_replace(coalesce(p_patch ->> 'phone', ''), '\D', '', 'g')) < 10 then
    perform fail('VALIDATION', 'Enter a valid phone number.');
  end if;
  if p_patch ? 'birthDetails' then b := _clean_birth(p_patch -> 'birthDetails'); end if;
  update patients set
    full_name = case when p_patch ? 'fullName' then trim(p_patch ->> 'fullName') else full_name end,
    phone = case when p_patch ? 'phone' then trim(p_patch ->> 'phone') else phone end,
    date_of_birth = case when p_patch ? 'dateOfBirth' then (p_patch ->> 'dateOfBirth')::date else date_of_birth end,
    blood_group = case when p_patch ? 'bloodGroup' then nullif(p_patch ->> 'bloodGroup', '') else blood_group end,
    photo_data_url = case when p_patch ? 'photoDataUrl' then nullif(p_patch ->> 'photoDataUrl', '') else photo_data_url end,
    emergency_contact = case when p_patch ? 'emergencyContact' then p_patch -> 'emergencyContact' else emergency_contact end,
    important_notes = case when p_patch ? 'importantNotes' then nullif(trim(p_patch ->> 'importantNotes'), '') else important_notes end,
    sex = case when p_patch ? 'sex' then coalesce(p_patch ->> 'sex', '') else sex end,
    emergency_card_enabled = case when p_patch ? 'emergencyCardEnabled' then (p_patch ->> 'emergencyCardEnabled')::boolean else emergency_card_enabled end,
    birth_details = case when p_patch ? 'birthDetails' then b else birth_details end
  where id = p.id;
end $$;

-- Vaccination entries may name the scheduled dose they record (uipKey).
create or replace function public._clean_data(p_type text, p_data jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(e.key, case when jsonb_typeof(e.value) = 'string' then to_jsonb(trim(e.value #>> '{}')) else e.value end), '{}'::jsonb)
  from record_types rt, jsonb_each(coalesce(p_data, '{}'::jsonb)) e
  where rt.type = p_type
    and (e.key = any (rt.field_keys) or e.key in ('medStatus', 'discontinuedOn', 'discontinueReason', 'resultRecordId', 'orderRecordId')
         or (p_type = 'vaccination' and e.key = 'uipKey' and exists (select 1 from uip_schedule s where s.key = e.value #>> '{}')))
    and jsonb_typeof(e.value) in ('string', 'number')
    and not (jsonb_typeof(e.value) = 'string' and trim(e.value #>> '{}') = '')
$$;

/* ------------------------------------------------------------------ */
/* Children's profiles                                                 */
/* ------------------------------------------------------------------ */

create or replace function public._clean_birth(b jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select nullif(jsonb_strip_nulls(jsonb_build_object(
    'place', nullif(left(trim(coalesce(b ->> 'place', '')), 120), ''),
    'delivery', nullif(left(trim(coalesce(b ->> 'delivery', '')), 60), ''),
    'notes', nullif(left(trim(coalesce(b ->> 'notes', '')), 500), ''),
    'weightKg', case when jsonb_typeof(b -> 'weightKg') = 'number' then least(7, greatest(0.3, (b ->> 'weightKg')::numeric)) end,
    'lengthCm', case when jsonb_typeof(b -> 'lengthCm') = 'number' then least(70, greatest(20, (b ->> 'lengthCm')::numeric)) end,
    'headCm', case when jsonb_typeof(b -> 'headCm') = 'number' then least(50, greatest(20, (b ->> 'headCm')::numeric)) end,
    'gestationWeeks', case when jsonb_typeof(b -> 'gestationWeeks') = 'number' then least(45, greatest(20, (b ->> 'gestationWeeks')::numeric)) end
  )), '{}'::jsonb)
$$;

create or replace function public._relationship_en(r text) returns text
language sql immutable as $$
  select case r when 'legal_guardian' then 'legal guardian' else r end
$$;

create or replace function public._guardian_json(g guardianships, p_me text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', g.guardian_id, 'name', (select full_name from patients where id = g.guardian_id),
    'relationship', g.relationship, 'kind', g.kind, 'status', g.status, 'guardianshipId', g.id, 'isYou', g.guardian_id = p_me)
$$;

-- Everything the Family screen needs, for the signed-in person (whichever profile they're on).
create or replace function public.family_overview() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me patients;
begin
  select * into me from patients where user_id = auth.uid();
  if not found then perform fail('ACCESS_DENIED', 'This area isn’t available for your account.'); end if;
  return jsonb_build_object(
    'self', to_jsonb(me) - 'nominee',
    'activeId', my_patient_id(),
    'managed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'patient', to_jsonb(c) - 'nominee',
        'relationship', g.relationship, 'kind', g.kind,
        'guardians', coalesce((select jsonb_agg(_guardian_json(x, me.id) order by x.created_at) from guardianships x where x.child_id = c.id and x.status <> 'ended'), '[]'::jsonb),
        'canHandOver', g.kind = 'guardian' and c.user_id is null and c.date_of_birth <= current_date - interval '18 years',
        'handoverExpiresAt', (select h.expires_at from handover_codes h where h.child_id = c.id and h.expires_at > now())
      ) order by c.date_of_birth)
      from guardianships g join patients c on c.id = g.child_id
      where g.guardian_id = me.id and g.status = 'active'), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'childName', c.full_name, 'childDob', c.date_of_birth,
        'from', (select full_name from patients where id = g.invited_by), 'relationship', g.relationship) order by g.created_at)
      from guardianships g join patients c on c.id = g.child_id
      where g.guardian_id = me.id and g.status = 'invited'), '[]'::jsonb),
    'carers', coalesce((select jsonb_agg(_guardian_json(g, me.id) order by g.created_at) from guardianships g where g.child_id = me.id and g.status = 'active'), '[]'::jsonb),
    'formerGuardians', coalesce((
      select jsonb_agg(_guardian_json(g, me.id) order by g.created_at) from guardianships g
      where g.child_id = me.id and g.status = 'ended' and g.end_reason = 'handover'
        and not exists (select 1 from guardianships k where k.child_id = me.id and k.guardian_id = g.guardian_id and k.status = 'active')), '[]'::jsonb)
  );
end $$;

create or replace function public.create_child_profile(p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients := _require_own_profile(); v_name text := trim(coalesce(p ->> 'fullName', '')); v_dob date; v_rel text := p ->> 'relationship';
  v_code text; v_id text; v_contact text;
begin
  begin v_dob := (p ->> 'dateOfBirth')::date; exception when others then v_dob := null; end;
  if v_name = '' then perform fail('VALIDATION', 'Give your child’s name.'); end if;
  if v_dob is null then perform fail('VALIDATION', 'Give your child’s date of birth.'); end if;
  if v_dob > current_date then perform fail('VALIDATION', 'The date of birth can’t be in the future.'); end if;
  if v_dob <= current_date - interval '18 years' then perform fail('VALIDATION', 'This person is 18 or older, so they can create their own account.'); end if;
  if v_rel is null or v_rel not in ('mother', 'father', 'parent', 'legal_guardian', 'grandparent', 'relative') then
    perform fail('VALIDATION', 'Choose how you’re related to the child.');
  end if;
  if coalesce((p ->> 'declared')::boolean, false) is not true then
    perform fail('VALIDATION', 'Please confirm you are the child’s parent or legal guardian.');
  end if;
  loop
    v_code := 'NV-' || lpad((floor(random() * 10000))::int::text, 4, '0') || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from patients where patient_code = v_code);
  end loop;
  v_contact := case v_rel when 'mother' then 'Mother' when 'father' then 'Father' when 'parent' then 'Parent' when 'legal_guardian' then 'Guardian'
    when 'grandparent' then 'Grandparent' else 'Relative' end;
  insert into patients (user_id, patient_code, full_name, date_of_birth, sex, email, phone, blood_group, emergency_contact, emergency_card_enabled, birth_details)
  values (null, v_code, left(v_name, 120), v_dob, coalesce(nullif(p ->> 'sex', ''), ''), '', '',
    nullif(nullif(p ->> 'bloodGroup', ''), 'Unknown'),
    jsonb_build_object('name', me.full_name, 'relationship', v_contact, 'phone', me.phone), true, _clean_birth(p -> 'birthDetails'))
  returning id into v_id;
  insert into guardianships (child_id, guardian_id, relationship, kind, status, declared_at, accepted_at)
  values (v_id, me.id, v_rel, 'guardian', 'active', now(), now());
  perform _audit(v_id, jsonb_build_object('id', v_id, 'role', 'patient', 'name', left(v_name, 120), 'guardian', jsonb_build_object('id', me.id, 'name', me.full_name)),
    'profile_created', jsonb_build_object('type', 'profile', 'id', v_id, 'label', left(v_name, 120)));
  return v_id;
end $$;

create or replace function public._guardian_actor(p_child text, me patients) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', c.id, 'role', 'patient', 'name', c.full_name, 'guardian', jsonb_build_object('id', me.id, 'name', me.full_name))
  from patients c where c.id = p_child
$$;

create or replace function public.invite_guardian(p_child text, p_contact text, p_relationship text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients; them patients; c patients; v text := lower(trim(coalesce(p_contact, ''))); digits text;
begin
  select * into me from patients where user_id = auth.uid();
  if not exists (select 1 from guardianships where child_id = p_child and guardian_id = me.id and status = 'active' and kind = 'guardian') then
    perform fail('ACCESS_DENIED', 'You don’t manage this record.');
  end if;
  if v = '' then perform fail('VALIDATION', 'Enter their email or mobile number.'); end if;
  if p_relationship is null or p_relationship not in ('mother', 'father', 'parent', 'legal_guardian', 'grandparent', 'relative') then
    perform fail('VALIDATION', 'Choose how they’re related to the child.');
  end if;
  digits := right(regexp_replace(v, '\D', '', 'g'), 10);
  select * into them from patients
  where user_id is not null and (lower(email) = v or (length(digits) = 10 and right(regexp_replace(phone, '\D', '', 'g'), 10) = digits)) limit 1;
  if not found then perform fail('NOT_FOUND', 'No Niveda account uses that email or number. Ask them to create one first, then invite them again.'); end if;
  if them.id = me.id then perform fail('VALIDATION', 'You already manage this record.'); end if;
  if exists (select 1 from guardianships where child_id = p_child and guardian_id = them.id and status = 'active') then
    perform fail('CONFLICT', 'They already help manage this record.');
  end if;
  if exists (select 1 from guardianships where child_id = p_child and guardian_id = them.id and status = 'invited') then
    perform fail('CONFLICT', 'They already have an invitation.');
  end if;
  select * into c from patients where id = p_child;
  insert into guardianships (child_id, guardian_id, relationship, kind, status, invited_by) values (p_child, them.id, p_relationship, 'guardian', 'invited', me.id);
  perform _audit(p_child, _guardian_actor(p_child, me), 'guardian_invited', jsonb_build_object('type', 'guardian', 'id', them.id, 'label', them.full_name));
  perform _notify_one(them.user_id, 'access', 'Invitation to manage a child’s record',
    me.full_name || ' asked you to help manage ' || c.full_name || '’s health record as their ' || _relationship_en(p_relationship) || '.', '/app/family');
end $$;

create or replace function public.respond_guardian_invite(p_id text, p_accept boolean, p_declared boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients; g guardianships; c patients;
begin
  select * into me from patients where user_id = auth.uid();
  select * into g from guardianships where id = p_id and guardian_id = me.id and status = 'invited' for update;
  if not found then perform fail('NOT_FOUND', 'This invitation is no longer open.'); end if;
  if p_accept and not coalesce(p_declared, false) then perform fail('VALIDATION', 'Please confirm you are the child’s parent or legal guardian.'); end if;
  select * into c from patients where id = g.child_id;
  if p_accept then
    update guardianships set status = 'active', accepted_at = now(), declared_at = now() where id = g.id;
    perform _audit(c.id, _guardian_actor(c.id, me), 'guardian_added', jsonb_build_object('type', 'guardian', 'id', me.id, 'label', me.full_name));
    perform _notify_one(_patient_user(g.invited_by), 'access', 'Guardian added', me.full_name || ' now helps manage ' || c.full_name || '’s record.', '/app/family', now(), c.id);
  else
    update guardianships set status = 'ended', ended_at = now(), end_reason = 'declined' where id = g.id;
    perform _notify_one(_patient_user(g.invited_by), 'access', 'Invitation declined', me.full_name || ' declined to help manage ' || c.full_name || '’s record.', '/app/family', now(), c.id);
  end if;
  perform set_config('niveda.notify_patient', '', true);
end $$;

create or replace function public.leave_guardianship(p_child text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients; g guardianships; c patients;
begin
  select * into me from patients where user_id = auth.uid();
  select * into g from guardianships where child_id = p_child and guardian_id = me.id and status = 'active' for update;
  if not found then perform fail('NOT_FOUND', 'You don’t manage this record.'); end if;
  select * into c from patients where id = p_child;
  if c.user_id is null and (select count(*) from guardianships where child_id = p_child and status = 'active' and kind = 'guardian') <= 1 then
    perform fail('VALIDATION', 'You’re the only guardian of this record. Invite another parent or guardian before you leave.');
  end if;
  update guardianships set status = 'ended', ended_at = now(), end_reason = 'left' where id = g.id;
  delete from active_profiles where user_id = auth.uid() and patient_id = p_child;
  perform _audit(p_child, _guardian_actor(p_child, me), 'guardian_left', jsonb_build_object('type', 'guardian', 'id', me.id, 'label', me.full_name));
  if c.user_id is not null then
    perform _notify_one(c.user_id, 'access', 'Carer stopped helping', me.full_name || ' no longer helps manage your record.', '/app/family');
  end if;
end $$;

-- At 18: a one-time code for the young adult (shown once; only its hash is kept).
create or replace function public.start_handover(p_child text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients; c patients; v_code text; v_exp timestamptz := now() + interval '30 days';
begin
  select * into me from patients where user_id = auth.uid();
  if not exists (select 1 from guardianships where child_id = p_child and guardian_id = me.id and status = 'active' and kind = 'guardian') then
    perform fail('ACCESS_DENIED', 'You don’t manage this record.');
  end if;
  select * into c from patients where id = p_child;
  if c.user_id is not null then perform fail('CONFLICT', 'This record has already been handed over.'); end if;
  if c.date_of_birth > current_date - interval '18 years' then perform fail('VALIDATION', 'A record can be handed over once its owner turns 18.'); end if;
  v_code := 'HO-' || lpad((floor(random() * 10000))::int::text, 4, '0') || '-' || lpad((floor(random() * 10000))::int::text, 4, '0')
    || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
  insert into handover_codes (child_id, code_hash, created_by, expires_at)
  values (p_child, encode(extensions.digest(v_code, 'sha256'), 'hex'), me.id, v_exp)
  on conflict (child_id) do update set code_hash = excluded.code_hash, created_by = excluded.created_by, created_at = now(), expires_at = excluded.expires_at;
  perform _audit(p_child, _guardian_actor(p_child, me), 'handover_started', jsonb_build_object('type', 'profile', 'id', c.id, 'label', c.full_name));
  return jsonb_build_object('code', v_code, 'expiresAt', v_exp);
end $$;

-- After a handover: the new adult lets a former guardian keep helping, as a carer.
create or replace function public.keep_carer(p_guardian text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients := _require_own_profile(); former guardianships; them patients;
begin
  select * into former from guardianships where child_id = me.id and guardian_id = p_guardian and status = 'ended' and end_reason = 'handover'
  order by ended_at desc limit 1;
  if not found then perform fail('NOT_FOUND', 'Only a former parent or guardian can be asked to keep helping.'); end if;
  if exists (select 1 from guardianships where child_id = me.id and guardian_id = p_guardian and status <> 'ended') then
    perform fail('CONFLICT', 'They already help manage this record.');
  end if;
  insert into guardianships (child_id, guardian_id, relationship, kind, status, invited_by, accepted_at)
  values (me.id, p_guardian, former.relationship, 'carer', 'active', me.id, now());
  select * into them from patients where id = p_guardian;
  perform _audit(me.id, _actor(), 'carer_added', jsonb_build_object('type', 'guardian', 'id', them.id, 'label', them.full_name));
  perform _notify_one(them.user_id, 'access', 'You can help manage a record', me.full_name || ' asked you to keep helping manage their health record.', '/app/family', now(), me.id);
end $$;

create or replace function public.remove_carer(p_guardianship text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me patients := _require_own_profile(); g guardianships; them patients;
begin
  select * into g from guardianships where id = p_guardianship and child_id = me.id and status = 'active' for update;
  if not found then perform fail('NOT_FOUND', 'They no longer help manage your record.'); end if;
  update guardianships set status = 'ended', ended_at = now(), end_reason = 'removed' where id = g.id;
  delete from active_profiles where patient_id = me.id and user_id = (select user_id from patients where id = g.guardian_id);
  select * into them from patients where id = g.guardian_id;
  perform _audit(me.id, _actor(), 'guardian_left', jsonb_build_object('type', 'guardian', 'id', them.id, 'label', them.full_name));
  perform _notify_one(them.user_id, 'access', 'Access ended', me.full_name || ' ended your access to their records.');
end $$;

-- Who manages a record: shown to the person, their guardians and doctors with access.
create or replace function public.patient_guardians(p_patient text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(p_patient = my_patient_id() or manages_profile(p_patient) or has_grant(p_patient), false) then
    perform fail('ACCESS_DENIED', 'You don’t have access to this.');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', me.full_name, 'relationship', g.relationship, 'kind', g.kind) order by g.created_at)
    from guardianships g join patients me on me.id = g.guardian_id where g.child_id = p_patient and g.status = 'active'), '[]'::jsonb);
end $$;

-- The only guardian of a child can't erase their account: the child's record would be left with nobody.
create or replace function public._guard_last_guardian_deletion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'pending' and exists (
    select 1 from guardianships g join patients me on me.id = g.guardian_id join patients c on c.id = g.child_id
    where me.user_id = new.user_id and g.status = 'active' and g.kind = 'guardian' and c.user_id is null
      and not exists (select 1 from guardianships o where o.child_id = g.child_id and o.status = 'active' and o.kind = 'guardian' and o.id <> g.id)
  ) then
    perform fail('CONFLICT', 'You’re the only guardian of a child’s record. Invite another parent or guardian first, so the record isn’t lost.');
  end if;
  return new;
end $$;
drop trigger if exists guard_last_guardian on public.deletion_requests;
create trigger guard_last_guardian before insert on public.deletion_requests for each row execute function public._guard_last_guardian_deletion();

/* ------------------------------------------------------------------ */
/* Sign-up that takes over a record kept by a parent                   */
/* ------------------------------------------------------------------ */

create or replace function public._claim_handover(p_code text, p_dob date, p_name text, p_email text, p_phone text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare h handover_codes; c patients; g record;
begin
  select * into h from handover_codes where code_hash = encode(extensions.digest(upper(trim(p_code)), 'sha256'), 'hex') and expires_at > now() for update;
  if found then select * into c from patients where id = h.child_id for update; end if;
  if h.child_id is null or c.id is null or c.user_id is not null or c.date_of_birth <> p_dob then
    perform fail('VALIDATION', 'That handover code doesn’t match. Check the code and your date of birth, or ask your parent for a new code.');
  end if;
  update patients set user_id = auth.uid(), email = p_email, phone = p_phone, full_name = coalesce(nullif(p_name, ''), full_name) where id = c.id;
  delete from handover_codes where child_id = c.id;
  delete from active_profiles where patient_id = c.id;
  for g in select gd.id, gd.status, me.user_id from guardianships gd join patients me on me.id = gd.guardian_id
           where gd.child_id = c.id and gd.status <> 'ended' loop
    update guardianships set status = 'ended', ended_at = now(), end_reason = 'handover' where id = g.id;
    if g.status = 'active' then
      perform _notify_one(g.user_id, 'access', 'Record handed over',
        coalesce(nullif(p_name, ''), c.full_name) || ' now has their own account and has taken over their health record. Your access has ended.', '/app/family');
    end if;
  end loop;
  perform _audit(c.id, jsonb_build_object('id', c.id, 'role', 'patient', 'name', coalesce(nullif(p_name, ''), c.full_name)), 'handover_completed',
    jsonb_build_object('type', 'profile', 'id', c.id, 'label', coalesce(nullif(p_name, ''), c.full_name)));
  return c.id;
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
  if exists (select 1 from patients where length(regexp_replace(patients.phone, '\D', '', 'g')) >= 10
             and right(regexp_replace(patients.phone, '\D', '', 'g'), 10) = right(regexp_replace(v_phone, '\D', '', 'g'), 10)) then
    perform fail('CONFLICT', 'This phone number is already linked to an account.');
  end if;

  if coalesce(trim(meta ->> 'handover_code'), '') <> '' then
    -- The record a parent kept becomes this person's: same timeline, same patient ID.
    v_pid := _claim_handover(meta ->> 'handover_code', v_dob, v_name, v_email, v_phone);
    insert into accounts (user_id, role, onboarded) values (auth.uid(), 'patient', true);
    perform _audit(v_pid, jsonb_build_object('id', v_pid, 'role', 'patient', 'name', v_name), 'account_created', '{"type":"account","label":"Patient account"}');
    perform _signup_consents(auth.uid(), meta);
    insert into notifications (user_id, kind, title, body, link) values (auth.uid(), 'security', 'Welcome to Niveda',
      'The health record your parents kept for you is now yours. Only doctors you grant access to can see it, and every view is logged.', '/app/family');
    return my_account();
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

-- Sign-up stopped on a handover code that didn't match: try another code, or (null) start a new record.
create or replace function public.retry_signup_handover(p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then perform fail('NOT_SIGNED_IN', 'Please sign in to continue.'); end if;
  if exists (select 1 from accounts where user_id = auth.uid()) then return my_account(); end if;
  update auth.users set raw_user_meta_data = case when coalesce(trim(p_code), '') = '' then raw_user_meta_data - 'handover_code'
    else raw_user_meta_data || jsonb_build_object('handover_code', upper(trim(p_code))) end
  where id = auth.uid();
  return complete_signup();
end $$;

/* ------------------------------------------------------------------ */
/* Pushed medicine reminders reach a child's guardians                 */
/* ------------------------------------------------------------------ */
-- Same as 20261024000001_push_language.sql, plus the children each subscriber manages.
-- A child's reminder says whose medicine it is.

create or replace function public._due_push_reminders(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare out jsonb := '[]'; s record; tok text; names text;
begin
  delete from push_sent where sent_at < p_now - interval '2 days';
  delete from dose_push_tokens where expires_at < p_now;
  for s in
    with subs as (
      select ps.id, ps.endpoint, ps.p256dh, ps.auth, who.patient_id, who.child_name,
             coalesce(pr.prefs ->> 'language', 'en') as lang, (p_now at time zone ps.time_zone) as local_now
      from push_subscriptions ps
      join patients own on own.user_id = ps.user_id
      cross join lateral (
        select own.id as patient_id, null::text as child_name
        union all
        select c.id, c.full_name from guardianships g join patients c on c.id = g.child_id
        where g.guardian_id = own.id and g.status = 'active' and c.user_id is null
      ) who
      left join preferences pr on pr.user_id = ps.user_id
      where coalesce(pr.prefs ->> 'medAlarms', 'true') <> 'false'
    ), due as (
      select subs.id as sub_id, subs.endpoint, subs.p256dh, subs.auth, subs.patient_id, subs.child_name, subs.lang,
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
    select sub_id, endpoint, p256dh, auth, patient_id, child_name, lang, d, time,
           jsonb_agg(jsonb_build_object('recordId', record_id, 'date', d, 'time', time,
                     'label', trim(coalesce(data ->> 'name', 'Medicine') || ' ' || coalesce(data ->> 'dosage', ''))) order by data ->> 'name') as doses
    from due group by sub_id, endpoint, p256dh, auth, patient_id, child_name, lang, d, time
  loop
    insert into push_sent (subscription_id, slot) values (s.sub_id, s.patient_id || ' ' || s.d || ' ' || s.time) on conflict do nothing;
    if not found then continue; end if;
    tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into dose_push_tokens (token, patient_id, doses, expires_at)
    values (tok, s.patient_id, (select jsonb_agg(x - 'label') from jsonb_array_elements(s.doses) x), greatest(p_now, now()) + interval '12 hours');
    select string_agg(x ->> 'label', ', ') into names from jsonb_array_elements(s.doses) x;
    out := out || jsonb_build_object(
      'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
      'title', 'Time for your medicine',
      'lang', s.lang,
      'body', coalesce(s.child_name || ': ', '') || names || ' · ' || to_char(s.time::time, 'FMHH12:MI AM'),
      'tag', 'dose-' || s.patient_id || '-' || s.d || '-' || s.time,
      'url', '#/app/medications',
      'token', tok);
  end loop;
  return out;
end $$;

/* ------------------------------------------------------------------ */
/* Vaccine reminders (daily)                                           */
/* ------------------------------------------------------------------ */

create or replace function public._uip_due(p_dob date, s uip_schedule) returns date
language sql immutable as $$
  select case when s.at_days is not null then p_dob + s.at_days
              else (p_dob + make_interval(years => coalesce(s.at_years, 0), months => coalesce(s.at_months, 0)))::date end
$$;

-- A week before each dose, and again once it is four weeks overdue. Doses given (a
-- vaccination entry with that uipKey, or the same vaccine and dose), past their age
-- limit, limited to some districts, or due before the profile was created are skipped.
create or replace function public._vaccine_reminders(p_today date default current_date) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  for r in
    select c.id as child_id, c.full_name, s.key, s.vaccine, s.dose, _uip_due(c.date_of_birth, s) as due,
           case when p_today >= _uip_due(c.date_of_birth, s) + 28 then 'overdue' else 'soon' end as kind
    from patients c
    join uip_schedule s on s.only_some is null
    where c.user_id is null
      and c.date_of_birth > p_today - interval '17 years'
      and exists (select 1 from guardianships g where g.child_id = c.id and g.status = 'active')
      and _uip_due(c.date_of_birth, s) >= c.created_at::date
      and p_today >= _uip_due(c.date_of_birth, s) - 7
      and (s.until_days is null or p_today <= c.date_of_birth + s.until_days)
      and not exists (select 1 from records v where v.patient_id = c.id and v.type = 'vaccination'
                      and (v.data ->> 'uipKey' = s.key or (lower(regexp_replace(coalesce(v.data ->> 'vaccine', ''), '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(s.vaccine, '[^a-zA-Z0-9]', '', 'g'))
                           and lower(regexp_replace(coalesce(v.data ->> 'dose', ''), '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(s.dose, '[^a-zA-Z0-9]', '', 'g')))))
  loop
    insert into vaccine_notices (child_id, dose_key, kind) values (r.child_id, r.key, r.kind) on conflict do nothing;
    if not found then continue; end if;
    n := n + 1;
    if r.kind = 'soon' then
      perform _notify_patient(r.child_id, 'reminder', 'Vaccine due soon', r.full_name || '’s ' || r.vaccine || ' (' || r.dose || ') is due on ' || to_char(r.due, 'YYYY-MM-DD') || '.', '/app/vaccines');
    else
      perform _notify_patient(r.child_id, 'reminder', 'Vaccine overdue', r.full_name || '’s ' || r.vaccine || ' (' || r.dose || ') was due on ' || to_char(r.due, 'YYYY-MM-DD') || '. Ask your doctor or health centre about it.', '/app/vaccines');
    end if;
  end loop;
  return n;
end $$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'niveda-vaccine-reminders';
  -- 03:30 UTC is 9 am in India.
  perform cron.schedule('niveda-vaccine-reminders', '30 3 * * *', 'select public._vaccine_reminders()');
exception when others then
  raise notice 'pg_cron is not available (%). Enable it under Database → Extensions and run this block again.', sqlerrm;
end $$;

/* ------------------------------------------------------------------ */
/* Privileges                                                          */
/* ------------------------------------------------------------------ */

-- Internal helpers: never callable by clients.
revoke execute on function public._acting_for_other(), public._own_actor(), public._require_own_profile(),
  public._notify_one(uuid, text, text, text, text, timestamptz, text), public._notify_patient(text, text, text, text, text, timestamptz),
  public._clean_birth(jsonb), public._relationship_en(text), public._guardian_json(guardianships, text), public._guardian_actor(text, patients),
  public._guard_last_guardian_deletion(), public._claim_handover(text, date, text, text, text),
  public._uip_due(date, uip_schedule), public._vaccine_reminders(date)
  from public, anon, authenticated;

-- The app's API.
grant execute on function
  public.my_own_patient_id(), public.manages_profile(text),
  public.switch_profile(text), public.family_overview(), public.create_child_profile(jsonb),
  public.invite_guardian(text, text, text), public.respond_guardian_invite(text, boolean, boolean), public.leave_guardianship(text),
  public.start_handover(text), public.keep_carer(text), public.remove_carer(text), public.patient_guardians(text),
  public.retry_signup_handover(text)
to authenticated;
grant execute on function public._vaccine_reminders(date), public._due_push_reminders(timestamptz) to service_role;
