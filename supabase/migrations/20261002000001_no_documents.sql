-- Onboarding: someone with no medical documents to upload can say so explicitly
-- ("I have no documents to upload"), like every other onboarding section.
-- Uploading at least one document OR ticking "none" is required.

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
  if jsonb_array_length(coalesce(p -> 'documents', '[]')) = 0 and not coalesce((p ->> 'noDocuments')::boolean, false) then
    perform fail('VALIDATION', 'Upload your medical documents, or confirm you have none to upload.');
  end if;
  if jsonb_array_length(coalesce(p -> 'documents', '[]')) > 0 and coalesce((p ->> 'noDocuments')::boolean, false) then
    perform fail('VALIDATION', 'You uploaded documents but also ticked “none”. Remove one.');
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
      'noDocuments', nullif(coalesce((p ->> 'noDocuments')::boolean, false), false),
      'confirmedAt', now()))
  where id = me.id;
  update accounts set onboarded = true where user_id = auth.uid();
end $$;
