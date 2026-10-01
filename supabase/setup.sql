-- Niveda — complete database setup for a NEW Supabase project.
-- Generated from supabase/migrations by scripts/build-setup-sql.mjs; don't edit by hand.
--
-- 1. Supabase → Database → Extensions → enable "pg_cron" first.
-- 2. SQL Editor → New query → paste this whole file → Run. It should end with "Success".
-- 3. Make yourself a Niveda administrator (reviews doctors' applications):
--      insert into public.admins (email) values ('you@example.com');
--    You become one as soon as you sign in to Niveda with that email.
--
-- Run it once. For an existing project, run only the new files in supabase/migrations.

-- ==================================================================
-- 20260928000001_schema.sql
-- ==================================================================

-- Niveda — database schema and row-level security
--
-- Design rules:
--  * The browser is never trusted. Every table has row-level security (RLS).
--  * Reads go straight to tables and RLS decides what each person can see:
--    patients see their own record; a doctor sees a patient's rows only while an
--    active, unexpired grant covers that category.
--  * No table accepts direct writes for clinical data. Every change goes through a
--    SECURITY DEFINER function (see the next migration) that checks access, sets
--    attribution itself and writes the audit log in the same transaction.
--  * The audit log and record versions are append-only; the audit log is also
--    hash-chained so any tampering can be detected (public.verify_audit_chain()).

create extension if not exists pgcrypto with schema extensions;

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

create or replace function public.new_id(prefix text) returns text
language sql volatile set search_path = '' as $$
  select prefix || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
$$;

-- Errors reach the app as "CODE: message"; the message is safe to show people.
create or replace function public.fail(code text, msg text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using message = code || ': ' || msg, errcode = 'P0001';
end $$;

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

-- Generated from src/lib/recordMeta.ts (scripts/gen-record-types.mjs); a test
-- checks the two stay identical.
create table public.record_types (
  type text primary key,
  label text not null,
  permission text not null check (permission in ('history','medications','allergies','labs','imaging','surgeries','vaccinations','mental_health','sensitive')),
  title_key text not null,
  patient_can_add boolean not null,
  doctor_can_add boolean not null,
  field_keys text[] not null,
  required_keys text[] not null
);

insert into public.record_types (type, label, permission, title_key, patient_can_add, doctor_can_add, field_keys, required_keys) values
  ('consultation', 'Consultation', 'history', 'reason', true, true, array['reason', 'doctor', 'facility', 'symptoms', 'diagnosis', 'medications', 'followUp', 'notes']::text[], array['reason']::text[]),
  ('diagnosis', 'Diagnosis', 'history', 'condition', true, true, array['condition', 'status', 'severity', 'doctor', 'facility', 'notes']::text[], array['condition', 'status']::text[]),
  ('medication', 'Medication', 'medications', 'name', true, true, array['name', 'dosage', 'frequency', 'endDate', 'prescriber', 'reason', 'instructions']::text[], array['name', 'dosage', 'frequency']::text[]),
  ('allergy', 'Allergy', 'allergies', 'allergen', true, true, array['allergen', 'severity', 'reaction', 'notes']::text[], array['allergen', 'severity', 'reaction']::text[]),
  ('surgery', 'Surgery', 'surgeries', 'procedure', true, true, array['procedure', 'surgeon', 'facility', 'reason', 'outcome', 'notes']::text[], array['procedure']::text[]),
  ('procedure', 'Procedure', 'surgeries', 'procedure', true, true, array['procedure', 'doctor', 'facility', 'reason', 'outcome', 'notes']::text[], array['procedure']::text[]),
  ('lab_test', 'Lab test', 'labs', 'test', true, true, array['test', 'status', 'laboratory', 'orderedBy', 'reason']::text[], array['test', 'status']::text[]),
  ('lab_result', 'Lab result', 'labs', 'test', true, true, array['test', 'laboratory', 'result', 'referenceRange', 'status', 'notes']::text[], array['test', 'result', 'status']::text[]),
  ('imaging', 'Imaging', 'imaging', 'study', true, true, array['study', 'modality', 'facility', 'findings', 'impression']::text[], array['study']::text[]),
  ('vaccination', 'Vaccination', 'vaccinations', 'vaccine', true, true, array['vaccine', 'dose', 'facility', 'batch', 'nextDue']::text[], array['vaccine']::text[]),
  ('hospitalization', 'Hospitalisation', 'history', 'reason', true, true, array['reason', 'facility', 'dischargeDate', 'attendingDoctor', 'summary']::text[], array['reason']::text[]),
  ('mental_health', 'Mental health', 'mental_health', 'topic', true, true, array['topic', 'provider', 'notes']::text[], array['topic']::text[]),
  ('family_history', 'Family history', 'history', 'condition', true, true, array['condition', 'relative', 'notes']::text[], array['condition', 'relative']::text[]),
  ('follow_up', 'Follow-up', 'history', 'purpose', false, true, array['purpose', 'doctor', 'facility', 'notes']::text[], array['purpose']::text[]),
  ('clinical_note', 'Clinical note', 'history', 'subject', false, true, array['subject', 'note']::text[], array['subject', 'note']::text[]),
  ('other', 'Other', 'sensitive', 'title', true, false, array['title', 'facility', 'notes']::text[], array['title']::text[]);

create table public.hospitals (
  id text primary key default public.new_id('hsp'),
  name text not null,
  city text not null,
  type text not null check (type in ('hospital','clinic','laboratory','imaging'))
);

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

create table public.accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('patient','doctor')),
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.patients (
  id text primary key default public.new_id('pat'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  patient_code text not null unique,
  full_name text not null check (length(trim(full_name)) > 0),
  date_of_birth date not null,
  sex text check (sex in ('female','male','other','')),
  email text not null,
  phone text not null,
  blood_group text,
  photo_data_url text check (photo_data_url is null or length(photo_data_url) < 1500000),
  emergency_contact jsonb,
  important_notes text,
  emergency_card_enabled boolean not null default false,
  declarations jsonb,
  created_at timestamptz not null default now()
);
create unique index patients_phone_key on public.patients (right(regexp_replace(phone, '\D', '', 'g'), 10));

-- Doctors are created by an administrator after their registration has been
-- checked (scripts/create-doctor.mjs), never through public sign-up.
create table public.doctors (
  id text primary key default public.new_id('doc'),
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  specialization text not null,
  registration_number text not null unique,
  hospital_id text not null references public.hospitals(id),
  email text not null,
  phone text not null default '',
  access_code text not null unique,
  years_of_practice int not null default 0,
  qualifications text not null default '',
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/* Clinical record                                                     */
/* ------------------------------------------------------------------ */

create table public.records (
  id text primary key default public.new_id('rec'),
  patient_id text not null references public.patients(id) on delete cascade,
  type text not null references public.record_types(type),
  date date not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and length(data::text) < 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by jsonb not null,               -- actor: {id, role, name, organization?}
  organization jsonb,                      -- {id, name} for doctor entries
  attachments text[] not null default '{}',
  parent_id text references public.records(id),
  source text not null check (source in ('patient','doctor','import')),
  version int not null default 1
);
create index records_patient_idx on public.records (patient_id, date desc);
create index records_parent_idx on public.records (parent_id);
create index records_author_idx on public.records ((created_by ->> 'id'));

-- Every version of every entry, forever. The current version is duplicated on
-- public.records for fast reads; this table is the history.
create table public.record_versions (
  record_id text not null references public.records(id) on delete cascade,
  version int not null,
  date date not null,
  data jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by jsonb not null,
  change_type text not null check (change_type in ('created','amended','discontinued','result_added','completed')),
  reason text,
  primary key (record_id, version)
);

create table public.documents (
  id text primary key,
  patient_id text not null references public.patients(id) on delete cascade,
  name text not null,
  mime_type text not null,
  size bigint not null check (size > 0 and size <= 15 * 1024 * 1024),
  category text not null check (category in ('report','prescription','scan','image','discharge','other')),
  date date not null,
  record_id text references public.records(id) on delete set null,
  uploaded_by jsonb not null,
  uploaded_at timestamptz not null default now(),
  storage_path text not null unique,
  generated jsonb
);
create index documents_patient_idx on public.documents (patient_id);

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

create table public.access_grants (
  id text primary key default public.new_id('grt'),
  patient_id text not null references public.patients(id) on delete cascade,
  doctor_id text not null references public.doctors(id) on delete cascade,
  permissions text[] not null check (cardinality(permissions) > 0),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  method text not null check (method in ('directory','code','qr','invite','request')),
  revoked_at timestamptz,
  verification jsonb not null,
  reminder_sent boolean not null default false,
  expiry_logged boolean not null default false,
  request_id text,
  check (expires_at > granted_at and expires_at <= granted_at + interval '90 days 1 minute')
);
create unique index one_active_grant on public.access_grants (patient_id, doctor_id) where status = 'active';
create index grants_doctor_idx on public.access_grants (doctor_id, status);

create table public.access_requests (
  id text primary key default public.new_id('req'),
  patient_id text not null references public.patients(id) on delete cascade,
  doctor_id text not null references public.doctors(id) on delete cascade,
  permissions text[] not null check (cardinality(permissions) > 0),
  duration_hours int not null check (duration_hours between 1 and 2160),
  reason text not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  responded_at timestamptz
);
create unique index one_pending_request on public.access_requests (patient_id, doctor_id) where status = 'pending';

create table public.doctor_invites (
  id text primary key default public.new_id('inv'),
  patient_id text not null references public.patients(id) on delete cascade,
  contact text not null,
  doctor_name text not null,
  created_at timestamptz not null default now(),
  status text not null default 'sent' check (status in ('sent','cancelled'))
);

-- One step-up code proves one action: each verification can be spent once.
create table public.step_up_uses (
  session_id uuid not null,
  verified_at bigint not null,
  used_at timestamptz not null default now(),
  primary key (session_id, verified_at)
);

/* ------------------------------------------------------------------ */
/* Audit log (append-only, hash-chained)                               */
/* ------------------------------------------------------------------ */

create sequence public.audit_seq;
create table public.audit_log (
  id text primary key default public.new_id('aud'),
  seq bigint unique,
  patient_id text references public.patients(id) on delete cascade,
  actor jsonb not null,
  action text not null,
  target jsonb,
  at timestamptz not null default now(),
  metadata jsonb,
  prev_hash text,
  hash text
);
create index audit_patient_idx on public.audit_log (patient_id, at desc);
create index audit_actor_idx on public.audit_log ((actor ->> 'id'), at desc);

create or replace function public.audit_entry_hash(prev text, a public.audit_log) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(
    coalesce(prev, '') || '|' || a.seq || '|' || a.id || '|' || coalesce(a.patient_id, '') || '|' ||
    a.actor::text || '|' || a.action || '|' || coalesce(a.target::text, '') || '|' ||
    coalesce(a.metadata::text, '') || '|' || to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'sha256'), 'hex')
$$;

create or replace function public.audit_chain() returns trigger
language plpgsql set search_path = '' as $$
declare prev text;
begin
  -- Serialise writers so the chain has a single, gap-free order.
  perform pg_advisory_xact_lock(hashtext('niveda.audit_chain'));
  new.seq := nextval('public.audit_seq');
  select a.hash into prev from public.audit_log a order by a.seq desc limit 1;
  new.prev_hash := prev;
  new.hash := public.audit_entry_hash(prev, new);
  return new;
end $$;
create trigger audit_chain before insert on public.audit_log for each row execute function public.audit_chain();

-- Returns null when the chain is intact, otherwise the first entry that doesn't match.
create or replace function public.verify_audit_chain() returns bigint
language plpgsql stable set search_path = '' as $$
declare a public.audit_log; prev text;
begin
  for a in select * from public.audit_log order by seq loop
    if a.prev_hash is distinct from prev or a.hash <> public.audit_entry_hash(prev, a) then return a.seq; end if;
    prev := a.hash;
  end loop;
  return null;
end $$;

/* ------------------------------------------------------------------ */
/* Immutability guards                                                 */
/* ------------------------------------------------------------------ */

-- Append-only tables. Account erasure (a legal right under the DPDP Act) is the
-- one exception and must be done deliberately by an administrator:
--   set local niveda.allow_erasure = 'on'; delete from auth.users where id = ...;
create or replace function public.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('niveda.allow_erasure', true) = 'on' then return old; end if;
  raise exception using message = 'IMMUTABLE: ' || tg_table_name || ' entries can''t be changed or deleted.', errcode = 'P0001';
end $$;
create trigger audit_log_immutable before update or delete on public.audit_log for each row execute function public.forbid_change();
create trigger record_versions_immutable before update or delete on public.record_versions for each row execute function public.forbid_change();
create trigger records_no_delete before delete on public.records for each row execute function public.forbid_change();

-- Attribution never changes, and versions only move forward.
create or replace function public.records_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.created_by is distinct from old.created_by or new.created_at <> old.created_at
     or new.patient_id <> old.patient_id or new.source <> old.source or new.type <> old.type
     or new.organization is distinct from old.organization or new.version < old.version then
    raise exception using message = 'IMMUTABLE: who added an entry, when and for whom can''t be changed.', errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger records_guard before update on public.records for each row execute function public.records_guard();

/* ------------------------------------------------------------------ */
/* Notifications, preferences, reminders                               */
/* ------------------------------------------------------------------ */

create table public.notifications (
  id text primary key default public.new_id('ntf'),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('record','access','request','security','reminder')),
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read boolean not null default false,
  link text
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.preferences (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  prefs jsonb not null default '{}' check (jsonb_typeof(prefs) = 'object' and length(prefs::text) < 2000)
);

-- The patient's schedule for a medicine, kept apart from the clinical entry so
-- changing times never alters a doctor's prescription.
create or replace function public.valid_times(times text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(t ~ '^([01]\d|2[0-3]):[0-5]\d$'), true) from unnest(times) t
$$;

create table public.medication_reminders (
  record_id text primary key references public.records(id) on delete cascade,
  patient_id text not null references public.patients(id) on delete cascade,
  times text[] not null default '{}' check (public.valid_times(times)),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.dose_logs (
  id text primary key default public.new_id('dose'),
  patient_id text not null references public.patients(id) on delete cascade,
  record_id text not null references public.records(id) on delete cascade,
  date date not null,
  time text not null check (time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  status text not null check (status in ('taken','skipped')),
  logged_at timestamptz not null default now(),
  unique (record_id, date, time)
);

/* ------------------------------------------------------------------ */
/* Access-check helpers (used by RLS and by the API functions)         */
/* ------------------------------------------------------------------ */

create or replace function public.my_patient_id() returns text
language sql stable security definer set search_path = '' as $$
  select p.id from public.patients p where p.user_id = auth.uid()
$$;

create or replace function public.my_doctor_id() returns text
language sql stable security definer set search_path = '' as $$
  select d.id from public.doctors d where d.user_id = auth.uid()
$$;

create or replace function public.perm_for_type(t text) returns text
language sql stable security definer set search_path = '' as $$
  select rt.permission from public.record_types rt where rt.type = t
$$;

-- True while the signed-in doctor holds an active, unexpired grant for this
-- patient (covering the permission, when one is given). Expiry is checked
-- against the clock here, so access ends on time even if no job has run.
create or replace function public.has_grant(p_patient text, p_perm text default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.access_grants g
    where g.doctor_id = public.my_doctor_id() and g.patient_id = p_patient
      and g.status = 'active' and g.expires_at > now()
      and (p_perm is null or p_perm = any (g.permissions))
  )
$$;

-- Documents attached to an entry follow that entry's category; loose documents
-- follow their own category. Unknown kinds are treated as sensitive.
create or replace function public.doc_perm(p_record_id text, p_category text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select rt.permission from public.records r join public.record_types rt on rt.type = r.type where r.id = p_record_id),
    case p_category when 'report' then 'labs' when 'prescription' then 'medications' when 'scan' then 'imaging'
                    when 'image' then 'history' when 'discharge' then 'history' else 'sensitive' end)
$$;

/* ------------------------------------------------------------------ */
/* Row-level security                                                  */
/* ------------------------------------------------------------------ */

alter table public.record_types enable row level security;
alter table public.hospitals enable row level security;
alter table public.accounts enable row level security;
alter table public.patients enable row level security;
alter table public.doctors enable row level security;
alter table public.records enable row level security;
alter table public.record_versions enable row level security;
alter table public.documents enable row level security;
alter table public.access_grants enable row level security;
alter table public.access_requests enable row level security;
alter table public.doctor_invites enable row level security;
alter table public.step_up_uses enable row level security;
alter table public.audit_log enable row level security;
alter table public.notifications enable row level security;
alter table public.preferences enable row level security;
alter table public.medication_reminders enable row level security;
alter table public.dose_logs enable row level security;

create policy "reference data is readable" on public.record_types for select to authenticated using (true);
create policy "hospitals are readable" on public.hospitals for select to authenticated using (true);
create policy "own account" on public.accounts for select to authenticated using (user_id = auth.uid());

create policy "own profile or granted patient" on public.patients for select to authenticated
  using (user_id = auth.uid() or public.has_grant(id));
create policy "own doctor profile" on public.doctors for select to authenticated
  using (user_id = auth.uid());

create policy "own record or granted category" on public.records for select to authenticated
  using (patient_id = (select public.my_patient_id()) or public.has_grant(patient_id, public.perm_for_type(type)));
create policy "history of visible entries" on public.record_versions for select to authenticated
  using (exists (select 1 from public.records r where r.id = record_id));
create policy "own documents or granted category" on public.documents for select to authenticated
  using (patient_id = (select public.my_patient_id()) or public.has_grant(patient_id, public.doc_perm(record_id, category)));

create policy "grants of either party" on public.access_grants for select to authenticated
  using (patient_id = (select public.my_patient_id()) or doctor_id = (select public.my_doctor_id()));
create policy "requests of either party" on public.access_requests for select to authenticated
  using (patient_id = (select public.my_patient_id()) or doctor_id = (select public.my_doctor_id()));
create policy "own invites" on public.doctor_invites for select to authenticated
  using (patient_id = (select public.my_patient_id()));

-- Patients read everything that happened to their record; doctors read their own actions.
create policy "patient's record log or own actions" on public.audit_log for select to authenticated
  using (patient_id = (select public.my_patient_id())
         or actor ->> 'id' = (select public.my_doctor_id())
         or actor ->> 'id' = (select public.my_patient_id()));

create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());

create policy "own preferences read" on public.preferences for select to authenticated using (user_id = auth.uid());
create policy "own preferences insert" on public.preferences for insert to authenticated with check (user_id = auth.uid());
create policy "own preferences update" on public.preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own reminders read" on public.medication_reminders for select to authenticated
  using (patient_id = (select public.my_patient_id()));
create policy "own reminders insert" on public.medication_reminders for insert to authenticated
  with check (patient_id = (select public.my_patient_id())
              and exists (select 1 from public.records r where r.id = record_id and r.patient_id = medication_reminders.patient_id and r.type = 'medication'));
create policy "own reminders update" on public.medication_reminders for update to authenticated
  using (patient_id = (select public.my_patient_id()))
  with check (patient_id = (select public.my_patient_id())
              and exists (select 1 from public.records r where r.id = record_id and r.patient_id = medication_reminders.patient_id and r.type = 'medication'));

create policy "own doses read" on public.dose_logs for select to authenticated
  using (patient_id = (select public.my_patient_id()));
create policy "own doses insert" on public.dose_logs for insert to authenticated
  with check (patient_id = (select public.my_patient_id())
              and exists (select 1 from public.records r where r.id = record_id and r.patient_id = dose_logs.patient_id and r.type = 'medication'));
create policy "own doses update" on public.dose_logs for update to authenticated
  using (patient_id = (select public.my_patient_id())) with check (patient_id = (select public.my_patient_id()));
create policy "own doses delete" on public.dose_logs for delete to authenticated
  using (patient_id = (select public.my_patient_id()));

-- The doctor directory patients search. It leaves out contact details and the
-- private access code (looked up only through find_doctor_by_code()).
create view public.doctor_directory as
  select d.id, d.full_name, d.specialization, d.registration_number, d.hospital_id,
         d.years_of_practice, d.qualifications, d.verified_at is not null as verified
  from public.doctors d;

-- ==================================================================
-- 20260928000002_api.sql
-- ==================================================================

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

-- ==================================================================
-- 20260928000003_storage_jobs_privileges.sql
-- ==================================================================

-- Niveda — file storage, scheduled jobs, live updates and privileges

/* ------------------------------------------------------------------ */
/* Private document storage                                            */
/* ------------------------------------------------------------------ */
-- Files live in a private bucket at "<patient id>/<document id>". There are no
-- public URLs: the app downloads through the storage API, which applies the
-- policies below — the same access rules as the documents table.

-- Patients always see their own folder; doctors see a file only while its
-- document entry is shared with them.
create or replace function public.can_read_object(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select split_part(p_name, '/', 1) = my_patient_id()
    or exists (select 1 from documents d where d.storage_path = p_name
               and has_grant(d.patient_id, doc_perm(d.record_id, d.category)))
$$;

create or replace function public.can_upload_object(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_name ~ '^pat_[a-z0-9]+/doc_[a-z0-9]{8,32}$'
    and not exists (select 1 from documents d where d.storage_path = p_name)
    and (split_part(p_name, '/', 1) = my_patient_id() or has_grant(split_part(p_name, '/', 1)))
$$;

-- Only the patient, only in their own folder, and only once the document entry
-- has been removed through delete_document() (which refuses doctors' documents).
create or replace function public.can_delete_object(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select split_part(p_name, '/', 1) = my_patient_id()
    and not exists (select 1 from documents d where d.storage_path = p_name)
$$;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not found; skipping bucket setup';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('documents', 'documents', false, 15728640,
          array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'text/plain'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists "niveda: read permitted documents" on storage.objects;
  drop policy if exists "niveda: upload to permitted folder" on storage.objects;
  drop policy if exists "niveda: patients delete own files" on storage.objects;
  create policy "niveda: read permitted documents" on storage.objects for select to authenticated
    using (bucket_id = 'documents' and public.can_read_object(name));
  create policy "niveda: upload to permitted folder" on storage.objects for insert to authenticated
    with check (bucket_id = 'documents' and public.can_upload_object(name));
  create policy "niveda: patients delete own files" on storage.objects for delete to authenticated
    using (bucket_id = 'documents' and public.can_delete_object(name));
  -- No update policy: files can't be overwritten once uploaded.
end $$;

/* ------------------------------------------------------------------ */
/* Background job: grant expiry and "ends soon" reminders              */
/* ------------------------------------------------------------------ */
-- Access checks already compare against the clock, so access ends on time
-- regardless. The job writes the "expired" log entries and notifications even
-- when nobody opens the app.

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'niveda-sweep-grants';
  perform cron.schedule('niveda-sweep-grants', '*/5 * * * *', 'select public._sweep_grants(null, null)');
exception when others then
  raise notice 'pg_cron is not available (%). Enable it under Database → Extensions and run this block again.', sqlerrm;
end $$;

/* ------------------------------------------------------------------ */
/* Live updates                                                        */
/* ------------------------------------------------------------------ */
-- The app refreshes when these change (for example a patient seeing a doctor's
-- new entry). Realtime respects RLS, so people only hear about their own rows.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.access_grants, public.access_requests;
  end if;
exception when duplicate_object then null;
end $$;

/* ------------------------------------------------------------------ */
/* Privileges                                                          */
/* ------------------------------------------------------------------ */

-- Nothing for signed-out visitors.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Signed-in users read through RLS. The only direct writes allowed are the
-- patient's own reminder settings, dose log and preferences (RLS-checked).
revoke all on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
revoke select on public.step_up_uses from authenticated;
grant insert, update on public.medication_reminders, public.preferences to authenticated;
grant insert, update, delete on public.dose_logs to authenticated;
grant select on public.doctor_directory to authenticated;

-- Functions: users may call the API, never the internal helpers or admin tools.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  -- used inside RLS policies
  public.my_patient_id(), public.my_doctor_id(), public.perm_for_type(text), public.has_grant(text, text),
  public.doc_perm(text, text), public.can_read_object(text), public.can_upload_object(text), public.can_delete_object(text),
  public.valid_times(text[]), public.new_id(text),
  -- accounts & sessions
  public.my_account(), public.complete_signup(), public.log_session_event(text, text), public.log_password_changed(text),
  public.list_my_sessions(), public.revoke_session(uuid), public.revoke_other_sessions(),
  -- patient
  public.update_patient_profile(jsonb), public.complete_onboarding(jsonb), public.emergency_profile(text),
  -- records & documents
  public.create_record(text, text, date, jsonb, text, text[], text[]), public.add_visit(text, jsonb, text[]),
  public.amend_record(text, date, jsonb, text), public.discontinue_medication(text, text, date),
  public.add_lab_result(text, jsonb, date, text[]), public.log_record_view(text), public.log_history_view(text),
  public.register_document(text, text, text, text, bigint, text, date, text), public.attach_document(text, text),
  public.delete_document(text), public.log_document_view(text),
  -- access
  public.sweep_my_grants(), public.find_doctor_by_code(text), public.grant_access(text, text[], int, text),
  public.update_grant_permissions(text, text[]), public.revoke_grant(text), public.approve_request(text, text[], int),
  public.decline_request(text), public.invite_doctor(text, text), public.cancel_invite(text),
  public.doctor_access_overview(), public.lookup_patient(text), public.request_access(text, text[], int, text),
  public.cancel_request(text), public.doctor_update_profile(jsonb), public.doctor_activity(),
  -- misc
  public.mark_notifications_read(text), public.log_export(text, int, int)
to authenticated;

grant execute on function public.admin_create_doctor(uuid, jsonb), public._sweep_grants(text, text), public.verify_audit_chain() to service_role;

-- Functions added later are private until granted explicitly.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ==================================================================
-- 20260930000001_doctor_signup.sql
-- ==================================================================

-- Niveda — doctor sign-up with verification by the Niveda team
--
-- Doctors apply in the app with their medical council registration. Until an
-- administrator has checked the registration (for example on the NMC's Indian
-- Medical Register) and approved them, they are an "applicant": they can see
-- and edit their application, and nothing else. Approval creates the doctor's
-- profile, marks it verified and gives them an access code for patients.

/* ------------------------------------------------------------------ */
/* Administrators                                                      */
/* ------------------------------------------------------------------ */
-- Listed by email. A person is an administrator once they have signed in with
-- that email (Niveda only creates sessions after an emailed code is verified).
create table if not exists public.admins (
  email text primary key check (email = lower(trim(email)) and email like '%@%'),
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- No policies: the list is read only through is_admin().

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from auth.users u join admins a on a.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  )
$$;

create or replace function public._require_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then perform fail('NOT_SIGNED_IN', 'Please sign in to continue.'); end if;
  if not is_admin() then perform fail('ACCESS_DENIED', 'Only the Niveda team can do this.'); end if;
end $$;

/* ------------------------------------------------------------------ */
/* Applications                                                        */
/* ------------------------------------------------------------------ */
alter table public.accounts drop constraint if exists accounts_role_check;
alter table public.accounts add constraint accounts_role_check check (role in ('patient', 'doctor', 'applicant'));

create table if not exists public.doctor_applications (
  id text primary key default public.new_id('dap'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text not null,
  registration_number text not null,
  medical_council text not null,
  registration_year int check (registration_year is null or registration_year between 1940 and 2100),
  specialization text not null,
  qualifications text not null,
  years_of_practice int not null default 0 check (years_of_practice between 0 and 70),
  hospital_name text not null,
  hospital_city text not null,
  hospital_type text not null default 'hospital' check (hospital_type in ('hospital', 'clinic', 'laboratory', 'imaging')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  doctor_id text references public.doctors(id) on delete set null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists doctor_applications_status on public.doctor_applications (status, submitted_at);
alter table public.doctor_applications enable row level security;
drop policy if exists "own application" on public.doctor_applications;
create policy "own application" on public.doctor_applications for select to authenticated using (user_id = auth.uid());
grant select on public.doctor_applications to authenticated;

-- Checks and tidies the details a doctor gives. Raises a friendly error.
create or replace function public._clean_application(p jsonb) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  t jsonb := '{}';
  k text;
  v_years int;
  v_year int;
begin
  foreach k in array array['fullName', 'phone', 'registrationNumber', 'medicalCouncil', 'specialization', 'qualifications', 'hospitalName', 'hospitalCity'] loop
    t := t || jsonb_build_object(k, regexp_replace(trim(coalesce(p ->> k, '')), '\s+', ' ', 'g'));
  end loop;
  if length(t ->> 'fullName') < 3 then perform fail('VALIDATION', 'Enter your full name as it appears on your registration.'); end if;
  if length(regexp_replace(t ->> 'phone', '\D', '', 'g')) < 10 then perform fail('VALIDATION', 'Enter a 10-digit mobile number.'); end if;
  if length(t ->> 'registrationNumber') < 3 or length(t ->> 'registrationNumber') > 40 then perform fail('VALIDATION', 'Enter your medical registration number.'); end if;
  if length(t ->> 'medicalCouncil') < 3 then perform fail('VALIDATION', 'Choose the medical council you are registered with.'); end if;
  if length(t ->> 'specialization') < 2 then perform fail('VALIDATION', 'Enter your specialisation.'); end if;
  if length(t ->> 'qualifications') < 2 then perform fail('VALIDATION', 'Enter your qualifications, for example MBBS, MD.'); end if;
  if length(t ->> 'hospitalName') < 2 or length(t ->> 'hospitalCity') < 2 then perform fail('VALIDATION', 'Enter the hospital or clinic you work at, and its city.'); end if;
  begin v_years := coalesce(nullif(p ->> 'yearsOfPractice', '')::int, 0); exception when others then v_years := -1; end;
  if v_years < 0 or v_years > 70 then perform fail('VALIDATION', 'Check your years of practice.'); end if;
  begin v_year := nullif(p ->> 'registrationYear', '')::int; exception when others then v_year := 0; end;
  if v_year is not null and (v_year < 1940 or v_year > extract(year from now())::int) then perform fail('VALIDATION', 'Check the year of registration.'); end if;
  return t || jsonb_build_object(
    'registrationNumber', upper(t ->> 'registrationNumber'),
    'yearsOfPractice', v_years,
    'registrationYear', v_year,
    'hospitalType', case when p ->> 'hospitalType' in ('hospital', 'clinic', 'laboratory', 'imaging') then p ->> 'hospitalType' else 'hospital' end);
end $$;

create or replace function public._assert_registration_free(p_reg text, p_user uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from doctors where upper(registration_number) = upper(p_reg))
     or exists (select 1 from doctor_applications where upper(registration_number) = upper(p_reg) and user_id <> p_user and status <> 'declined') then
    perform fail('CONFLICT', 'This registration number is already linked to a Niveda account. Contact the Niveda team if this is a mistake.');
  end if;
end $$;

create or replace function public._application_json(a doctor_applications) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', a.id, 'fullName', a.full_name, 'email', a.email, 'phone', a.phone,
    'registrationNumber', a.registration_number, 'medicalCouncil', a.medical_council, 'registrationYear', a.registration_year,
    'specialization', a.specialization, 'qualifications', a.qualifications, 'yearsOfPractice', a.years_of_practice,
    'hospitalName', a.hospital_name, 'hospitalCity', a.hospital_city, 'hospitalType', a.hospital_type,
    'status', a.status, 'reviewNote', a.review_note, 'reviewedAt', a.reviewed_at, 'submittedAt', a.submitted_at,
    'accessCode', (select d.access_code from doctors d where d.id = a.doctor_id))
$$;

-- The signed-in user, shaped like the app's User type (now with isAdmin).
create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', a.user_id, 'role', a.role, 'onboarded', a.onboarded, 'createdAt', a.created_at,
    'profileId', coalesce(p.id, d.id, ap.id), 'email', coalesce(p.email, d.email, ap.email, u.email),
    'phone', coalesce(p.phone, d.phone, ap.phone, ''), 'isAdmin', is_admin())
  from accounts a
  join auth.users u on u.id = a.user_id
  left join patients p on p.user_id = a.user_id
  left join doctors d on d.user_id = a.user_id
  left join doctor_applications ap on ap.user_id = a.user_id
  where a.user_id = auth.uid()
$$;

-- Called once the email code from sign-up is verified. Creates the patient's
-- profile, or — for a doctor — their application. Safe to call again.
create or replace function public.complete_signup() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare meta jsonb; v_email text; v_code text; v_pid text; v_name text; v_dob date; v_phone text; c jsonb;
begin
  if auth.uid() is null then perform fail('NOT_SIGNED_IN', 'Please sign in to continue.'); end if;
  if exists (select 1 from accounts where user_id = auth.uid()) then return my_account(); end if;
  select raw_user_meta_data, email into meta, v_email from auth.users where id = auth.uid();

  if meta ->> 'signup_kind' = 'doctor' then
    c := _clean_application(meta);
    perform _assert_registration_free(c ->> 'registrationNumber', auth.uid());
    insert into accounts (user_id, role, onboarded) values (auth.uid(), 'applicant', true);
    insert into doctor_applications (user_id, full_name, email, phone, registration_number, medical_council, registration_year,
      specialization, qualifications, years_of_practice, hospital_name, hospital_city, hospital_type)
    values (auth.uid(), c ->> 'fullName', v_email, c ->> 'phone', c ->> 'registrationNumber', c ->> 'medicalCouncil',
      (c ->> 'registrationYear')::int, c ->> 'specialization', c ->> 'qualifications', (c ->> 'yearsOfPractice')::int,
      c ->> 'hospitalName', c ->> 'hospitalCity', c ->> 'hospitalType');
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

create or replace function public.my_doctor_application() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select _application_json(a) from doctor_applications a where a.user_id = auth.uid()
$$;

-- An applicant corrects their details (while waiting, or after being declined).
create or replace function public.update_doctor_application(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a doctor_applications; c jsonb;
begin
  select * into a from doctor_applications where user_id = auth.uid() for update;
  if a.id is null then perform fail('NOT_FOUND', 'No application found for this account.'); end if;
  if a.status = 'approved' then perform fail('CONFLICT', 'Your application is already approved.'); end if;
  c := _clean_application(p);
  perform _assert_registration_free(c ->> 'registrationNumber', auth.uid());
  update doctor_applications set full_name = c ->> 'fullName', phone = c ->> 'phone', registration_number = c ->> 'registrationNumber',
    medical_council = c ->> 'medicalCouncil', registration_year = (c ->> 'registrationYear')::int, specialization = c ->> 'specialization',
    qualifications = c ->> 'qualifications', years_of_practice = (c ->> 'yearsOfPractice')::int, hospital_name = c ->> 'hospitalName',
    hospital_city = c ->> 'hospitalCity', hospital_type = c ->> 'hospitalType',
    status = 'pending', review_note = case when a.status = 'declined' then a.review_note else null end,
    reviewed_by = null, reviewed_at = null, submitted_at = now()
  where id = a.id returning * into a;
  return _application_json(a);
end $$;

/* ------------------------------------------------------------------ */
/* Review by the Niveda team                                           */
/* ------------------------------------------------------------------ */
create or replace function public.admin_doctor_applications(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform _require_admin();
  return coalesce((
    select jsonb_agg(_application_json(a) order by a.submitted_at)
    from doctor_applications a
    where p_status is null or p_status = 'all' or a.status = p_status
  ), '[]');
end $$;

create or replace function public.admin_review_doctor_application(p_id text, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a doctor_applications; v_hospital text; v_code text; v_doctor text; v_me text; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  perform _require_admin();
  select email into v_me from auth.users where id = auth.uid();
  select * into a from doctor_applications where id = p_id for update;
  if a.id is null then perform fail('NOT_FOUND', 'That application no longer exists.'); end if;
  if a.status <> 'pending' then perform fail('CONFLICT', 'This application has already been reviewed.'); end if;

  if p_decision = 'decline' then
    if v_note is null then perform fail('VALIDATION', 'Tell the doctor why, so they can correct it.'); end if;
    update doctor_applications set status = 'declined', review_note = v_note, reviewed_by = v_me, reviewed_at = now() where id = a.id returning * into a;
    insert into notifications (user_id, kind, title, body, link) values (a.user_id, 'security', 'Your application needs changes', v_note, '/doctor-application');
    return _application_json(a);
  end if;
  if p_decision <> 'approve' then perform fail('VALIDATION', 'Choose approve or decline.'); end if;

  perform _assert_registration_free(a.registration_number, a.user_id);
  select id into v_hospital from hospitals where lower(name) = lower(a.hospital_name) and lower(city) = lower(a.hospital_city) limit 1;
  if v_hospital is null then
    insert into hospitals (name, city, type) values (a.hospital_name, a.hospital_city, a.hospital_type) returning id into v_hospital;
  end if;
  loop
    v_code := 'DR-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists (select 1 from doctors where access_code = v_code);
  end loop;
  insert into doctors (user_id, full_name, specialization, registration_number, hospital_id, email, phone, access_code,
                       years_of_practice, qualifications, verified_at)
  values (a.user_id, a.full_name, a.specialization, a.registration_number, v_hospital, a.email, a.phone, v_code,
          a.years_of_practice, a.qualifications, now())
  returning id into v_doctor;
  update accounts set role = 'doctor', onboarded = true where user_id = a.user_id;
  update doctor_applications set status = 'approved', review_note = v_note, reviewed_by = v_me, reviewed_at = now(), doctor_id = v_doctor
  where id = a.id returning * into a;
  insert into notifications (user_id, kind, title, body, link) values (a.user_id, 'security', 'You''re verified on Niveda',
    'Your registration has been checked. Patients can now share their records with you using your access code ' || v_code || '.', '/doctor');
  return _application_json(a);
end $$;

grant execute on function
  public.is_admin(), public.my_doctor_application(), public.update_doctor_application(jsonb),
  public.admin_doctor_applications(text), public.admin_review_doctor_application(text, text, text)
to authenticated;
-- my_account() and complete_signup() were replaced above and keep their existing grants.

-- ==================================================================
-- 20260930000002_emergency_access.sql
-- ==================================================================

-- Niveda — emergency ("break-glass") access
--
-- When a patient can't consent (unconscious, unable to communicate) a verified
-- doctor can open the emergency essentials of their record:
--   * only allergies, medications, conditions/history and surgeries;
--   * for 4 hours, then it ends by itself;
--   * with a stated reason and a written justification;
--   * confirmed with a fresh emailed code;
--   * at most 3 times per doctor in 24 hours.
-- The patient is notified at once and can end it; it is written to their access
-- log, and every use is reviewed by the Niveda team.

alter table public.access_grants drop constraint if exists access_grants_method_check;
alter table public.access_grants add constraint access_grants_method_check
  check (method in ('directory', 'code', 'qr', 'invite', 'request', 'emergency'));

create table if not exists public.emergency_accesses (
  id text primary key default public.new_id('emg'),
  grant_id text not null references public.access_grants(id) on delete cascade,
  patient_id text not null references public.patients(id) on delete cascade,
  doctor_id text not null references public.doctors(id) on delete cascade,
  reason text not null,
  justification text not null,
  created_at timestamptz not null default now(),
  review_status text not null default 'pending' check (review_status in ('pending', 'appropriate', 'concern')),
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz
);
create index if not exists emergency_accesses_doctor on public.emergency_accesses (doctor_id, created_at desc);
create index if not exists emergency_accesses_review on public.emergency_accesses (review_status, created_at);
alter table public.emergency_accesses enable row level security;
-- No policies: read only through the functions below.

create or replace function public._emergency_reason_label(p text) returns text
language sql immutable as $$
  select case p
    when 'unconscious' then 'Patient is unconscious'
    when 'cannot_communicate' then 'Patient can’t communicate'
    when 'life_threatening' then 'Life-threatening emergency'
    when 'confused' then 'Patient is confused or disoriented'
    else null end
$$;

create or replace function public.emergency_access(p_code text, p_reason text, p_justification text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d doctors := _require_doctor();
  p patients;
  g access_grants;
  v_label text := _emergency_reason_label(p_reason);
  v_just text := regexp_replace(trim(coalesce(p_justification, '')), '\s+', ' ', 'g');
  v_hospital text;
  v_recent int;
begin
  if d.verified_at is null then perform fail('ACCESS_DENIED', 'Only verified doctors can use emergency access.'); end if;
  if v_label is null then perform fail('VALIDATION', 'Choose why the patient can’t give consent.'); end if;
  if length(v_just) < 20 then perform fail('VALIDATION', 'Describe the emergency in a sentence or two (at least 20 characters). The patient and the Niveda team will read it.'); end if;
  select * into p from patients where replace(patient_code, '-', '') = replace(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), '-', '');
  if not found then perform fail('NOT_FOUND', 'No patient matches that ID. Check the ID on their card or phone.'); end if;
  perform _sweep_grants(p.id, d.id);
  if has_grant(p.id) then perform fail('CONFLICT', 'You already have access to this patient’s record.'); end if;
  select count(*) into v_recent from emergency_accesses where doctor_id = d.id and created_at > now() - interval '24 hours';
  if v_recent >= 3 then perform fail('ACCESS_DENIED', 'You’ve used emergency access 3 times in the last 24 hours. Contact the Niveda team if you need more.'); end if;
  perform _require_step_up();

  insert into access_grants (patient_id, doctor_id, permissions, expires_at, method, verification, reminder_sent)
  values (p.id, d.id, array['allergies', 'medications', 'history', 'surgeries'], now() + interval '4 hours', 'emergency',
          jsonb_build_object('method', 'otp', 'verifiedAt', now(), 'reason', p_reason, 'justification', v_just), true)
  returning * into g;
  insert into emergency_accesses (grant_id, patient_id, doctor_id, reason, justification) values (g.id, p.id, d.id, p_reason, v_just);
  select name into v_hospital from hospitals where id = d.hospital_id;

  perform _audit(p.id, _actor(), 'emergency_access',
    jsonb_build_object('type', 'doctor', 'id', d.id, 'label', d.full_name),
    jsonb_build_object('reason', v_label, 'justification', v_just, 'duration', '4 hours',
                       'permissions', _perm_labels(g.permissions), 'method', 'Emergency access'));
  perform _notify(_patient_user(p.id), 'access', 'Emergency access to your record',
    d.full_name || coalesce(' (' || v_hospital || ')', '') || ' opened your allergies, medicines, conditions and surgeries in an emergency: '
      || v_label || '. It ends by itself in 4 hours. If you didn’t expect this, end it now.', '/app/access');
  return jsonb_build_object('patientId', p.id, 'grantId', g.id, 'expiresAt', g.expires_at);
end $$;

/* ------------------------------------------------------------------ */
/* Review by the Niveda team                                           */
/* ------------------------------------------------------------------ */
create or replace function public.admin_emergency_accesses(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform _require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'createdAt', e.created_at, 'reason', _emergency_reason_label(e.reason), 'justification', e.justification,
      'reviewStatus', e.review_status, 'reviewNote', e.review_note, 'reviewedAt', e.reviewed_at,
      'doctor', jsonb_build_object('name', d.full_name, 'registrationNumber', d.registration_number, 'hospital', h.name, 'email', d.email),
      'patient', jsonb_build_object('code', p.patient_code, 'maskedName', _mask_name(p.full_name)),
      'endedAt', coalesce(g.revoked_at, least(g.expires_at, now())), 'endedEarly', g.status = 'revoked',
      'doctorUsesLast30Days', (select count(*) from emergency_accesses x where x.doctor_id = e.doctor_id and x.created_at > now() - interval '30 days')
    ) order by e.created_at desc)
    from emergency_accesses e
    join doctors d on d.id = e.doctor_id
    left join hospitals h on h.id = d.hospital_id
    join patients p on p.id = e.patient_id
    join access_grants g on g.id = e.grant_id
    where p_status is null or p_status = 'all' or e.review_status = p_status
  ), '[]');
end $$;

create or replace function public.admin_review_emergency_access(p_id text, p_outcome text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare e emergency_accesses; v_me text; v_note text := nullif(trim(coalesce(p_note, '')), ''); g access_grants;
begin
  perform _require_admin();
  if p_outcome not in ('appropriate', 'concern') then perform fail('VALIDATION', 'Choose appropriate or concern.'); end if;
  if p_outcome = 'concern' and v_note is null then perform fail('VALIDATION', 'Write down the concern.'); end if;
  select * into e from emergency_accesses where id = p_id for update;
  if e.id is null then perform fail('NOT_FOUND', 'That emergency access no longer exists.'); end if;
  select email into v_me from auth.users where id = auth.uid();
  update emergency_accesses set review_status = p_outcome, review_note = v_note, reviewed_by = v_me, reviewed_at = now() where id = e.id;
  if p_outcome = 'concern' then
    -- End it at once if it's still running.
    select * into g from access_grants where id = e.grant_id for update;
    if g.status = 'active' then
      update access_grants set status = 'revoked', revoked_at = now() where id = g.id;
      perform _audit(e.patient_id, _system_actor(), 'access_revoked', jsonb_build_object('type', 'doctor', 'id', e.doctor_id, 'label', (select full_name from doctors where id = e.doctor_id)),
        jsonb_build_object('by', 'Niveda team review'));
    end if;
  end if;
end $$;

grant execute on function
  public.emergency_access(text, text, text),
  public.admin_emergency_accesses(text), public.admin_review_emergency_access(text, text, text)
to authenticated;

-- ==================================================================
-- 20261001000001_handover_note.sql
-- ==================================================================

-- Niveda — note for the next visit
--
-- Every consultation a doctor records now ends with a note for the next visit:
-- what the same doctor at the follow-up, or a different doctor if the patient
-- goes elsewhere, should know or check. It is stored on the consultation as
-- data.handoverNote, so it follows the same access rules as the consultation
-- (the "history" permission) and keeps the usual version history.
--
-- Older consultations, and consultations patients add themselves, may have none.

-- 1. The consultation record type accepts the new field (kept identical to
--    src/lib/recordMeta.ts; the database tests compare the two).
update public.record_types
set field_keys = array['reason', 'doctor', 'facility', 'symptoms', 'diagnosis', 'medications', 'followUp', 'notes', 'handoverNote']::text[]
where type = 'consultation';

-- 2. A doctor can't add a consultation without the note. Checked here, where
--    every new entry is written, so it holds for add_visit and create_record
--    alike. 10 characters matches HANDOVER_MIN_LENGTH in the app.
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
  if actor ->> 'role' = 'doctor' and p_type = 'consultation' then
    if coalesce(clean ->> 'handoverNote', '') = '' then
      perform fail('VALIDATION', 'Write a note for the next visit before saving.');
    end if;
    if char_length(clean ->> 'handoverNote') < 10 then
      perform fail('VALIDATION', 'The note for the next visit needs at least 10 characters.');
    end if;
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
