# Releasing Niveda on Google Play and the App Store

The code side is ready: signed Android App Bundle builds, an iPhone project, CI for both,
and the in-app features both stores require (privacy policy, in-app account deletion,
no tracking). What's left needs **your accounts** — the steps are below.

**Before any store build:** set the repository variables `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` (and optionally `VITE_OTP_CHANNEL=sms`, `VITE_ABDM_ENABLED=true`).
A build without them runs the demo, which must not be published.

Links you'll need:

| What | URL |
|---|---|
| Privacy policy | `https://akhilabellam0108-ui.github.io/niveda/#/legal/privacy` (or your own domain) |
| Terms | `https://akhilabellam0108-ui.github.io/niveda/#/legal/terms` |
| Delete account (web) | Sign in at the web app → Privacy & security → Delete my account |
| Support email | `brand.supportEmail` in `src/config/brand.ts` — set a real one |

---

## Google Play

### 1. One-time setup (≈1 hour + Google's checks)

1. **Play Console account** — <https://play.google.com/console>, one-time US$25. Choose an
   **Organization** account if you have a company (needs a D-U-N-S number); personal accounts
   created recently must run a **closed test with 12+ testers for 14 days** before production.
2. **Create the upload key** on your computer (keep the file and passwords safe — losing them
   means asking Google to reset the key):
   ```bash
   keytool -genkeypair -v -keystore niveda-upload.jks -alias niveda -keyalg RSA -keysize 4096 -validity 10000
   base64 -w0 niveda-upload.jks > niveda-upload.jks.b64      # macOS: base64 -i niveda-upload.jks
   ```
3. **GitHub secrets** (Settings → Secrets and variables → Actions):
   `ANDROID_KEYSTORE_BASE64` (contents of the .b64 file), `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS` (`niveda`), `ANDROID_KEY_PASSWORD`.
4. **Create the app** in Play Console: name *Niveda*, default language English (India), App, Free.
   Turn on **Play App Signing** (default).

### 2. Build and upload

Actions → **Android release (Play Store)** → Run workflow → track `none` the first time.
Download the `Niveda-aab` artifact and upload it to **Testing → Internal testing** by hand.

To upload automatically afterwards: Play Console → Setup → API access → create a service account
with *Release manager* rights → add its JSON key as `PLAY_SERVICE_ACCOUNT_JSON`. Then run the
workflow with track `internal` / `alpha` / `beta` (production uploads are left as a draft for you
to review). Pushing a tag like `v1.0.0` also builds a signed bundle.

### 3. App content (Policy → App content)

| Section | Answer |
|---|---|
| Privacy policy | the privacy policy URL above |
| App access | "All functionality is restricted" → give a **test patient login** and a **test doctor login** on the live backend, with instructions ("the code is emailed to … / use test number …"). Create dedicated review accounts. |
| Ads | No ads |
| Content rating | Questionnaire → Reference/Health; no user-generated public content → rated for everyone |
| Target audience | **18 and over only** (the app blocks under-18 sign-up) |
| News app | No |
| **Health apps declaration** | Category: *Medical / Health records*; it is not a medical device, doesn't diagnose; data shared only with clinicians the user authorises |
| Government app | No (unless distributed for a government body) |
| Financial features | None |
| **Data safety** | See next table |
| **Account deletion** | In-app: Privacy & security → Delete my account. Web URL: the web app (same screen). Data deleted 7 days after the request; grievances kept without identity. |
| **Exact alarm permission** (`SCHEDULE_EXACT_ALARM`) | Declare: core feature is **medication reminders that must ring at the prescribed time** |
| Foreground services / photo & video | None used |

**Data safety form**

| Data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Name, email, phone, date of birth | Yes | No* | Account management, app functionality | Required |
| Health info (records, medicines, allergies, conditions) | Yes | With clinicians the user chooses — counts as user-initiated sharing, not "shared" | App functionality | Required |
| Files and docs (medical documents) | Yes | Same as above | App functionality | Optional |
| Photos | Only if uploaded as documents | — | App functionality | Optional |
| App activity (in-app actions, for the audit log) | Yes | No | Security, app functionality | Required |
| Device or other IDs (push subscription) | Yes | No | Reminders | Optional |
| Location, contacts, financial info, ads ID | **No** | | | |

- Data is **encrypted in transit**: Yes. Users can **request deletion**: Yes.
- *Service providers (Supabase, SMS, email) acting on Niveda's behalf don't count as "sharing".
- Independent security review badge: only after the pen test, via Google's MASA program (optional).

### 4. Store listing

