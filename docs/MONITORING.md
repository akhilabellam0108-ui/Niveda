# Monitoring Niveda

## What is watched

The **Monitor** GitHub workflow (`.github/workflows/monitor.yml`) runs every 30 minutes and checks:

| Check | Healthy when |
|---|---|
| Website | `https://akhilabellam0108-ui.github.io/Niveda/` answers 200 |
| Database | Supabase answers `system_health()` (a paused or down project fails here) |
| Background jobs | no pg_cron job failed in the last hour; the access-expiry job ran in the last 15 minutes; the reminder and erasure functions answered OK in the last 30 minutes; no account erasure is more than a day overdue |

`system_health()` returns counts only — never anything about a person. It also reports complaints past their 90-day deadline and files waiting more than a day for the safety check (shown, but not alerting).

## When something fails

The workflow opens an issue titled **"Niveda: something needs attention"** with the label `outage` (GitHub emails the repository owner), adds a comment on each further failure, and closes it once everything passes again. Run it by hand from **Actions → Monitor → Run workflow**.

| Symptom | First thing to check |
|---|---|
| Database: no answer | Supabase dashboard — is the project **paused**? (Free projects pause after a week without use.) Restore it. |
| `accessExpiryJobRunning: false` | **Database → Cron Jobs** → `niveda-sweep-grants`. Is pg_cron enabled? |
| `failedBackgroundCallsLast30Min` > 0 | **Edge Functions → send-reminders / process-deletions → Logs** |
| `overdueDeletions` > 0 | **Edge Functions → process-deletions → Logs**; erasures must finish (DPDP Act) |
| `overdueGrievances` > 0 | Answer them in the app under **Niveda team → Complaints** |

For anything that could be a data leak, follow [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
