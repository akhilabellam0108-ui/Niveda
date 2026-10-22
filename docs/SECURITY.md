# Niveda security

How Niveda protects health records, what has been checked, and what an outside
penetration test must cover before real patients use it.

> **Status (October 2026):** internal review done and automated in the test suite.
> An **independent penetration test has not been done yet** — it must be, by a
> CERT-In empanelled auditor, before launch. The scope is at the end of this file.

## What we protect against

| Threat | Main defence |
|---|---|
| A doctor reading records they weren't given | Row-level security in Postgres: every read is checked against an active, unexpired grant for that category. The app is never trusted. |
| A patient or doctor reading someone else's data | Same — plus database functions that re-check the caller for every write. |
| Stolen password | Every sign-in needs a one-time code (email or SMS). Sensitive actions (sharing, deleting the account, emergency access) need a *fresh* code, usable once. |
| Stolen phone with an open session | Sessions listed in Security; sign out any device; password change signs out others. |
| Database dump / backup leak | Supabase encrypts disks and backups (AES-256). Mental-health and sensitive entries are encrypted **again** with a key held in Supabase Vault, so a dump shows only ciphertext. |
| Insider at Niveda browsing records | Staff have no in-app access to records. Admins see doctor applications, emergency-access summaries (masked patient name) and grievances only. |
| Tampering with history | Records are versioned; versions and the audit log are append-only and hash-chained (`verify_audit_chain()`). |
| Abuse of emergency access | Verified doctors only, written reason, fresh code, essentials only, 4 hours, 3 per day, patient told at once, every use reviewed. |
| Injected scripts (XSS) | React escapes output; no `dangerouslySetInnerHTML`; Content Security Policy blocks scripts from anywhere but the app itself. |
| Someone faking an ABHA link | Only the server can write a link, after ABDM verifies the person by OTP and the ABHA name and date of birth match the record. |
| SMS pumping / OTP abuse | Supabase Auth rate limits; the send-sms hook verifies Supabase's signature so nobody else can trigger texts. |

## Controls in place

- **Authorisation in the database.** Row-level security on every table; clients write only through
  `security definer` functions that pin `search_path`. Checked automatically on every test run (below).
- **Authentication.** Supabase Auth; passwords bcrypt-hashed by Supabase; one-time codes on every
  sign-in; step-up codes for sensitive actions (`_require_step_up`).
- **Encryption.** TLS for everything in transit. At rest: Supabase disk/backup encryption, plus
  field-level AES-256 (pgcrypto) for `mental_health` and `sensitive` entries and their full history.
- **Documents.** Private storage bucket, no public URLs; downloads only after the same permission check.
- **Logging.** Append-only, hash-chained audit log of every view, addition, correction, share, sign-in,
  consent change and deletion request; visible to the patient.
- **Privileges.** Client roles hold only the privileges a policy backs. Internal functions are callable
  only by the server (`service_role`). Default privileges stop new tables/functions leaking.
- **Web.** Content Security Policy, `no-referrer`, no third-party scripts or trackers.

## Automated security audit

`npm run test:db` runs, on a real Postgres with the real migrations, a test named
**"security: every table has row-level security…"** that fails the build if:

1. any table in `public` lacks row-level security (except the read-only `record_types` list);
2. `anon` or `authenticated` holds a write privilege (or any `TRUNCATE`) without a matching policy;
3. a signed-out user can execute an internal function (`_…`, `admin_…`, erase, configure, ABHA link, key, seal/open);
4. a signed-in user can execute a server-only function;
5. a `security definer` function doesn't pin its `search_path`.

Other tests prove each access rule with attacker accounts (patients, doctors, strangers).

### Findings from the internal review (fixed)

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | Supabase's default grants left `INSERT/UPDATE/DELETE/TRUNCATE` on `admins`, `doctor_applications`, `emergency_accesses` for client roles. RLS blocked writes, but `TRUNCATE` bypasses RLS. Not reachable through the REST API. | Medium (defence in depth) | `20261010000005_security_hardening.sql` revokes them and the default privileges. |
| 2 | Functions added after the original privilege reset (doctor sign-up, emergency review) were executable by signed-out users through PostgreSQL's default `PUBLIC` grant. Each checked permissions itself, so nothing leaked. | Low | Same migration revokes `EXECUTE` from `PUBLIC`/`anon` (except the push "Taken" action) and changes default privileges. |
| 3 | Audit-log labels and notifications included the title of mental-health entries. | Low (privacy) | Labels for sensitive entries now show only the category. |

