-- ABHA (Ayushman Bharat Health Account) linking.
--
-- A patient proves they own an ABHA with a code ABDM sends to the ABHA's mobile;
-- the abdm Edge Function then reads the ABHA profile from ABDM and calls
-- _link_abha with the service role. Patients can't write links themselves, so an
-- ABHA can only be linked by someone who completed ABDM's verification.

create table public.abha_links (
  patient_id text primary key references public.patients(id) on delete cascade,
  abha_number text not null,
  abha_address text not null default '',
  abha_name text not null,
  linked_at timestamptz not null default now()
);
-- One ABHA, one Niveda record.
create unique index abha_links_number_key on public.abha_links (regexp_replace(abha_number, '\D', '', 'g'));
alter table public.abha_links enable row level security;
create policy "patient reads own ABHA link" on public.abha_links for select to authenticated
  using (patient_id = public.my_patient_id());
revoke insert, update, delete on public.abha_links from anon, authenticated;
grant select on public.abha_links to authenticated;

create or replace function public._abha_json(l abha_links) returns jsonb
language sql immutable as $$
  select case when l.patient_id is null then null else jsonb_build_object(
    'abhaNumber', l.abha_number, 'abhaAddress', l.abha_address, 'name', l.abha_name, 'linkedAt', l.linked_at) end
$$;

-- Service role only (the abdm Edge Function), after ABDM verified the person.
create or replace function public._link_abha(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pat patients; l abha_links; num text := coalesce(p ->> 'abhaNumber', '');
begin
  select * into pat from patients where user_id = p_user;
  if pat.id is null then perform fail('ACCESS_DENIED', 'Only patients can link an ABHA.'); end if;
  if regexp_replace(num, '\D', '', 'g') !~ '^\d{14}$' then perform fail('VALIDATION', 'ABDM returned an invalid ABHA number.'); end if;
  if exists (select 1 from abha_links where regexp_replace(abha_number, '\D', '', 'g') = regexp_replace(num, '\D', '', 'g') and patient_id <> pat.id) then
    perform fail('CONFLICT', 'This ABHA is already linked to another Niveda record.');
  end if;
  insert into abha_links (patient_id, abha_number, abha_address, abha_name)
  values (pat.id, num, coalesce(p ->> 'abhaAddress', ''), coalesce(p ->> 'name', ''))
  on conflict (patient_id) do update set abha_number = excluded.abha_number, abha_address = excluded.abha_address,
    abha_name = excluded.abha_name, linked_at = now()
  returning * into l;
  perform _audit(pat.id, jsonb_build_object('id', pat.id, 'role', 'patient', 'name', pat.full_name), 'abha_linked',
    jsonb_build_object('type', 'account', 'label', 'ABHA xx-xxxx-xxxx-' || right(regexp_replace(num, '\D', '', 'g'), 4)));
  return _abha_json(l);
end $$;
revoke execute on function public._link_abha(uuid, jsonb) from public, anon, authenticated;
grant execute on function public._link_abha(uuid, jsonb) to service_role;

create or replace function public.my_abha() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select _abha_json(l) from abha_links l where l.patient_id = my_patient_id()
$$;

create or replace function public.unlink_abha() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me text := my_patient_id(); n text;
begin
  if me is null then perform fail('ACCESS_DENIED', 'Only patients can unlink an ABHA.'); end if;
  delete from abha_links where patient_id = me returning abha_number into n;
  if n is null then perform fail('NOT_FOUND', 'No ABHA is linked.'); end if;
  perform _audit(me, _actor(), 'abha_unlinked', jsonb_build_object('type', 'account', 'label', 'ABHA xx-xxxx-xxxx-' || right(regexp_replace(n, '\D', '', 'g'), 4)));
end $$;

revoke execute on function public.my_abha(), public.unlink_abha(), public._abha_json(abha_links) from public, anon;
grant execute on function public.my_abha(), public.unlink_abha() to authenticated;
