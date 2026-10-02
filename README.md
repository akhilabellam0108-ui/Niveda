# Niveda

**Your health. Your history. Your control.**

Niveda is a privacy-first, patient-controlled **lifelong health record**. It brings a person's medical history — consultations, diagnoses, prescriptions, lab results, scans, surgeries, vaccinations and reports from every hospital and clinic they have ever visited — into one continuous timeline that follows them for life.

The patient owns the record. Doctors can see it only when the patient grants access, only the parts the patient chooses, and only for as long as the patient allows. While they have access, doctors add new information **directly into the patient's existing record** rather than into a separate hospital system. Every entry carries who added it, from which hospital and when, and every view, addition and correction is written to an audit log the patient can read.

> Niveda is a full-stack app: a React web app that installs on phones and laptops, a Node.js API and a PostgreSQL database. The demo data is fictional — when running in demo mode, do not enter real medical information.

---

## Contents

1. [The problem](#the-problem)
2. [How Niveda solves it](#how-niveda-solves-it)
3. [Product principles](#product-principles)
4. [Try it in five minutes](#try-it-in-five-minutes)
5. [Install on phones and laptops](#install-on-phones-and-laptops)
6. [Deploy](#deploy)
7. [Features — patient](#features--patient)
8. [Features — doctor](#features--doctor)
9. [How access works](#how-access-works)
10. [How a doctor adds to the record](#how-a-doctor-adds-to-the-record)
11. [Corrections and versioning](#corrections-and-versioning)
12. [The audit trail](#the-audit-trail)
13. [Design](#design)
14. [Technology](#technology)
15. [Project structure](#project-structure)
16. [Data model](#data-model)
17. [Testing](#testing)
18. [What is still limited](#what-is-still-limited)
19. [Before a real launch](#before-a-real-launch)
20. [Roadmap ideas](#roadmap-ideas)

---

## The problem

A person's medical information is scattered. A childhood allergy is written on a paper card at home, a surgery report sits in one hospital's system, a blood test lives in a lab's portal, and prescriptions are photos on a phone. Each new doctor starts with an incomplete picture, tests get repeated, and in an emergency the most important facts — blood group, severe allergies, current medicines — are often unavailable.

Patients also have no visibility into who has looked at their information, and no simple way to share it with one doctor for one visit and then take that access back.

## How Niveda solves it

```
PATIENT'S EXISTING LIFETIME RECORD
        ↓
Patient grants a doctor temporary access (chooses what + how long, confirms with a one-time code)
        ↓
Doctor sees the relevant history — only the parts shared
        ↓
Doctor conducts the consultation
        ↓
Doctor clicks "Add to medical record"
        ↓
New structured entries go straight into the patient's existing timeline
        ↓
Patient sees them immediately and gets a notification
        ↓
Audit log records who added what, when, and from which hospital
        ↓
Access ends automatically — or the patient revokes it earlier
```

The doctor never creates a separate record. There is one record per person, for life.

## Product principles

| Principle | What it means in the app |
|---|---|
| **Patient ownership** | Nobody sees the record unless the patient grants access. The patient can export everything. |
| **Temporary access** | Every grant has an expiry (1 hour to 90 days). Access ends on its own. |
| **Least privilege** | Patients choose categories. Mental-health and other sensitive records are off by default. Doctors can only add to categories they can see. |
| **Transparency** | Patients see who accessed their record, when, what they viewed and what they added. |
| **Longitudinal record** | Everything appears in one chronological timeline, not as a pile of files. |
| **Structured data** | A visit is a consultation with symptoms, diagnosis, medicines and follow-up — PDFs are attached to entries, not a substitute for them. |
| **Nothing is silently overwritten** | Corrections create a new version; the original stays visible with the reason for the change. |
| **Honest about limits** | Anything not yet built is listed plainly below, never passed off as finished. |

---

## Try it in five minutes

### Run locally

Requires Node.js 20 or later. No database to install — when `DATABASE_URL` is empty, Niveda runs an embedded PostgreSQL (PGlite) in `./data`.

```bash
git clone https://github.com/akhilabellam0108-ui/Niveda.git
cd Niveda
npm install
npm run dev
```

Open http://localhost:5173. The API runs on http://localhost:8080 and Vite forwards `/api` to it.

In development, fictional demo data is loaded and one-time codes appear on screen in a yellow box (and in the server log), so you don't need an email account to try it.

Other commands:

```bash
npm test             # API tests of the five core flows against a real (embedded) Postgres
npm run typecheck    # web + server
npm run build        # production build: dist/web (app) + dist/server (API that also serves the app)
npm start            # run the production build (needs the production settings below)
npm run admin -- list-hospitals   # manage hospitals and doctor accounts (see Deploy → After deploying)
npm run test:e2e     # Playwright browser tests (server must be running)
```

### Demo accounts

Password for all demo accounts: **`demo1234`**. The login page also has one-click buttons for each (demo mode only).

| Who | Email | Good for |
|---|---|---|
| **Meera Iyer** (patient) | `meera@example.com` | A 9-year history (2018–2026), daily medicine reminders with a week of dose history, a pending access request, and active, expired and revoked doctors |
| **Dr. Priya Sharma** (general physician) | `priya.sharma@lakeview.example` | Has access to Meera and Rohan — try adding a consultation |
| **Dr. Arvind Rao** (cardiologist) | `arvind.rao@lakeview.example` | Waiting for Meera to approve his request |

- **Doctor access code** for granting access: `PS-4821` (Dr. Priya Sharma).
- **Sign up as a new patient** to see the compulsory onboarding.
- **Patient IDs**: `NV-4821-7730` (Meera), `NV-9264-1183` (Fatima — no doctor has access, useful to test that nothing leaks).

**Best way to see it working:** use two browsers (or one normal and one private window). Sign in as Meera in one and Dr. Priya in the other. Changes appear on the other side live — grant access, add a consultation, revoke, and watch both update.

### Suggested walkthrough

1. As **Meera**, open *Timeline* — nine years of history, with visits grouped with their diagnoses, prescriptions and lab results.
2. Go to *Doctors & access → Requests* and approve Dr. Arvind Rao with fewer permissions than he asked for.
3. On *Medications*, see today's doses, adherence and reminder times; allow notifications to get reminders even when Niveda is closed.
4. As **Dr. Priya**, open Meera → *Add to medical record*. Enter a visit with a diagnosis, a prescription, a lab order and a PDF attachment. Save.
5. Back as **Meera**: the visit is in the timeline, the medicine is in *Medications* with a reminder already set, there's a notification, and the *Access log* shows exactly what happened.
6. As **Dr. Priya**, open the diagnosis and *Correct this entry*. See the old and new versions side by side.
7. As **Meera**, revoke Dr. Priya's access. Her screen immediately shows "You don't have access to this record".

## Install on phones and laptops

Niveda is a **Progressive Web App**: one codebase that installs like an app on Android, iPhone, iPad, Windows, macOS, Linux and Chromebooks — its own icon, its own window, and medicine reminders as phone notifications. There is no app-store download; people install it from the website.

**Step 1 — put Niveda online** at an `https://` address (see [Deploy](#deploy)). Phones only allow installing and notifications from secure (HTTPS) sites.

**Step 2 — install it on each device:**

| Device | How |
|---|---|
| **Android** (Chrome) | Open the address → menu ⋮ → **Install app** (or *Add to Home screen*) |
| **iPhone / iPad** (Safari, iOS 16.4+) | Open the address → **Share** → **Add to Home Screen** → open Niveda from the home screen → allow notifications on the *Medications* page |
| **Windows / Mac / Linux / Chromebook** (Chrome or Edge) | Open the address → click the **install icon** at the right of the address bar (or menu → *Install Niveda*) |
| **Mac** (Safari 17+) | **File → Add to Dock** |

**Trying it on your own phone before deploying:** run the app locally (`npm run dev`, or the built version on port 8080), then expose it with a free tunnel such as `npx cloudflared tunnel --url http://localhost:5173` (or `:8080` for the built version) — it prints an `https://…trycloudflare.com` address you can open and install on any phone. (Opening `http://<your-laptop-ip>:8080` on the same Wi-Fi also works for browsing, but phones won't install or send notifications without HTTPS.)

## Deploy

### Option A — Render (easiest, about 10 minutes)

1. Create an account at [render.com](https://render.com) and choose **New → Blueprint**, then pick this repository. `render.yaml` creates the app, a PostgreSQL database and a disk for files.
2. Fill in the values it asks for:
   - `FILE_ENCRYPTION_KEY` — run `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and paste the result. **Keep a copy; losing it makes uploaded files unreadable.**
   - `SMTP_URL` and `MAIL_FROM` — from an email provider (Brevo, Resend, SendGrid, Mailgun, Amazon SES, or a Gmail app password) so sign-in codes reach people's inboxes.
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — run `npx web-push generate-vapid-keys`.
   - `APP_URL` — the address Render gives you (or your own domain).
3. Open the address and install it on your devices.

### Option B — any server with Docker

```bash
cp .env.example .env      # fill it in
docker compose up -d --build
```

This starts PostgreSQL and Niveda on port 8080. Put it behind HTTPS (Caddy, Nginx + Let's Encrypt, or Cloudflare).

### Option C — Node directly

`npm ci && npm run build && npm start` with the variables from `.env.example` set, and a PostgreSQL 14+ database in `DATABASE_URL`. The schema is created automatically on first start.

**The server refuses to start in production** if anything unsafe is configured: no database, missing encryption key or OTP secret, on-screen codes switched on, no email settings, or cookies not marked secure.

### After deploying

- Add hospitals and doctors from the server's shell (Render: *Shell* tab; Docker: `docker compose exec app sh`). Doctors can't sign themselves up; each gets a temporary password by email.
  ```bash
  node dist/server/admin.js add-hospital --id hsp_lakeview --name "Lakeview Hospital" --city Hyderabad --type Hospital
  node dist/server/admin.js add-doctor --name "Dr. Asha Rao" --email asha@example.com --phone "+91 98765 43210" \
       --specialization "General Physician" --registration TSMC-12345 --hospital hsp_lakeview
  node dist/server/admin.js list-hospitals
  ```
- Back up the database and the files disk (`DATA_DIR`) regularly.

## Features — patient

**Getting started**
- Landing page, sign-up (name, date of birth, email, phone, password, terms/privacy acknowledgement), log in by email or phone, forgot-password, and one-time-code verification.
- **Compulsory seven-step onboarding** — nobody reaches the dashboard with an empty record (the sign-up page says so up front):
  1. **Blood group** (with "Not sure" as an honest answer) and an optional photo
  2. **Emergency contact** — name, relationship and phone, all required
  3. **Allergies** — allergen, severity and reaction for each
  4. **Ongoing conditions**
  5. **Current medicines** — name, dose, how often, and **reminder times**
  6. **Past surgeries and hospital stays** — what, when and which hospital
  7. **Medical documents** — at least one upload (lab report, prescription, scan, discharge summary or a photo of a paper record), each with its date and optionally linked to an entry from the earlier steps
- Documents can't be skipped. For steps 3–6 the patient either adds entries or explicitly ticks "I have none". That confirmation is saved and shown to doctors ("No known allergies — confirmed by patient on …"), so an empty section is never ambiguous. The rules are enforced in the service layer, not just the form, and answers survive a page refresh.
- The emergency contact can't be removed later — profile and emergency-card edits require one.

**Home dashboard**
- Name, photo, age, blood group, patient ID, and a one-tap *Emergency info* button.
- Allergy banner (severe allergies in red).
- Quick actions: add a record, upload a report, add a medication, add an allergy, grant doctor access, view the timeline.
- Record at a glance (entries, years of history, contributing doctors, documents), pending access requests, recent activity grouped by month, doctors with access and time left, current medications, and a health summary (ongoing conditions, next follow-up, last visit).

**Timeline** — the core view
- Every entry in one chronological history, grouped by year, newest first.
- Linked entries shown together: a consultation with its diagnosis, prescriptions and lab orders; a lab order with its results.
- Search, filter by category, doctor, hospital and date range.
- Each entry shows who added it and where; open any entry for full details, attachments and version history.

**Medical records**
- Twelve categories: consultations, diagnoses, medications, allergies, surgeries & procedures, lab results, imaging & scans, vaccinations, mental health, hospitalisations, family history, other.
- Category overview with counts and latest date, then a filterable list. Links are shareable (for example `?category=labs`).

**Add medical record**
- Thirteen record types, each with its own form (a consultation asks for symptoms and follow-up; a lab result asks for result, reference range and status; a surgery asks for surgeon and outcome).
- Validation with clear messages, attachments on any entry.

**Reports & documents**
- Upload PDFs, images and text files (drag and drop or browse, up to 15 MB), set the category and date, and link to an entry.
- In-app preview for PDFs and images, download, re-link, delete (with confirmation). Documents added by a doctor stay locked to their entry.
- Demo documents are real generated PDFs you can open and download.

**Medicine reminders**
- Every regular medicine gets a reminder schedule automatically — from onboarding, from the patient's own entries, and from **doctors' prescriptions** (default times come from the frequency: once daily 8:00 am, twice daily 8:00 am and 8:00 pm, every night 9:00 pm, and so on). Patients can change the times or turn reminders off without altering the prescription.
- **Today's doses** on the dashboard and Medications page: each dose shows as upcoming, due now, taken, skipped or missed, with one-tap *Taken* / *Skip* and undo.
- **Push reminders**: once the patient allows notifications, each dose arrives as a phone or computer notification with a *Taken* button — even when Niveda is closed — and a paired smartwatch buzzes with it.
- **Alarm**: when a dose falls due while Niveda is open, it plays a chime, shows a system notification (after the patient allows notifications), and opens a reminder with *Taken*, *Skip* and *Snooze 10 min*.
- **Adherence**: the share of doses taken over the last 7 days, per medicine.
- **Phone and smartwatch**: *Phone & smartwatch* downloads a calendar file (.ics) with a repeating event and alarm for every dose. Imported into Google Calendar, Apple Calendar or Outlook, the phone rings at each dose — and a paired watch (Apple Watch, Wear OS, Galaxy Watch, Fitbit and most others) buzzes with it, even when Niveda is closed.
- Settings → Notifications: turn alarms and sound on or off, allow notifications, and send a test reminder.

**Medications** — current and previous lists, dose, frequency, reason, prescriber, start and end dates; stop a medicine with a reason (it moves to *Previous* and the timeline shows when it stopped); full change history.

**Allergies** — allergen, reaction, severity, date identified, notes; severe and life-threatening allergies are highlighted everywhere, including for doctors.

**Emergency profile** — blood group, important warnings, allergies, conditions, current medicines and emergency contact on one card; a QR code any phone camera can read (even offline) containing only what's on the card; a lock-screen preview; an on/off switch for emergency access.

**Doctors & access** — active grants with permissions and a time-remaining bar; view access (with that doctor's activity on your record), change permissions (sharing *more* needs a one-time code), revoke; incoming requests to approve (optionally with fewer permissions or a shorter time) or decline; sent invitations; a permanent **access history** of every doctor who has ever had access — active, expired or revoked — with what they could see, for how long and the dates; your patient ID as a QR code. Grants are never deleted, so the history is complete.

**Grant access** — four ways to find the doctor (scan their QR, type their access code, search the directory, or invite a doctor not yet on Niveda) → choose permissions → choose duration (1 hour, 24 hours, 3 days, 7 days or custom) → review → confirm with a one-time code.

**Access log** — every event with who, what, when and context, grouped by day, filterable by type (doctor activity, views, additions and changes, access, sign-ins) and by person.

**Also:** notification centre, privacy & security (how privacy works in plain language, who can see the record right now, signed-in devices, sign-in history, password change, sign out other devices), profile, settings (notifications, light/dark/system theme, language, data export, help, reset demo data, log out), export (complete record or chosen categories as a readable HTML summary or a JSON data file), and global search (Ctrl/⌘ K) across records, documents, doctors, hospitals and dates.

## Features — doctor

- **Dashboard** — patients with active access (with "today" and time-left badges), requests waiting for patients, entries you've added, recent activity, quick search by patient ID, and your personal access code and QR for patients to scan.
- **Find a patient** — by patient ID or by scanning the patient's QR. Without access the name is masked (`M•••• I••••`) and nothing else is shown. Send an access request with a reason, the parts needed and a duration.
- **My patients** — active and ended access; ended patients are masked and can be sent a new request.
- **Patient view** — a banner with name, age, sex, blood group, ID and time left; a red alert for severe allergies and important warnings; tabs for *Summary* (allergies, conditions, current medicines, recent history), *Timeline*, *Records*, *Reports* and *Access* (who granted it, when, how it was verified, expiry, what's shared and what's hidden). Everything is filtered to the granted permissions.
- **Add to medical record** — see [below](#how-a-doctor-adds-to-the-record).
- **Corrections** and **adding lab results** to earlier orders from any entry.
- **My activity** — everything you have viewed or added (the same entries patients see), plus profile and security pages.

---

## How access works

- A grant links **one patient** to **one doctor** with a set of **permissions**, a **start**, an **expiry** and a **status** (active, expired, revoked). It records how it was created (QR, code, directory, invitation, approved request) and when the patient verified it.
- Each record type belongs to exactly one permission category. A doctor sees an entry only if the category is shared, and can add an entry only to a shared category — for example, without *Medications* a doctor can't prescribe in Niveda.
- **Every read and write checks for an active, unexpired grant** in the service layer. The moment a grant is revoked or expires, lists, single entries, documents and saving all fail with a clear "You don't have access" message.
- Sensitive categories (*Mental-health records*, *Other sensitive records*) are off by default and marked as private.
- Granting, approving and widening permissions need a one-time code. Narrowing permissions or revoking doesn't.
- Doctors are reminded to patients a day before access ends; expiry is logged and both sides are notified.
- A doctor can't browse patients. Looking up an ID without access returns only a masked name.

## How a doctor adds to the record

One form captures a whole visit and saves it in a single step:

| Section | Becomes |
|---|---|
| Reason, symptoms, examination notes | a **Consultation** entry |
| Condition, status, severity | a linked **Diagnosis** |
| One or more medicines with dose, frequency, days, instructions | linked **Medication** entries that appear in the patient's medication list with start and end dates |
| Tests to order | linked **Lab test** orders; results can be added later and link back |
| Follow-up date | a linked **Follow-up** entry, shown on the patient's dashboard |
| Files | **Attachments** on the consultation |

While writing, the doctor sees a side panel with the patient's allergies, current medicines and conditions, and a warning appears if they prescribe while the patient has a severe allergy. The doctor's name and hospital are filled in automatically and cannot be changed. After saving, the patient is notified ("Dr. Priya Sharma added a consultation, a diagnosis, 1 prescription and 1 lab order to your medical record") and every entry is logged.

Doctors can also add any single entry type — clinical note, vaccination, imaging, procedure and so on.

## Corrections and versioning

Medical history is never silently changed.

- *Correct this entry* opens the entry's form. The doctor (or the patient, for entries they added themselves) makes changes and must give a **reason**.
- Saving adds a **new version**. The entry shows "Corrected by … · reason", and the history lists every version with who, when and a before/after comparison of each changed field.
- Who originally added an entry (`createdBy`) is permanent and can't be edited through any flow. Patients can't alter entries added by doctors.
- Stopping a medicine and adding a lab result also create versions rather than overwriting.

## The audit trail

Recorded for each event: **who** (person, role, hospital), **what** (action), **target** (the entry, document or doctor), **when**, and **context** (permissions and duration of a grant, reason for a correction, number of attachments, new version number…).

Logged events include account creation, sign-in and sign-out, password changes, access granted / changed / revoked / expired / requested / approved / declined, a doctor viewing the medical history, opening an entry, viewing a document or the emergency profile, entries added and corrected, medicines stopped, documents uploaded and deleted, exports, invitations, and devices signed out. Repeated views by the same doctor are throttled so refreshing a page doesn't flood the log.

---

## Design

The interface aims for calm and trustworthy rather than clinical: a deep green accent, softly tinted neutrals, Inter for the interface with Newsreader for a few display moments (names, years on the timeline), and colour reserved for meaning — red for severe allergies and revocation, amber for access about to expire, green for active.

- A single design system of tokens (colour, type scale, spacing, radius) with complete **light and dark themes** that follow the device or a manual choice.
- Reusable components: buttons, fields, selects, badges, chips, alerts, cards, tabs, modals, side drawers, confirmation dialogs, toasts, one-time-code input, skeleton loaders, empty and error states.
- **Responsive**: sidebar on desktop; bottom navigation, full-height sheets and stacked cards on phones.
- **Accessible**: semantic markup, labelled fields, visible focus, keyboard navigation and focus trapping in dialogs, screen-reader text on record cards, reduced-motion support.
- Every list has a useful empty state, every data view has a loading skeleton and a friendly error state with *Try again*, and important actions (revoke, delete, stop a medicine, correct an entry, approve access) ask for confirmation.
- The product name, tagline and patient-ID prefix live in one file: [`src/config/brand.ts`](src/config/brand.ts). The logo is an original SVG mark in [`src/components/ui/Logo.tsx`](src/components/ui/Logo.tsx).

## Technology

| | |
|---|---|
| Web app | React 18 + TypeScript (strict), Vite 5, React Router 6, plain CSS design tokens, lucide-react, qrcode |
| Installable app | Web app manifest + service worker (`public/sw.js`): install, push notifications with a *Taken* button |
| API | Node.js + Express 4 + TypeScript, zod validation, helmet (strict Content-Security-Policy), rate limits |
| Database | PostgreSQL (`pg`); embedded PGlite for development and tests |
| Passwords | Argon2id (`@node-rs/argon2`); lock-out after 5 failed attempts for 15 minutes |
| Sessions | Random token in an httpOnly, SameSite cookie; only its SHA-256 is stored; list and sign out other devices |
| One-time codes | 6 digits, HMAC-hashed, expire in 5 minutes, 5 attempts, rate-limited; sent by email (SMTP), SMS pluggable (Twilio, MSG91) |
| Files | Encrypted with AES-256-GCM before they touch disk; served only through a permission-checked, logged route |
| Live updates | Server-Sent Events |
| Background jobs | Every minute: expire access, warn 24 h before access ends, push due medicine reminders, clean up |
| Push | Web Push (VAPID) |
| Tests | Node test runner + supertest against Postgres (API flows); Playwright (browser flows) |

## Project structure

```
shared/                   code used by both the app and the server
  types.ts                the domain model
  api.ts                  request/response types, validation rules, error codes
  recordMeta.ts           every record type: fields, permission, category, labels — drives all forms
  reminders.ts            default dose times, schedules (time-zone aware), adherence
  brand.ts, dates.ts, pdf.ts
server/
  src/
    index.ts, app.ts      start-up; Express app, security headers, CSRF check, rate limits
    config.ts             all settings from environment variables; refuses unsafe production config
    db/                   connection (Postgres or PGlite), schema, row mappers, demo data
    core.ts               session context, access checks, audit + notifications
    routes/               auth, records, documents, access, patient, medications, misc, extras, uploads
    services/             records, one-time codes, email/SMS, encrypted file storage, push
    jobs.ts               background jobs
    events.ts             live-update hub
    admin.ts              command-line admin (hospitals, doctors)
  test/api.test.ts        API tests of flows A–E plus security checks
src/                      the web app
  services/               typed API client (one function per endpoint) + live updates
  state/                  session, toasts, live data hooks
  components/, pages/, styles/
public/                   service worker, manifest, icons
scripts/build-server.mjs  bundles the server
Dockerfile, docker-compose.yml, render.yaml, .env.example
tests/e2e_browser.py      Playwright tests of the same flows in a real browser, desktop and mobile
```

## Data model

Tables (see [`server/src/db/schema.ts`](server/src/db/schema.ts)): `users`, `patients`, `doctors`, `hospitals`, `records`, `record_versions`, `documents`, `access_grants`, `access_requests`, `doctor_invites`, `audit_logs` (append-only — a database trigger blocks updates and deletes), `notifications`, `sessions`, `otp_challenges`, `preferences`, `medication_reminders`, `dose_logs`, `push_subscriptions`.

Reminder schedules and dose history are kept separately from the clinical record: the prescription belongs to the record and is only changed through amendments, while the times belong to the patient.

Consultations, diagnoses, medications, allergies, surgeries, procedures, lab tests, lab results, imaging, vaccinations, hospitalisations, mental-health notes, family history, follow-ups and clinical notes are all records with a `type` and type-specific `data`, described in [`shared/recordMeta.ts`](shared/recordMeta.ts). Adding a new record type means adding one entry there.

```
Patient 1 ── * Record 1 ── * RecordVersion
                 │  └── * Document (attachments, encrypted at rest)
                 └── parentId → Record (e.g. prescription inside a consultation)
Doctor  1 ── * Record (created_by)
Patient 1 ── * AccessGrant * ── 1 Doctor     (permissions, granted_at, expires_at, status)
Patient 1 ── * AccessRequest * ── 1 Doctor
Patient 1 ── * AuditLog                      (actor, action, target, time, metadata)
Record (medication) 1 ── 1 MedicationReminder ── * DoseLog
User    1 ── * Notification, Session, PushSubscription
```

## Testing

**API tests** — `npm test` runs against a real PostgreSQL engine (embedded):

- **Security basics:** requests without the CSRF header are refused, protected routes need a session, wrong codes and passwords fail, accounts lock after repeated failures.
- **Flow A — patient:** sign-up with an emailed code → onboarding refuses missing sections (each needs entries or an explicit "none", including documents) → reminders are created → doses can be logged.
- **Flow B — access:** a doctor can't read the record before access → patient grants access with permissions, duration and a code → doctor can read only the allowed categories.
- **Flow C — doctor adds:** one consultation creates linked entries with attribution and an encrypted attachment → a correction keeps the old version → the patient sees the new medicine, a notification and audit entries.
- **Flow D — revoke:** after revocation the doctor can't list, open or write; access also expires by itself.
- **Flow E — audit:** the log holds every expected event and can't be altered.

**Browser tests** — `tests/e2e_browser.py` walks the same flows through the real interface with the patient and the doctor in separate browsers, then checks search, dark mode and the mobile layout.

```bash
npm run build && DATA_DIR=./data-e2e PORT=8090 node dist/server/index.js &
pip install playwright && python -m playwright install chromium
npm run test:e2e
```

## What is still limited

| Area | Today |
|---|---|
| Doctor verification | Doctors are added by an administrator (`npm run admin`); registration numbers aren't checked against medical council registries automatically |
| SMS codes | Twilio and MSG91 are built in but need an account; email is the default |
| Medicine alarms | Push notifications when Niveda is installed and notifications are allowed; on iPhone this needs iOS 16.4+ and the app added to the home screen. The calendar (.ics) export remains as a backup |
| Smartwatch | Watches buzz with the phone's notifications and calendar alarms; no dedicated watch app or Apple Health / Google Health Connect sync |
| Emergency lock-screen widget | Preview only; needs a native app |
| Export | PDF/JSON summary; doesn't yet bundle the original files into one archive |
| Close account | Handled through support, so deletion can be confirmed and logged |
| Doctor invitations | Recorded; the invite email isn't sent yet |

## Before a real launch

1. **Hosting and backups** — a production PostgreSQL with automatic backups, a persistent disk (or move files to private object storage), monitoring and alerts.
2. **Email/SMS provider** — a verified sending domain so codes don't land in spam.
3. **Clinician verification** — checking registration numbers against medical council registries; hospital accounts.
4. **Emergency ("break-glass") access** — a policy for access when the patient can't consent, with justification, time limits and review.
5. **Compliance** — India's Digital Personal Data Protection Act 2023, ABDM / ABHA integration, and HIPAA / GDPR where relevant; a privacy policy and terms reviewed by a lawyer; retention and deletion policies; an independent security audit and penetration test.
6. **Interoperability** — FHIR R4 import and export; lab and hospital integrations.
7. **Native apps (optional)** — for the lock-screen emergency card, guaranteed alarms on every phone, and watch apps with HealthKit / Health Connect.

## Roadmap ideas

- Reading uploaded reports with OCR and suggesting structured entries for the patient to confirm.
- Family accounts — parents managing a child's record, carers for elderly relatives.
- Lab-result trends (HbA1c, haemoglobin, blood pressure) over the years.
- Refill tracking.
- Translations into Hindi, Telugu, Tamil and other languages, with clinically reviewed terminology.

---

*Niveda does not provide medical advice. All demo data is fictional.*