## Key management

The record-encryption key is the Vault secret `niveda_record_key` (created by migration
`20261010000003`). **Never delete it** — sensitive entries become unreadable.

- Back it up offline (Supabase → Vault → reveal) into a sealed store two people control.
- **Rotation:** create `niveda_record_key_v2` in Vault, update `_record_key()` to read it and `_seal()`
  to write `"_k":"v2"`, teach `_open()` to pick the key by `_k`, then re-seal rows in batches
  (`update records set data = _seal(_open(data))` with the version guard lifted, as the migration does).
- Service-role keys, ABDM credentials, SMS keys and `CRON_SECRET` live only in Supabase secrets and
  your password manager — never in `VITE_` variables or the repository.

## Before launch — checklist

- [ ] Independent penetration test (scope below); fix all High/Critical, retest.
- [ ] Turn on Supabase **MFA for the dashboard** for every team member; least-privilege org roles.
- [ ] Supabase **Point-in-time recovery** and a tested restore.
- [ ] Custom SMTP and SMS sender IDs (DLT registered); Auth rate limits tuned.
- [ ] Monitoring and alerts: Auth errors, Edge Function failures, unusual emergency access.
- [ ] Incident response drill using [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
- [ ] Dependency audit (`npm audit`) in CI; Dependabot on.

## Penetration test scope (for the auditor)

Standards: **OWASP ASVS 4.0 Level 2**, **OWASP MASVS** (Android app), OWASP API Top 10.
Prefer a **CERT-In empanelled** firm (expected by hospitals and government buyers).

**In scope**
- Web app (production build) and Android app (APK/AAB), including the offline/PWA mode.
- Supabase REST (PostgREST) and RPC endpoints as used by the app, with test accounts:
  2 patients, 2 doctors (different hospitals), 1 doctor applicant, 1 admin.
- Supabase Auth flows: sign-up, sign-in + OTP, step-up, password reset, session revocation, phone verification.
- Storage: document upload/download, cross-patient access, file-type abuse.
- Edge Functions: `send-sms` (signature bypass), `abdm` (linking someone else's ABHA, token handling),
  `send-reminders` and `process-deletions` (cron secret), `mark_dose_from_push` token.
- Business logic: access grants and expiry, category limits (mental health), emergency access limits,
  doctor verification, deletion window, consent withdrawal.
- Encryption: confirm sensitive entries are ciphertext at rest and plaintext only to allowed readers.

**Out of scope**: Supabase's and ABDM's own infrastructure; denial-of-service; social engineering of staff.

**Deliverables**: report with CVSS scores and reproduction steps, retest letter, and a summary safe to
share with hospital customers.


## Two-step sign-in for doctors and the Niveda team

Doctors (and the Niveda team, for admin actions) confirm each sign-in with an authenticator app (Supabase MFA, TOTP). The database enforces it: without a second-step (`aal2`) session, `has_grant()` is false — so no patient data is visible — and `_require_doctor()` / `_require_admin()` refuse every doctor and admin action. The app shows a set-up screen (QR code) the first time and a code screen at each sign-in.

Switched on per project:

```sql
update public.security_settings set doctor_mfa_required = true, admin_mfa_required = true;
```

If someone loses their phone: Supabase → **Authentication → Users** → the person → remove their MFA factor. They set it up again at the next sign-in.

## Uploaded files

Every upload is checked (`supabase/functions/document-access/scan.ts`, also run in the browser before uploading) before it can be opened: the real file type is read from its bytes and must match what it claims; programs, archives and Office files, web pages and SVG images, and PDFs with JavaScript, launch actions, embedded files, Flash or XFA are blocked, as is the EICAR test file. A blocked file is deleted from storage, marked blocked, and the patient is told.

This is not a full antivirus. To add one, call a scanning service (for example a self-hosted ClamAV) from the `document-access` function before marking a file clean — never send health documents to a public scanning website.

## Document views can't skip the log

Doctors can't read files from storage directly any more. Files are read only by the `document-access` Edge Function, after `open_document()` has checked access and written the view to the patient's access log in the same request.
