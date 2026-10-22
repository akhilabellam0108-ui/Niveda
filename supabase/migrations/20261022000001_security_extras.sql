-- Security extras: two-step sign-in for doctors and the Niveda team, safety checks
-- on uploaded files, document views that can't skip the log, and a health check.

/* ================================================================== */
/* 1. Two-step sign-in (authenticator app) for doctors and admins      */
/* ================================================================== */
-- When switched on, a doctor's session must have passed a second step (Supabase MFA,
-- "aal2" in the token) before the database shows them any patient data or lets them
-- act as a doctor; likewise for Niveda team (admin) actions. Off by default so a new
-- project can be set up first; turn on with:
--   update public.security_settings set doctor_mfa_required = true, admin_mfa_required = true;

create table if not exists public.security_settings (
  id boolean primary key default true check (id),
  doctor_mfa_required boolean not null default false,
  admin_mfa_required boolean not null default false
);
insert into public.security_settings (id) values (true) on conflict do nothing;
alter table public.security_settings enable row level security;
revoke all on public.security_settings from public, anon, authenticated;

-- True when this request's session passed the second step.
create or replace function public._mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal2'
$$;

create or replace function public._doctor_mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce((select s.doctor_mfa_required from public.security_settings s), false) or public._mfa_ok()
$$;

-- For the app: does this account have to use two-step sign-in?
create or replace function public.mfa_required() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select doctor_mfa_required from security_settings), false) and exists (select 1 from doctors where user_id = auth.uid())
      or coalesce((select admin_mfa_required from security_settings), false) and is_admin()
$$;

