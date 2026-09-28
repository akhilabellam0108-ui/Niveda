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
