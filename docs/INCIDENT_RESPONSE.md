# Incident response — data breach runbook

Use this the moment anyone suspects personal data was seen, changed, lost or taken by
someone who shouldn't have it. Speed matters more than certainty.

**Legal clock (DPDP Rules 2025, Rule 7):** tell the **Data Protection Board** without delay
when you become aware, and give the **full report within 72 hours**. Tell **each affected
person** without delay. **CERT-In** expects cyber incidents reported within **6 hours**
(CERT-In Directions, April 2022). Fines for failing to notify go up to ₹200 crore.

## Roles

| Role | Who | Does |
|---|---|---|
| Incident lead | Founder / CTO | Decides, keeps the timeline, signs off notices |
| Technical lead | Senior engineer | Contains, investigates, preserves evidence |
| Grievance officer | `brand.grievanceOfficer` | Notices to people, answers questions |
| Legal | Retained counsel | Reviews Board and CERT-In reports |

## Hour 0–1: contain

1. Open an incident log (time, who, what) — a private doc. Write everything down.
2. Stop the bleeding:
   - Leaked key → rotate it in Supabase (service role / anon / JWT secret), ABDM, SMS provider, `CRON_SECRET`.
   - Compromised account → revoke its sessions (Supabase Auth → Users → sign out), reset password.
   - Misbehaving doctor → revoke their grants: `update access_grants set status = 'revoked', revoked_at = now() where doctor_id = '…' and status = 'active';`
   - Bad deploy → roll back the web build / Edge Function.
3. **Preserve evidence**: export Supabase logs (API, Auth, Postgres), the audit log rows involved, and
   check the chain: `select public.verify_audit_chain();`

## Hour 1–6: assess and report to CERT-In

- What data, how many people, which categories (mental health? documents?), was it encrypted?
- Use the audit log to list exactly which records each actor viewed.
- Report to CERT-In (incident@cert-in.org.in) within 6 hours of noticing.

## Within 72 hours: the Board and the people affected

**To the Data Protection Board** (portal/address published by the Board): nature, extent, timing and
location of the breach; likely impact; what you've done; what people should do; contact person.

**To each affected person** (in-app notification + email/SMS), plainly:
- what happened and when; what data of theirs was involved;
- what we've done; what they should do (e.g. watch for phishing, change password);
- how to contact the grievance officer.

Template:

> We're writing because of a security incident at Niveda on [date]. [What happened, one sentence.]
> It involved your [data]. It did / did not include your medical records. We have [actions].
> You should [steps]. If you have questions, contact our Grievance Officer at [email] or raise a
> grievance in the app (Privacy & security). We're sorry this happened.

## After

- Root cause, fixes, and a test that would have caught it (add it to `tests/db/backend.test.mjs`).
- Update [SECURITY.md](SECURITY.md) findings table.
- Run a drill of this runbook every 6 months.
