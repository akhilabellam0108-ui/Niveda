-- SMS one-time codes.
--
-- With VITE_OTP_CHANNEL=sms, codes go to the login's verified phone through
-- Supabase phone auth. Supabase calls the send-sms Edge Function (the "Send SMS"
-- auth hook), which delivers through MSG91 (India, DLT template) or Twilio.
--
-- A phone becomes verified when its owner enters the code Supabase texts to it
-- (auth.users.phone_confirmed_at). This function then copies the verified number
-- to the patient or doctor profile and writes it to the audit log.

create or replace function public.log_phone_verified(p_phone text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u auth.users; digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  select * into u from auth.users where id = auth.uid();
  if u.id is null then perform fail('NOT_SIGNED_IN', 'Please sign in to continue.'); end if;
  if u.phone_confirmed_at is null or regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') <> digits then
    perform fail('VALIDATION', 'That phone number hasn’t been confirmed yet.');
  end if;
  update patients set phone = '+' || digits where user_id = u.id;
  update doctors set phone = '+' || digits where user_id = u.id;
  perform _audit(my_patient_id(), _actor(), 'phone_verified',
    jsonb_build_object('type', 'account', 'label', '•••• ••' || right(digits, 4)));
end $$;

revoke execute on function public.log_phone_verified(text) from public, anon;
grant execute on function public.log_phone_verified(text) to authenticated;

-- Step-up codes can now arrive by SMS too; the wording no longer says "email".
create or replace function public._require_step_up() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare ts bigint; sid uuid;
begin
  select max((a ->> 'timestamp')::bigint) into ts
  from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
  where a ->> 'method' in ('otp', 'magiclink', 'email/signup', 'sms/signup');
  if ts is null or to_timestamp(ts) < now() - interval '10 minutes' then
    perform fail('OTP_EXPIRED', 'Please confirm with the code we send you, then try again.');
  end if;
  sid := coalesce(nullif(auth.jwt() ->> 'session_id', '')::uuid, '00000000-0000-0000-0000-000000000000');
  insert into step_up_uses (session_id, verified_at) values (sid, ts) on conflict do nothing;
  if not found then perform fail('OTP_EXPIRED', 'That code has already been used. Request a new one.'); end if;
end $$;
