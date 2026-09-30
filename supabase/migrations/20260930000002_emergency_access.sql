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