-- Patient data: a doctor's grants only count once the session passed the second step.
create or replace function public.has_grant(p_patient text, p_perm text default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select public._doctor_mfa_ok() and exists (
    select 1 from public.access_grants g
    where g.doctor_id = public.my_doctor_id() and g.patient_id = p_patient
      and g.status = 'active' and g.expires_at > now()
      and (p_perm is null or p_perm = any (g.permissions))
  )
$$;

-- Every doctor action (adding entries, requesting access, emergency access, …).
create or replace function public._require_doctor() returns doctors
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d doctors;
begin
  select * into d from doctors where user_id = auth.uid();
  if not found then perform fail('ACCESS_DENIED', 'This area isn’t available for your account.'); end if;
  if not _doctor_mfa_ok() then perform fail('ACCESS_DENIED', 'Confirm it’s you with your authenticator app first (two-step sign-in).'); end if;
  return d;
end $$;

create or replace function public._require_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then perform fail('NOT_SIGNED_IN', 'Please sign in to continue.'); end if;
  if not is_admin() then perform fail('ACCESS_DENIED', 'Only the Niveda team can do this.'); end if;
  if coalesce((select admin_mfa_required from security_settings), false) and not _mfa_ok() then
    perform fail('ACCESS_DENIED', 'Confirm it’s you with your authenticator app first (two-step sign-in).');
  end if;
end $$;

/* ================================================================== */
/* 2. Safety check on uploaded files                                   */
/* ================================================================== */
-- New files start as 'pending'. The document-access Edge Function checks the file
-- (supabase/functions/document-access/scan.ts) before it is first opened, and marks
-- it 'clean' or 'blocked'. A blocked file's contents are deleted and it can't be
-- opened; the entry stays so the patient sees what happened.

alter table public.documents add column if not exists scan_status text not null default 'pending';
alter table public.documents add column if not exists scan_note text;
alter table public.documents add column if not exists scanned_at timestamptz;
do $$ begin
  alter table public.documents add constraint documents_scan_status_check check (scan_status in ('pending', 'clean', 'blocked'));
exception when duplicate_object then null; end $$;

-- Who may read this document right now (the patient, or a doctor with a matching grant).
create or replace function public._can_read_document(d documents) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select d.patient_id = my_patient_id() or has_grant(d.patient_id, doc_perm(d.record_id, d.category))
$$;

-- For the document-access function, as the signed-in person: before scanning a file.
create or replace function public.document_for_scan(p_doc text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d documents;
begin
  select * into d from documents where id = p_doc;
  if not found or not (_can_read_document(d) or d.uploaded_by ->> 'id' in (my_patient_id(), my_doctor_id())) then
    perform fail('NOT_FOUND', 'This document isn’t available.');
  end if;
  return jsonb_build_object('id', d.id, 'path', d.storage_path, 'mime', d.mime_type, 'scanStatus', d.scan_status);
end $$;

-- For the document-access function, as the signed-in person: opening a file. Doctors'
-- views are always written to the patient's access log — files can only be read
-- through this function, so there's no way round it.
create or replace function public.open_document(p_doc text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare d documents; actor jsonb;
begin
  select * into d from documents where id = p_doc;
  if not found or not _can_read_document(d) then
    perform fail('ACCESS_DENIED', 'This document isn’t available — it may have been removed, or it isn’t shared with you.');
  end if;
  if my_doctor_id() is not null then
    actor := _actor();
    perform _audit(d.patient_id, actor, 'viewed_document', jsonb_build_object('type', 'document', 'id', d.id, 'label', d.name));
  end if;
  return jsonb_build_object('id', d.id, 'path', d.storage_path, 'name', d.name, 'mime', d.mime_type, 'scanStatus', d.scan_status, 'scanNote', d.scan_note);
end $$;

-- For the document-access function (service role): record the result of a check.
create or replace function public._set_document_scan(p_doc text, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d documents;
begin
  if p_status not in ('clean', 'blocked') then perform fail('VALIDATION', 'Unknown scan result.'); end if;
  update documents set scan_status = p_status, scan_note = left(p_note, 300), scanned_at = now()
  where id = p_doc and scan_status = 'pending' returning * into d;
  if not found or p_status = 'clean' then return; end if;
  perform _audit(d.patient_id, jsonb_build_object('id', 'system', 'role', 'system', 'name', 'Niveda'), 'document_blocked',
    jsonb_build_object('type', 'document', 'id', d.id, 'label', d.name));
  perform _notify(_patient_user(d.patient_id), 'security', 'A file was blocked',
    d.name || ' didn’t pass Niveda’s safety check and can’t be opened. ' || coalesce(p_note, ''), '/app/reports');
end $$;

-- Doctors can no longer read files straight from storage: only the document-access
-- function (service role) reads them, after open_document() has written the log.
-- Patients keep direct read access to their own folder (Storage needs it to delete
-- their own files), but the app opens their files through the function too.
do $$ begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "niveda: read permitted documents" on storage.objects;
    drop policy if exists "niveda: patients read own files" on storage.objects;
    create policy "niveda: patients read own files" on storage.objects for select to authenticated
      using (bucket_id = 'documents' and split_part(name, '/', 1) = public.my_patient_id());
  end if;
end $$;

/* ================================================================== */
/* 3. Health check for monitoring                                      */
/* ================================================================== */
-- Counts only — nothing about any person. Called by the scheduled GitHub workflow.
create or replace function public.system_health() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  failed_jobs int := 0; sweep_ok boolean := true; bad_calls int := 0; calls int := 0;
  overdue_deletions int; overdue_grievances int; stuck_scans int;
begin
  if to_regclass('cron.job_run_details') is not null then
    execute $q$select count(*) from cron.job_run_details where status = 'failed' and start_time > now() - interval '1 hour'$q$ into failed_jobs;
    execute $q$select coalesce(max(r.start_time) > now() - interval '15 minutes', false)
               from cron.job_run_details r join cron.job j on j.jobid = r.jobid
               where j.jobname = 'niveda-sweep-grants' and r.status = 'succeeded'$q$ into sweep_ok;
  end if;
  if to_regclass('net._http_response') is not null then
    execute $q$select count(*), count(*) filter (where status_code is null or status_code >= 300)
               from net._http_response where created > now() - interval '30 minutes'$q$ into calls, bad_calls;
  end if;
  select count(*) into overdue_deletions from deletion_requests where status = 'pending' and erase_after < now() - interval '1 day';
  select count(*) into overdue_grievances from grievances where status <> 'resolved' and respond_by < now();
  select count(*) into stuck_scans from documents where scan_status = 'pending' and uploaded_at < now() - interval '1 day';
  return jsonb_build_object(
    'ok', failed_jobs = 0 and sweep_ok and bad_calls = 0 and overdue_deletions = 0,
    'checkedAt', now(),
    'failedJobsLastHour', failed_jobs,
    'accessExpiryJobRunning', sweep_ok,
    'backgroundCallsLast30Min', calls,
    'failedBackgroundCallsLast30Min', bad_calls,
    'overdueDeletions', overdue_deletions,
    'overdueGrievances', overdue_grievances,
    'filesWaitingForCheckOver1Day', stuck_scans
  );
end $$;

/* ---------- privileges ---------- */
revoke execute on function public._mfa_ok(), public._doctor_mfa_ok(), public._can_read_document(documents),
  public._set_document_scan(text, text, text), public.mfa_required(), public.document_for_scan(text),
  public.open_document(text), public.system_health() from public, anon, authenticated;
grant execute on function public.mfa_required(), public.document_for_scan(text), public.open_document(text) to authenticated;
grant execute on function public._set_document_scan(text, text, text) to service_role;
grant execute on function public.system_health() to anon, authenticated;
