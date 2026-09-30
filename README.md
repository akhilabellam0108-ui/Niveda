# Niveda

**Your health. Your history. Your control.**

[![CI](https://github.com/akhilabellam0108-ui/niveda/actions/workflows/ci.yml/badge.svg)](https://github.com/akhilabellam0108-ui/niveda/actions/workflows/ci.yml)

**▶ Live demo: <https://akhilabellam0108-ui.github.io/niveda/>** (runs in your browser, demo data only)

Niveda is a privacy-first, patient-controlled **lifelong health record**. It brings a person's medical history — consultations, diagnoses, prescriptions, lab results, scans, surgeries, vaccinations and reports from every hospital and clinic they have ever visited — into one continuous timeline that follows them for life.

The patient owns the record. Doctors can see it only when the patient grants access, only the parts the patient chooses, and only for as long as the patient allows. While they have access, doctors add new information **directly into the patient's existing record** rather than into a separate hospital system. Every entry carries who added it, from which hospital and when, and every view, addition and correction is written to an audit log the patient can read.

Niveda runs in two modes:

- **Demo** (the default, and the [live demo](https://akhilabellam0108-ui.github.io/niveda/)) — everything runs in your browser with fictional data. Sign-in and one-time codes are simulated. Don't enter real medical information.
- **Live** — connected to a [Supabase](https://supabase.com) backend: real accounts, codes sent by email, data in Postgres, and every access rule enforced by the database, not the browser. Set it up with **[docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)**.

> ⚠️ The live backend makes the core security real, but Niveda has not yet had a security review, penetration test or DPDP compliance review. See [what's still needed](#what-must-be-built-before-production) before storing real patients' records.

---

## Contents

1. [The problem](#the-problem)
2. [How Niveda solves it](#how-niveda-solves-it)
3. [Product principles](#product-principles)
4. [Try it in five minutes](#try-it-in-five-minutes)
5. [Features — patient](#features--patient)
6. [Features — doctor](#features--doctor)
7. [How access works](#how-access-works)
8. [How a doctor adds to the record](#how-a-doctor-adds-to-the-record)
9. [Corrections and versioning](#corrections-and-versioning)
10. [The audit trail](#the-audit-trail)
11. [Design](#design)
12. [Technology](#technology)
13. [Project structure](#project-structure)
14. [Data model](#data-model)
15. [Testing](#testing)
16. [Demo vs live](#demo-vs-live)
17. [What must be built before production](#what-must-be-built-before-production)
18. [Roadmap ideas](#roadmap-ideas)

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
| **Honest about being a prototype** | Simulated parts are labelled in the UI, never passed off as real security. |

---

## Try it in five minutes

### Run locally

Requires Node.js 20 or later.

```bash
git clone https://github.com/akhilabellam0108-ui/niveda.git
cd niveda
npm install
npm run dev
```

Open http://localhost:5173. This runs the demo; to connect a Supabase project, follow [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).

Other commands:

```bash
npm test             # automated tests of the five core flows (runs in Node)
npm run test:db      # the database's access rules, against a real Postgres (see tests/db)
npm run test:live    # the live app code against Supabase Auth + PostgREST (see tests/live/README.md)
npm run build        # type-check + production build into dist/
npm run build:single # the whole app as ONE self-contained index.html in dist-single/
npm run preview      # serve the production build
```

### Demo accounts

Password for all demo accounts: **`demo1234`**. The login page also has one-click buttons for each.

| Who | Email | Good for |
|---|---|---|
| **Meera Iyer** (patient) | `meera@example.com` | A 9-year history (2018–2026), daily medicine reminders with a week of dose history, a pending access request, and active, expired and revoked doctors |
| **Dr. Priya Sharma** (general physician) | `priya.sharma@lakeview.example` | Has access to Meera and Rohan — try adding a consultation |
| **Dr. Arvind Rao** (cardiologist) | `arvind.rao@lakeview.example` | Waiting for Meera to approve his request |

- **One-time codes** appear on screen in a yellow "Prototype" box with a *Fill in* button — no SMS is sent.
- **Doctor access code** for granting access: `PS-4821` (Dr. Priya Sharma).
- **Sign up as a new patient** to see the compulsory onboarding.
- **Patient IDs**: `NV-4821-7730` (Meera), `NV-9264-1183` (Fatima — no doctor has access, useful to test that nothing leaks).

**Best way to see it working:** open two browser tabs. Sign in as Meera in one and Dr. Priya in the other. Sessions are per tab and changes appear in the other tab live — grant access, add a consultation, revoke, and watch both sides update.

### Suggested walkthrough

1. As **Meera**, open *Timeline* — nine years of history, with visits grouped with their diagnoses, prescriptions and lab results.
2. Go to *Doctors & access → Requests* and approve Dr. Arvind Rao with fewer permissions than he asked for.
3. On *Medications*, see today's doses, adherence and reminder times; try *Phone & smartwatch*.
4. As **Dr. Priya**, open Meera → *Add to medical record*. Enter a visit with a diagnosis, a prescription, a lab order and a PDF attachment. Save.
5. Back as **Meera**: the visit is in the timeline, the medicine is in *Medications* with a reminder already set, there's a notification, and the *Access log* shows exactly what happened.
6. As **Dr. Priya**, open the diagnosis and *Correct this entry*. See the old and new versions side by side.
7. As **Meera**, revoke Dr. Priya's access. Her tab immediately shows "You don't have access to this record".

---

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
| Framework | React 18 + TypeScript (strict) |
| Build | Vite 5 |
| Routing | React Router 6 (hash routing, so the build works from any static host or a single file) |
| Styling | Plain CSS with design tokens — no CSS framework |
| Icons | lucide-react |
| QR codes | qrcode (generation); the browser's BarcodeDetector for scanning where supported |
| Backend (live) | Supabase: Postgres with row-level security and SQL functions, Supabase Auth (email codes), Storage (private bucket), Realtime, pg_cron |
| Storage (demo) | localStorage for data, IndexedDB for files, sessionStorage for per-tab sessions |
| Tests | Node test runner via esbuild (service flows); Postgres (database access rules); Supabase Auth + PostgREST binaries (live end-to-end); Playwright (browser flows) |

Six runtime dependencies: `react`, `react-dom`, `react-router-dom`, `lucide-react`, `qrcode` and `@supabase/supabase-js`.

## Project structure

```
src/
  config/brand.ts          product name, tagline, ID prefix — rename the product here
  config/backend.ts        demo or live: live when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set
  types/index.ts           the domain model (maps to database tables)
  lib/
    recordMeta.ts          every record type: fields, permission, category, labels — drives all forms
    reminders.ts           default dose times, today's schedule, adherence
    dates.ts, ids.ts, icons.ts
  services/                the API the UI uses — one module per backend service
    index.ts               picks the demo or live implementation of every service
    remote/                the live implementations (Supabase); same functions, same results
    authService.ts         sign-up, log-in, OTP, sessions, password (MOCK — isolated for replacement)
    accessService.ts       grants, requests, invitations, doctor lookup
    recordService.ts       list/get/create, doctor consultation bundle, amendments, lab results
    documentService.ts     upload, open (permission-checked + logged), link, delete
    patientService.ts      profile, dashboard summary, onboarding, emergency profile
    doctorService.ts       doctor profile, patient overview
    notificationService.ts, auditService.ts, settingsService.ts, exportService.ts, searchService.ts
    medicationService.ts   reminder schedules, dose logging, adherence, calendar (.ics) export
    otpService.ts          prototype one-time codes
    core.ts                session context, access checks, audit + notification helpers, safe errors
  mock/                    the in-browser "backend": seed data, persistence, cross-tab sync, file store, PDF maker
  state/                   session context, toasts, live data hooks
  components/
    ui/                    design-system components, logo, OTP
    layout/                patient and doctor shells (sidebar, top bar, bottom nav)
    records/               timeline, record card, record drawer, forms, add-record dialog
    access/                grant flow, permission and duration pickers, QR
    documents/             upload dialog, viewer
    medications/           today's doses, alarm, reminder-time editor
    search/                global search palette
  pages/
    public/                landing, legal
    auth/                  log in, sign up, verify, forgot password, onboarding
    patient/               home, timeline, records, medications, allergies, reports, emergency, access, activity
    doctor/                dashboard, patients, find, patient view, add entry, activity, profile
    shared/                notifications, privacy & security, profile, settings, export
  styles/                  tokens.css, base.css, layout.css, features.css
supabase/migrations/       the live backend: schema + row-level security, the server API, storage/jobs/privileges
scripts/
  create-doctor.mjs        adds a verified doctor (administrators only; uses the service-role key)
  gen-record-types.mjs     prints the server's record-type rules from recordMeta.ts
docs/SUPABASE_SETUP.md     step-by-step guide to running Niveda live
tests/
  db/backend.test.mjs      the database's access rules, played out by patients, doctors and an attacker
  live/                    the live app code end-to-end against Supabase Auth, PostgREST and Postgres
  flows.test.ts            service-level tests of flows A–E
  run.mjs                  bundles and runs the Node tests
  e2e_browser.py           Playwright tests of the same flows in a real browser, desktop and mobile
```

**Two backends, one UI.** Pages and components never touch storage; they only call `src/services`. Each service has a demo implementation (`src/services/*.ts` over `src/mock`) and a live one (`src/services/remote`), with identical signatures checked by TypeScript. In live mode the rules in `services/core.ts` are enforced by the database instead: row-level security decides what each person can read, and every change goes through a SQL function that checks access, sets attribution from the session and writes the audit log in the same transaction.

## Data model

Defined in [`src/types/index.ts`](src/types/index.ts):

`User` · `Patient` (with `HealthDeclarations`) · `Doctor` · `Hospital` · `MedicalRecord` (with `RecordVersion` history) · `MedicalDocument` · `AccessGrant` · `AccessRequest` · `DoctorInvite` · `AuditLog` · `Notification` · `Session` · `Preferences` · `MedicationReminder` · `DoseLog`

Reminder schedules (`MedicationReminder`) and dose history (`DoseLog`) are kept separately from the clinical record: the prescription belongs to the record and is only changed through amendments, while the times belong to the patient.

Consultations, diagnoses, medications, allergies, surgeries, procedures, lab tests, lab results, imaging, vaccinations, hospitalisations, mental-health notes, family history, follow-ups and clinical notes are all `MedicalRecord`s with a `type` and type-specific `data`, described in [`src/lib/recordMeta.ts`](src/lib/recordMeta.ts). Adding a new record type means adding one entry there.

```
Patient 1 ── * MedicalRecord 1 ── * RecordVersion
                    │  └── * MedicalDocument (attachments)
                    └── parentId → MedicalRecord (e.g. prescription inside a consultation)
Doctor  1 ── * MedicalRecord (createdBy)
Patient 1 ── * AccessGrant * ── 1 Doctor     (permissions, grantedAt, expiresAt, status, verification)
Patient 1 ── * AccessRequest * ── 1 Doctor
Patient 1 ── * AuditLog                      (actor, action, target, timestamp, metadata)
MedicalRecord (medication) 1 ── 1 MedicationReminder (times, enabled) ── * DoseLog (date, time, taken/skipped)
User    1 ── * Notification, Session
```

`MedicalRecord` fields: `id, patientId, type, date, data, createdAt, updatedAt, createdBy, organization, attachments, parentId, source, version, versions`.

## Testing

**Service tests** — `npm test` (18 checks):

- **Flow A — patient:** sign-up rejects a wrong code and accepts the right one → onboarding refuses missing blood group, missing emergency contact, unanswered sections, medicines without reminder times and no uploaded document → a complete onboarding creates entries, declarations, reminders and a document linked to its surgery → today's doses can be marked taken → the calendar file contains repeating alarms → the emergency contact can't be removed → an added record appears in the list and its category → incomplete records are rejected.
- **Flow B — access:** a doctor can't read the record before access and sees only a masked name → patient grants access with permissions, duration and a code → doctor can now read it.
- **Flow C — doctor adds:** one consultation creates four linked entries with attribution and an attachment → a correction keeps version 1 and the original author → a lab result completes its order → the patient sees the new medicine, a notification and audit entries → the patient can't alter the doctor's entry or delete the doctor's document.
- **Flow D — revoke:** after revocation the doctor can't list, open or write → sensitive categories stay hidden → access expires by itself when time runs out.
- **Flow E — audit:** the patient's log contains every expected event with actor and time.

**Database tests** — `npm run test:db` (11 checks, [`tests/db/backend.test.mjs`](tests/db/backend.test.mjs)). The real migrations run on a throwaway Postgres; patients, doctors and an attacker then try everything: a doctor sees nothing before a grant and only the shared categories after; granting needs a fresh code that works once; forged attribution is ignored; nobody can write to tables directly or call internal functions; even the database owner can't rewrite history; revocation and expiry cut access immediately; the audit log is complete, private to each side, append-only, and tampering is detected.

**Live end-to-end tests** — `npm run test:live` (8 checks, [`tests/live`](tests/live/README.md)). A patient and a doctor each run the app's live code against the real Supabase Auth server and PostgREST, reading their codes from the emails the Auth server sends: sign-up, onboarding with an upload, two-step sign-in, granting access, a doctor's visit with a file, corrections, lab results, reminders, export, search, revocation, and password change and reset.

All of these run in CI on every push.

**Browser tests** — `tests/e2e_browser.py` walks the same flows through the real interface (sign-up, onboarding, adding a record, the full grant flow with codes, the doctor adding a visit with a prescription, lab order and PDF in a second tab, the patient seeing it, a correction, revocation, the access log), then checks the demo patient, search, dark mode and the mobile layout.

```bash
npm run build && npx vite preview --port 4173 &
pip install playwright && python -m playwright install chromium
python3 tests/e2e_browser.py
```

## Demo vs live

| Area | Demo | Live (Supabase) |
|---|---|---|
| Authentication | Passwords hashed **in the browser**; one-time codes shown on screen | Supabase Auth; password + emailed code at sign-in; emailed code to confirm granting, approving or widening access |
| Backend & database | Browser storage; nothing syncs between devices | Postgres; synced across devices, live updates via Realtime |
| Access enforcement | In the browser — correct in behaviour, not a security boundary | **In the database**: row-level security on every table; every change through a server function |
| Audit log | In the browser | Written by the server with each change; append-only and hash-chained (`verify_audit_chain()`) |
| Record history & attribution | In the browser | Immutable in the database — even the owner account can't rewrite who added an entry or delete a version |
| Documents | IndexedDB | Private storage bucket with the same access rules; no public links |
| Access expiry | Checked when data is read | Checked on every read, plus a pg_cron job every 5 minutes that logs expiry and sends "ends soon" reminders |
| Doctors & hospitals | Fixed fictional directory | Added by an administrator after checking registration (`scripts/create-doctor.mjs`); no public doctor sign-up |
| Notifications | In-app | In-app, live across devices; no SMS or push yet |
| Doctor invitations | Recorded, not sent | Recorded, not sent |
| Export | Built in the browser; lists documents | Same, from the patient's live data |
| Medicine alarms, smartwatch | While a tab is open; calendar (.ics) export for phone and watch | Same |
| Close account | Disabled | An administrator can erase an account deliberately (see the setup guide) |

## What must be built before production

Done with the live backend:

- ✅ **Server-side authorisation** — row-level security plus server functions; the browser is never trusted.
- ✅ **Database** — the full model in Postgres, with an append-only, tamper-evident audit log and immutable record versions.
- ✅ **Real sign-in and codes** — Supabase Auth with emailed codes and server-side step-up verification for sharing.
- ✅ **Private document storage** — no public URLs; downloads only after a permission check.
- ✅ **Background job** for access expiry and reminders.
- ✅ **Doctor sign-up with verification** — doctors apply with their medical council registration; a Niveda administrator checks it on the Indian Medical Register and verifies or asks for changes.
- ✅ Encryption in transit and at rest (provided by Supabase).

Still to do:

1. **Identity** — server-enforced multi-factor authentication (Supabase MFA), SMS codes (e.g. MSG91/Twilio), device management beyond sign-out.
2. **Encryption** — field-level encryption for mental-health and other sensitive categories, with key management.
3. **Document handling** — virus scanning, and downloads through an Edge Function so document views are logged by the server rather than the app.
4. **Clinician verification** — automatic checks through ABDM's Healthcare Professionals Registry instead of by hand; hospital and organisation accounts.
5. **Emergency ("break-glass") access** — a policy for access when the patient can't consent, with justification, time limits, immediate patient notification and review.
6. **Compliance** — India's Digital Personal Data Protection Act 2023, ABDM / ABHA integration and consent artefacts, and HIPAA / GDPR where relevant; retention and deletion policies; security audits and penetration testing.
7. **Interoperability** — FHIR R4 import and export; integrations with labs and hospital systems.
8. **Operations** — monitoring and alerting, backups with point-in-time recovery, tuned rate limits, custom email delivery at scale.
9. **Mobile app** — for push notifications, the lock-screen emergency card, offline access, and **medicine alarms that ring when the app is closed**.
10. **Smartwatch integration** — a companion watch app (watchOS / Wear OS) and Apple HealthKit / Google Health Connect so doses can be marked taken from the wrist and schedules stay in sync automatically.

## Roadmap ideas

- Reading uploaded reports with OCR and suggesting structured entries for the patient to confirm.
- Family accounts — parents managing a child's record, carers for elderly relatives.
- Lab-result trends (HbA1c, haemoglobin, blood pressure) over the years.
- Medication reminders and refill tracking.
- Translations into Hindi, Telugu, Tamil and other languages, with clinically reviewed terminology.
- Hospital-side integration so labs can post results directly into the record with the patient's consent.

---

*Niveda is a prototype. It does not provide medical advice. All demo data is fictional.*

---

## Licence

Copyright © 2026 Akhila Bellam. All rights reserved — see [LICENSE](LICENSE).
