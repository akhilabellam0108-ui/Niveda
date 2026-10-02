# Running Niveda on Supabase

This guide takes you from nothing to a live Niveda with real accounts. It takes about 30–45 minutes the first time.

Without these settings the app runs as the **demo** (fictional data, everything stored in the browser). Once the site is connected, the demo stays available at `…/demo/`.

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

**Database → Extensions** → search **pg_cron** → enable it. Then search **pg_net** → enable it too (it lets the database call the medicine-reminder function, step 9).

(Do this before step 3, so the access-expiry job is scheduled automatically.)

## 3. Create the database

Pick one:

**A. One file (easiest).** Open **SQL Editor → New query**, paste the whole of `supabase/setup.sql` and click **Run**. It should end with "Success. No rows returned". Then make yourself an administrator (the person who verifies doctors), with the email you'll sign in with:

```sql
insert into public.admins (email) values ('you@example.com');
```

**B. Supabase CLI.**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

`supabase/setup.sql` is all the files in `supabase/migrations` joined together. For a project that's already set up, run only the migration files that are new — in order, one at a time, in the SQL Editor. (Added on 2 October 2026: `20261002000001_no_documents.sql` — the "I have no documents to upload" option in setup — and `20261002000002_web_push.sql` — pushed medicine reminders.)

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

## 6. Doctors

Doctors apply in the app: **Sign up → "Are you a doctor? Apply to join as a doctor"** (or `#/signup/doctor`). They give their medical council, registration number, qualifications and where they work, and confirm their email with a code. Until they're verified they only see their application.

As an administrator (step 3), open **Doctor verification** from your account menu (or go to `#/admin`). For each application:

1. **Check the medical register** — the button opens the NMC's Indian Medical Register. Search the registration number and council, and check the name matches.
2. **Verify doctor** — creates their profile, marks it verified and gives them an access code for patients. They're told in the app.
3. Or **Ask for changes** with a note — they see it, correct the details and resubmit.

A registration number can only belong to one account. The database checks every one of these rules, so a modified app can't skip them.

**Adding a doctor yourself** (e.g. a pilot hospital) still works with the script, using the service-role key from **Project Settings → API** on your own computer:

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
npm run create-doctor -- --email dr.meena@hospital.in --name "Dr. Meena Iyer" \
  --registration "TSMC-12345" --specialization "Cardiology" \
  --hospital "Northbridge Hospital" --city Hyderabad
```

### Emergency access reviews

When a patient can't consent, a verified doctor can use **Emergency access** (on *Find a patient*): allergies, medicines, conditions and surgeries only, for 4 hours, with a reason and a fresh code, at most 3 times a day. The patient is told at once. Every use appears under **Niveda team → Emergency access**: mark it appropriate, or raise a concern, which ends the access immediately.

## 7. Try it end to end

1. Sign up as a patient (use an email you can read) → enter the emailed code → complete the setup (upload any PDF or photo as the document).
2. In another browser (or a private window), apply as a doctor, then verify them from **Doctor verification** in your admin account, and sign in as the doctor.
3. As the patient: **Doctors & access → Grant access** → enter the doctor's code → confirm with the emailed code.
4. As the doctor: open the patient → **Add to medical record**.
5. As the patient: the visit appears within seconds, with a notification and an entry in the **Access log**.
6. Revoke access — the doctor's view of the patient stops immediately.

## 8. Deploy

**GitHub Pages (set up in this repository).** Repo → **Settings → Secrets and variables → Actions → Variables → New repository variable**, add:

- `VITE_SUPABASE_URL` — the Project URL
- `VITE_SUPABASE_ANON_KEY` — the anon public key
- `VITE_VAPID_PUBLIC_KEY` — optional, for pushed medicine reminders (step 9)

Then **Actions → Deploy to GitHub Pages → Run workflow** (it also runs on every push to `main`). The app is at `https://<owner>.github.io/Niveda/` and the demo at `…/Niveda/demo/`. Set **Site URL** (step 4) to the app's address.

**Any other static host** (Vercel, Netlify, Cloudflare Pages): build command `npm run build`, output directory `dist`, the same two environment variables. Routes are hash-based, so no rewrites are needed.

## 9. Medicine reminders on iPhone, iPad and computers (optional)

The Android app rings its own alarms. For everyone else, Niveda can **push** each dose as a notification — with a **Taken** button — even when Niveda is closed: iPhone and iPad (once Niveda is added to the Home Screen, iOS 16.4+), Android browsers, Windows, macOS, Linux and Chromebooks. A paired watch buzzes with it. Without this step, reminders still pop up while Niveda is open.

1. Make a key pair (once): `npx web-push generate-vapid-keys`. Keep the private key secret.
2. Deploy the function that sends them (Supabase CLI, linked as in step 3B):

   ```bash
   npx supabase functions deploy send-reminders --no-verify-jwt
   npx supabase secrets set VAPID_PUBLIC_KEY=<public key> VAPID_PRIVATE_KEY=<private key> \
     VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=<a long random string>
   ```

   (`--no-verify-jwt` because the database calls it with `CRON_SECRET` instead of a user's sign-in.)
3. In the **SQL Editor**, switch it on — it runs every minute from then on:

   ```sql
   select public.configure_push_reminders('https://<ref>.supabase.co/functions/v1/send-reminders', '<the same CRON_SECRET>');
   ```

4. Add the public key to the app: the repository variable (or `.env.local` entry) **`VITE_VAPID_PUBLIC_KEY`**, then redeploy (step 8).

Patients then see **Allow** on the *Medications* page. Each device gets reminders in its own time zone; a dose already marked taken or skipped isn't sent, and signing out stops reminders on that device. Check it's running under **Database → Cron Jobs** (`niveda-push-reminders`) and **Edge Functions → send-reminders → Logs**.

Privacy: messages are end-to-end encrypted to the device, but the notification shows the medicine's name and dose, as on the Android app.

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
- **Automatic doctor verification.** Doctors are verified by an administrator checking the register by hand. Connecting to ABDM's Healthcare Professionals Registry would confirm them automatically.
- **Virus scanning** of uploads and **field-level encryption** for mental-health and other sensitive records (Supabase already encrypts all data at rest and in transit).
- Hospital accounts, **ABDM/ABHA** and **FHIR**, an **iPhone app** and a dedicated **smartwatch** app (Android alarms and pushed web reminders already work).
- **A security review and penetration test**, and a DPDP Act compliance review (consent notices, retention, a grievance officer).

## Tests

```bash
npm test                 # demo service flows (18 checks)
npm run test:db          # access rules in the database (needs a Postgres; see tests/db)
npm run test:live        # the live app code against Supabase Auth + PostgREST (see tests/live/README.md)
```

All three run in CI on every push.
