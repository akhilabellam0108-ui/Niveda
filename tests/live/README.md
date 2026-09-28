# Live backend end-to-end tests

These run the app's live service code (`src/services/remote`) against real
Supabase components on your machine: the Supabase Auth server and PostgREST
(both official release binaries), a Postgres with Niveda's migrations, a small
storage API that applies the same row-level security as Supabase Storage, and an
email catcher so the tests can read the one-time codes.

A patient and a doctor each get their own copy of the app. The tests cover
sign-up with an emailed code, compulsory onboarding with a document upload,
sign-in with password + code, granting access with a fresh code, a doctor's
visit with an attachment, corrections, lab results, medicine reminders, export,
search, revocation, and password change and reset.

## Run

You need Postgres 16 (`psql` on the path) and the two binaries:

```bash
mkdir -p /tmp/sbx && cd /tmp/sbx
curl -sSL https://github.com/supabase/auth/releases/download/v2.180.0/auth-v2.180.0-x86.tar.gz | tar xz
curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ
cd -
LIVE_PG="-h localhost -p 5432 -U postgres" SUPABASE_BIN=/tmp/sbx npm run test:live
```

The Postgres user must be a superuser and connections from localhost must be
allowed without a password (`trust`), as in CI. The tests create and replace a
database called `niveda_live`, and use ports 2525, 3000, 9999 and 54321.
