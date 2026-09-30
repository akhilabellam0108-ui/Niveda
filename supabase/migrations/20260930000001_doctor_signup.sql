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
