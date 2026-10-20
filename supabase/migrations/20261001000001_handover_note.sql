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
