# Running Niveda on Supabase

This guide takes you from nothing to a live Niveda with real accounts. It takes about 30–45 minutes the first time.

Without these settings the app runs as the **demo** (fictional data, everything stored in the browser). The public GitHub Pages demo always stays in demo mode.

## What you get

| Area | Demo | Live (Supabase) |
|---|---|---|
| Accounts | Simulated | Supabase Auth; passwords hashed on the server |
| One-time codes | Shown on screen | **Emailed** (sign-up, every sign-in, granting/approving/widening access, password reset) |
| Data | This browser only | Postgres, synced across devices |
| Access rules | Checked in the browser | **Enforced by the database** (row-level security + server functions); the browser is never trusted |
| Audit log | In the browser | Written by the server in the same transaction as each change; append-only and hash-chained |
| Documents | Browser storage | Private storage bucket, same access rules, no public links |
| Access expiry | Checked on read | Checked on every read **and** a background job every 5 minutes |
| Live updates | Between tabs | Between devices (Supabase Realtime) |

## 1. Create the project

1. Sign in at [supabase.com](https://supabase.com) → **New project**.
2. Pick the region **closest to your users** — for India, **Mumbai (ap-south-1)**, which also keeps health data in India.
3. Save the database password somewhere safe.

## 2. Turn on the background job extension

**Database → Extensions** → search **pg_cron** → enable it.

(Do this before step 3, so the access-expiry job is scheduled automatically.)

## 3. Create the database

Pick one:

**A. SQL editor (no tools needed).** Open **SQL Editor → New query**. Paste the contents of each file below, **in this order**, and click **Run** after each:

1. `supabase/migrations/20260928000001_schema.sql`
2. `supabase/migrations/20260928000002_api.sql`
3. `supabase/migrations/20260928000003_storage_jobs_privileges.sql`

Each should end with "Success. No rows returned".

**B. Supabase CLI.**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Check it worked: **Table Editor** should list `patients`, `records`, `access_grants`, `audit_log` and others, each marked "RLS enabled". **Storage** should show a private bucket called `documents`.

## 4. Configure sign-in

### Email provider

**Authentication → Sign In / Providers → Email**:

- **Enable email provider**: on
- **Confirm email**: **on** (sign-up is verified with the emailed code)
- **Email OTP length**: 6
- **Email OTP expiration**: 600 seconds (10 minutes)
- Minimum password length: 8

### Email templates — must include the code

Niveda asks people to type a 6-digit code, so the emails must contain `{{ .Token }}`. Open **Authentication → Emails → Templates** and replace the body of these three:

**Confirm signup** — subject: `Your Niveda code`

```html
<h2>Welcome to Niveda</h2>
<p>Enter this code to confirm your email and finish creating your record:</p>
<p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
<p>It expires in 10 minutes. If you didn't sign up, you can ignore this email.</p>
```

**Magic Link** (used for sign-in and for confirming access grants) — subject: `Your Niveda code`

```html
<p>Your Niveda code is:</p>
<p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
<p>It expires in 10 minutes. Never share it — Niveda staff and doctors will never ask for it.</p>
```

**Reset Password** — subject: `Reset your Niveda password`

```html
<p>Enter this code in Niveda to choose a new password:</p>
<p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
<p>If you didn't ask for this, you can ignore this email.</p>
```

### Email delivery (required before real users)

Supabase's built-in email is for testing only: it sends a handful of emails per hour, and only to members of your Supabase team. Since Niveda emails a code at every sign-in, set up your own sender:

1. Create an account with an email provider (for example Resend, Amazon SES, Brevo or Postmark) and verify your domain.
2. **Authentication → Emails → SMTP Settings** → enable custom SMTP and enter the provider's host, port, username and password. Use a sender like `no-reply@yourdomain`.
3. **Authentication → Rate Limits**: raise "emails sent per hour" to fit your users.

### URLs

**Authentication → URL Configuration → Site URL**: the address where the app is hosted (for local testing, `http://localhost:5173`).

## 5. Connect the app

In **Project Settings → API** copy the **Project URL** and the **anon public** key.

```bash
cp .env.example .env.local
# edit .env.local:
#   VITE_SUPABASE_URL=https://<ref>.supabase.co
#   VITE_SUPABASE_ANON_KEY=<anon key>
npm install
npm run dev
```

Open http://localhost:5173. The prototype banners and demo accounts disappear — that's how you know it's live.

The anon key is designed to be public; the database's access rules are what protect the data. **Never** put the `service_role` key in a `VITE_` variable or commit it.

## 6. Add hospitals and doctors

Doctors can't sign up themselves — you check their medical council registration first, then add them. Run on your own computer (the service-role key is in **Project Settings → API**):

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
npm run create-doctor -- --email dr.meena@hospital.in --name "Dr. Meena Iyer" \
  --registration "TSMC-12345" --specialization "Cardiology" \
  --hospital "Northbridge Hospital" --city Hyderabad
```

The hospital is created if it doesn't exist. The script prints the doctor's **access code** (e.g. `DR-4F2A`) for patients to use. Ask the doctor to open Niveda and use **Forgot password** to choose their password (or pass `--password` to set one yourself).

## 7. Try it end to end

1. Sign up as a patient (use an email you can read) → enter the emailed code → complete the setup (upload any PDF or photo as the document).
2. In another browser (or a private window), sign in as the doctor.
3. As the patient: **Doctors & access → Grant access** → enter the doctor's code → confirm with the emailed code.
4. As the doctor: open the patient → **Add to medical record**.
5. As the patient: the visit appears within seconds, with a notification and an entry in the **Access log**.
6. Revoke access — the doctor's view of the patient stops immediately.

## 8. Deploy

The app is a static site (hash-based routes, so no server rewrites are needed). Any static host works — for example Vercel, Netlify or Cloudflare Pages:

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

Then set **Site URL** (step 4) to the deployed address.

The GitHub Pages workflow builds without these variables, so the public demo stays a demo.

## Operating it

- **Access expiry job**: **Database → Cron Jobs** should list `niveda-sweep-grants` every 5 minutes. If pg_cron was enabled after running the migrations, run the "Background job" block from the third migration again.
- **Audit log integrity**: in the SQL editor, `select public.verify_audit_chain();` returns `null` when the log is intact, or the first entry that doesn't match.
- **Backups**: daily backups are included on paid plans; turn on Point-in-Time Recovery for health data.
- **Deleting an account** (a patient's right under the DPDP Act) is deliberately guarded, because the audit log and record history are append-only:

  ```sql
  begin;
  set local niveda.allow_erasure = 'on';
  delete from auth.users where email = 'person@example.com';
  commit;
  ```

- The Supabase **Security Advisor** will point out that `doctor_directory` is a "security definer view". That's intentional: it lets patients search doctors without exposing doctors' contact details or access codes.

## Still to do before real patients

This backend makes the core rules real, but a health-records service needs more before launch:

- **Server-enforced two-factor sign-in.** The app requires password + emailed code, but the server would also accept a code alone. Turn on Supabase MFA (authenticator app) to enforce a second factor on the server.
- **SMS codes.** Codes go by email; for SMS, connect a provider (Twilio, MessageBird or Vonage in Supabase's phone settings, or MSG91 via a custom hook for India).
- **Unskippable view logging for documents.** Views are logged by the app. To make logging impossible to skip even with a modified app, serve downloads through an Edge Function that logs and then issues a short-lived signed link.
- **Doctor invitations** are recorded but not yet emailed.
- **Virus scanning** of uploads and **field-level encryption** for mental-health and other sensitive records (Supabase already encrypts all data at rest and in transit).
- **Clinician verification against medical council registries**, hospital accounts, **break-glass emergency access**, **ABDM/ABHA** and **FHIR**, the **mobile app** (alarms when the app is closed) and **smartwatch** integration.
- **A security review and penetration test**, and a DPDP Act compliance review (consent notices, retention, a grievance officer).

## Tests

```bash
npm test                 # demo service flows (18 checks)
npm run test:db          # access rules in the database (needs a Postgres; see tests/db)
npm run test:live        # the live app code against Supabase Auth + PostgREST (see tests/live/README.md)
```

All three run in CI on every push.
