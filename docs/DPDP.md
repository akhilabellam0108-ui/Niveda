# DPDP Act 2023 — how Niveda complies

India's **Digital Personal Data Protection Act, 2023** and the **DPDP Rules, 2025** (notified
13 November 2025; most obligations apply after the transition period — plan for late 2026 /
2027). Health data is personal data; Niveda is the **Data Fiduciary**.

> This is an engineering map, not legal advice. **Have a lawyer review it, the privacy notice
> and the terms before launch**, then set `legalReviewed: true` in `src/config/brand.ts`.

| Requirement | Where it is in Niveda | Status |
|---|---|---|
| **Notice before consent** (s.5, Rule 3): plain language, data, purposes, how to withdraw and complain | `/legal/privacy`; version in `brand.privacyNoticeVersion`; shown at sign-up | ✅ built — needs legal review and translations on request |
| **Free, specific, informed consent; no pre-ticked boxes** (s.6) | Sign-up: one required consent (the record) + optional ones; product updates off by default | ✅ |
| **Withdraw as easily as given** (s.6(4)) | Privacy & security → *What you've agreed to*; one tap; withdrawing reminders turns them off | ✅ |
| **Consent records** | `consents` table: append-only ledger with notice version and time | ✅ |
| **Purpose limitation** | Data used only for listed purposes; no ads, no selling, no analytics trackers | ✅ |
| **Security safeguards** (s.8(5), Rule 6): encryption, access control, logs, 1-year log retention | See [SECURITY.md](SECURITY.md): RLS, field encryption, audit log kept for life of account | ✅ — pen test pending |
| **Breach notification** to the Board and each affected person (s.8(6), Rule 7) | [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) | ✅ runbook — drill pending |
| **Right to access a summary** (s.11) | Everything visible in-app; full export in Settings → Data & export | ✅ |
| **Right to correction** (s.12) | Patients edit their own entries; doctors correct theirs with a recorded reason; grievance route for others | ✅ |
| **Right to erasure** (s.12, Rule 14 — within 90 days) | Delete account → 7-day window → `process-deletions` erases files, record, logs, consents | ✅ |
| **Grievance redressal within 90 days** (s.13) | Raise a grievance in-app; reference + deadline; team answers from Admin → Grievances | ✅ |
| **Grievance officer contact published** (s.8(9)) | `brand.grievanceOfficer` — shown in the notice and the app | ⚠️ set real name/email |
| **Nominee** (s.14) | Privacy & security → Nominee | ✅ |
| **Children's data** (s.9): verifiable parental consent, no tracking | Under-18s can't create an account (checked in the app and the database). No tracking for anyone | ✅ — family accounts with DigiLocker-verified parental consent are a future feature |
| **Retention: erase when purpose ends** | Erased on request; inactive-account policy not set yet | ⚠️ decide (e.g. warn after 3 years inactive, erase after 48 h notice) |
| **Processors under contract** (s.8(2)) | Supabase (DPA), SMS provider, email provider | ⚠️ sign DPAs; keep a list |
| **Data localisation** | Choose Supabase region **ap-south-1 (Mumbai)** | ⚠️ confirm on the production project |
| **Significant Data Fiduciary duties** (DPO, DPIA, audits) | Not designated yet; likely if Niveda grows large | 🔜 plan for it |

## Health-sector rules that also apply

- **ABDM Health Data Management Policy** — consent artefacts, and the right to unlink. Niveda links
  ABHA only after OTP; unlink is one tap. Full HIP/HIU consent flows are the next ABDM milestone (see [ABDM.md](ABDM.md)).
- **Telemedicine Practice Guidelines / NMC record-keeping** — doctors keep their own records for 3 years.
  Niveda is the patient's copy; deletion erases Niveda's copy, not the hospital's own system.
- **IT Act 2000 s.43A & SPDI Rules** — reasonable security practices (ISO 27001-style controls); the
  pen test and ISO 27001 certification later support this.