- **App name:** Niveda — Health Records
- **Short description (≤80):** Your lifelong health record. You decide which doctor sees what.
- **Full description:**

  > Niveda keeps your whole medical history in one place — visits, diagnoses, medicines, allergies,
  > lab results, scans, surgeries and vaccinations — and you stay in control of it.
  >
  > • **You own your record.** Nobody sees it unless you allow them.
  > • **Share with a doctor in seconds.** Choose what they can see and for how long; access ends by itself.
  > • **Doctors add to your record directly** after a visit, with their name and hospital on every entry.
  > • **See every access.** A full log of who opened, added or corrected anything.
  > • **Never miss a dose.** Medicine reminders that ring on time, with Taken / Snooze / Skip — on your watch too.
  > • **Emergency card** with your blood group, allergies and emergency contact.
  > • **Link your ABHA** (Ayushman Bharat Health Account).
  > • **Private by design.** Sensitive records are encrypted; we never sell data and show no ads.
  >
  > Niveda doesn't give medical advice. In an emergency, call 112.

- **Graphics:** icon 512×512 (`public/icon-512.png`), feature graphic 1024×500, at least
  2 phone screenshots (1080×1920 or similar) — use the demo with fictional data.
- **Category:** Medical. **Tags:** health records, medication reminder.

### 5. Release

Internal testing → (closed testing if required) → **Production**, starting with a staged rollout (10%).
Every new upload needs a higher version code — the workflow uses `1000 + run number`, so this is automatic.

---

## Apple App Store (iPhone)

### 1. One-time setup

1. **Apple Developer Program** — <https://developer.apple.com/programs/>, US$99/year
   (organisation enrolment needs a D-U-N-S number).
2. You need **a Mac with Xcode** for the first run and for screenshots, *or* use the GitHub workflow,
   which runs on Apple's machines.
3. **App Store Connect** → My Apps → **+ New App**: platform iOS, name *Niveda — Health Records*,
   bundle ID **in.niveda.app** (register it first under Certificates, IDs & Profiles → Identifiers),
   SKU `niveda-ios`.
4. **API key** for CI: App Store Connect → Users and Access → Integrations → **App Store Connect API** →
   generate a key with *App Manager* role. Download the `.p8` (only once).
5. **GitHub secrets:** `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`
   (`base64 -i AuthKey_XXXX.p8`).

### 2. Build and upload

Actions → **iPhone app** → Run workflow → tick **Sign and upload to TestFlight**. After Apple
processes it (10–30 min) it appears under TestFlight; add yourself as a tester and install it with
the TestFlight app. On a Mac you can instead run `npm run ios` and use Xcode → Product → Archive.

### 3. App Privacy ("nutrition label")

Data **linked to the user**, **not used for tracking**:
Contact info (name, email, phone) · Health & fitness → Health (records) · User content (documents) ·
Identifiers (user ID) · Usage data → product interaction (audit log). Purpose: *App functionality*
(and *Account management*). **Tracking: No.**

### 4. Review notes (they matter for health apps)

- **Sign-in:** give a reviewer patient and doctor account, and how they receive the code
  (e.g. a review account whose codes go to an inbox you watch, or a fixed test phone number).
- **Guideline 1.4.1 (medical):** say Niveda stores records and reminders; it does not diagnose,
  dose or measure anything.
- **Guideline 5.1.1(v):** account deletion is in-app (Privacy & security → Delete my account) ✅.
- **Guideline 5.1.3 (health data):** data isn't used for advertising or shared with third parties
  except clinicians the user authorises ✅. Don't add HealthKit until it's needed — it brings extra review.
- Export compliance: the app uses only standard HTTPS, so `ITSAppUsesNonExemptEncryption` is set to *No*.

### 5. Listing

Same texts as Google Play. Screenshots: 6.9" (1320×2868) and 6.5" (1284×2778) iPhone; iPad only if
you enable iPad. Age rating: answer *Medical/Treatment Information: Frequent* (gives 12+); sign-up is
limited to adults inside the app. Price: Free.

---

## Checklist

- [ ] Live backend set up ([SUPABASE_SETUP.md](SUPABASE_SETUP.md)) and repository variables set
- [ ] Real support email, grievance officer and legal review (`brand.ts`, [DPDP.md](DPDP.md))
- [ ] Review accounts for patient and doctor on the live backend
- [ ] Play: developer account, upload key + secrets, app content forms, closed test if required
- [ ] Apple: developer account, bundle ID, API key + secrets, App Privacy, review notes
- [ ] Screenshots from the demo (fictional data only)
- [ ] Pen test done before wide release ([SECURITY.md](SECURITY.md))
