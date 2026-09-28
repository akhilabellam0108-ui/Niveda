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
