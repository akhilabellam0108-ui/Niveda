-- Field-level encryption for mental-health and other sensitive entries.
--
-- The contents (records.data and every record_versions.data) of entries whose
-- category is mental_health or sensitive are stored encrypted with AES-256
-- (pgcrypto, OpenPGP symmetric format). The key lives in Supabase Vault, never in
-- a table or the app, and only these security-definer functions can read it.
-- A database dump, a backup or someone browsing tables sees only ciphertext.
--
-- Reading: row-level security still decides who can see an entry; the app then
-- asks open_records() for the plaintext, which applies the same rule again.
-- Audit-log labels for these entries never contain their contents.

-- The key, created once. Rotating it: see docs/SECURITY.md.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'niveda_record_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'niveda_record_key',
      'Encrypts the contents of mental-health and sensitive records. Never delete: those records become unreadable.');
  end if;
end $$;

create or replace function public._record_key() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'niveda_record_key' limit 1
$$;

create or replace function public._is_sensitive_type(p_type text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select permission in ('mental_health', 'sensitive') from record_types where type = p_type), true)
$$;

create or replace function public._is_sealed(d jsonb) returns boolean
language sql immutable as $$ select coalesce(d ? '_enc', false) $$;

create or replace function public._seal(d jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare k text := _record_key();
begin
  if d is null or _is_sealed(d) then return d; end if;
  if k is null then raise exception using message = 'UNKNOWN: The encryption key is missing.', errcode = 'P0001'; end if;
  return jsonb_build_object('_enc', encode(extensions.pgp_sym_encrypt(d::text, k, 'cipher-algo=aes256, compress-algo=0'), 'base64'), '_k', 'v1');
end $$;

create or replace function public._open(d jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not _is_sealed(d) then return d; end if;
  return extensions.pgp_sym_decrypt(decode(d ->> '_enc', 'base64'), _record_key())::jsonb;
end $$;

create or replace function public._seal_record() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if _is_sensitive_type(new.type) then new.data := _seal(new.data); end if;
  return new;
end $$;

create or replace function public._seal_record_version() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if _is_sensitive_type((select type from records where id = new.record_id)) then new.data := _seal(new.data); end if;
  return new;
end $$;

create trigger records_seal before insert or update of data on public.records
  for each row execute function public._seal_record();
create trigger record_versions_seal before insert on public.record_versions
  for each row execute function public._seal_record_version();

-- Encrypt what's already there. Versions are append-only, so the guard is lifted
-- only for this one-time rewrite of their storage format (contents unchanged).
update public.records set data = data where public._is_sensitive_type(type) and not public._is_sealed(data);
alter table public.record_versions disable trigger record_versions_immutable;
update public.record_versions v set data = public._seal(v.data)
  from public.records r where r.id = v.record_id and public._is_sensitive_type(r.type) and not public._is_sealed(v.data);
alter table public.record_versions enable trigger record_versions_immutable;

-- Titles of sensitive entries (used in notifications and audit labels) are just the category.
create or replace function public._record_title(r records) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when _is_sealed(r.data) then rt.label
              else coalesce(nullif(trim(r.data ->> rt.title_key), ''), rt.label) end
  from record_types rt where rt.type = r.type
$$;

-- Corrections work on the plaintext; the trigger encrypts the new version.
create or replace function public.amend_record(p_id text, p_date date, p_data jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r records; nxt jsonb; changed text[]; actor jsonb := _actor(); internal jsonb;
begin
  if coalesce(trim(p_reason), '') = '' then perform fail('VALIDATION', 'Give a reason for the correction.'); end if;
  select * into r from records where id = p_id for update;
  if not found then perform fail('NOT_FOUND', 'This record could not be found.'); end if;
  r.data := _open(r.data); -- sensitive entries are stored encrypted
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

-- Plaintext of the entries (and their history) this person may see — the same
-- rule as the row-level security policy on records.
create or replace function public.open_records(p_ids text[]) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(r.id, jsonb_build_object(
      'data', _open(r.data),
      'versions', coalesce((select jsonb_object_agg(v.version::text, _open(v.data)) from record_versions v where v.record_id = r.id), '{}'::jsonb))), '{}'::jsonb)
  from records r
  where r.id = any (coalesce(p_ids, '{}')) and _is_sealed(r.data)
    and (r.patient_id = my_patient_id() or has_grant(r.patient_id, perm_for_type(r.type)))
$$;

revoke execute on function public._record_key(), public._seal(jsonb), public._open(jsonb), public._seal_record(),
  public._seal_record_version(), public._is_sensitive_type(text) from public, anon, authenticated;
revoke execute on function public.open_records(text[]) from public, anon;
grant execute on function public.open_records(text[]) to authenticated;
