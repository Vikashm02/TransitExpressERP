# Transport monthly reports + Notification Center (V1)

## What this adds

- Settings → **Notification Center**
  - Admin-configured report recipient email list (`text[]`)
  - Test in-app / push / email
  - Generate & email **August 2026** Transport monthly summary
  - Delivery history
  - Monthly automation toggle (default **OFF**)

- Edge Function: `notification-center`
- Migrations (apply manually, in order):
  - `071_transport_report_notifications.sql`
  - `072_report_multiple_email_recipients.sql` (`report_email_to` text → text[])

## Report definition

Window: `lr_date >= from AND lr_date < to_exclusive`
Filters: `entry_status = final`, `status IS DISTINCT FROM 'Cancelled'`
Metrics:

- Total LRs
- Total Loading Weight (`sum(loading_weight)`)
- Unique Vehicles (`count(distinct nullif(trim(vehicle_number),''))`)
- Top 10 consignees by loading weight (+ LR count)

August 2026 = `[2026-08-01, 2026-09-01)`.

## Environment variables (names only)

### Edge Function secrets (required for email + tests)

```bash
RESEND_API_KEY=...
REPORT_EMAIL_FROM=...          # verified Resend sender, e.g. reports@yourdomain.com
SUPABASE_URL=...
SERVICE_ROLE_KEY=...
VAPID_PUBLIC_KEY=...           # existing push
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=...
SUPABASE_SECRET_KEYS=...       # platform / cron auth (JSON map of secret API keys)
```

Never put `RESEND_API_KEY`, `SERVICE_ROLE_KEY`, or Secret API keys in `NEXT_PUBLIC_*` or in Git.

## Deploy

```bash
# 1) Apply migrations 071 then 072 in Supabase SQL Editor
# 2) Set Edge secrets above
# 3) Deploy function
supabase functions deploy notification-center
```

## Production monthly scheduler (required — not in Git)

### Architecture decision (this repo)

This project does **not** check in `pg_cron` SQL that embeds HTTP secrets (same pattern as
`docs/NOTIFICATIONS_SETUP.md` for `process-notifications`).

Supported production mechanism:

1. **Preferred:** Supabase Dashboard → **Integrations → Cron** → create a job that invokes the
   **Supabase Edge Function** `notification-center` (uses hosted Cron + `pg_net` under the hood).
2. **Alternative:** Dashboard Cron job type **HTTP request** with the same URL/headers/body below.
3. **Do not** add this invoke to the existing `process-notifications` schedule.
4. **Do not** commit Secret API key values, Vault plaintext, or SQL that hard-codes keys.

`notification-center` already enforces:

- Secret API key on `apikey` for `run_monthly_transport_report`
- `monthly_transport_enabled` gate (default **false**)
- `monthly_day` (default **1**) using **Asia/Kolkata** calendar date
- previous calendar month period
- email idempotency + `report_deliveries` audit

The scheduler’s only job is to **call the function once per day**.

### Exact invoke contract

| Field | Value |
|--------|--------|
| Schedule | Once daily |
| Preferred wall-clock | **06:00 Asia/Kolkata** |
| UTC cron equivalent | `30 0 * * *` (00:30 UTC = 06:00 IST; no DST) |
| Method | `POST` |
| Endpoint | `https://<project-ref>.supabase.co/functions/v1/notification-center` |
| Header | `Content-Type: application/json` |
| Header | `apikey: <SUPABASE_SECRET_API_KEY>` |
| Body | `{ "action": "run_monthly_transport_report" }` |

Timezone notes:

- **Cron clock:** use UTC expression `30 0 * * *` (or Dashboard equivalent for 06:00 IST).
- **Business day gate:** inside the Edge Function via `Asia/Kolkata` (`monthly_day`), not the cron timezone alone.
- Daily runs on non-send days return skip (`not monthly_day` or automation off) — that is expected.

Auth notes:

- Use a **project Secret API key** (same class of key used for `process-notifications` cron).
- Put the key only in the Dashboard Cron HTTP/auth fields (or Vault if you configure Cron that way).
- Ensure the same key value is present in the Edge Function secret `SUPABASE_SECRET_KEYS` (JSON map)
  and/or `SUPABASE_SECRET_KEY` so `hasValidSecretApiKey` accepts it.
- **Do not** use the publishable/anon key.
- **Do not** use a user JWT.
- **Do not** use `Authorization: Bearer <SERVICE_ROLE_KEY>` for this cron path.

Suggested Cron job name: `transport-monthly-report-daily`.

### Manual Supabase Dashboard steps

Leave **Settings → Notification Center → Enable monthly automation** **unchecked** until
scheduler verification succeeds.

1. Open the Supabase project Dashboard for Transjit ERP.
2. Go to **Integrations → Cron** (Cron Jobs). Enable the Cron module / `pg_cron` if prompted.
3. Click **Create job**.
4. Name: `transport-monthly-report-daily`.
5. Schedule:
   - Prefer natural language / time picker for **every day at 06:00 Asia/Kolkata**, **or**
   - Cron syntax: `30 0 * * *` (UTC).
6. Job type: **Supabase Edge Function**.
   - Function: `notification-center`
   - Method: `POST`
   - Body:

     ```json
     { "action": "run_monthly_transport_report" }
     ```

   - If the form asks for headers / API key: set `apikey` to the **Secret API key**
     (paste in Dashboard only — never into this repo).
7. If Edge Function type is unavailable, use job type **HTTP request** instead:
   - URL: `https://<project-ref>.supabase.co/functions/v1/notification-center`
   - Method: `POST`
   - Headers: `Content-Type: application/json` and `apikey: <SUPABASE_SECRET_API_KEY>`
   - Body: `{ "action": "run_monthly_transport_report" }`
8. Save the job. Confirm it appears in the Cron Jobs list and is **enabled**.
9. Do **not** turn on `monthly_transport_enabled` yet.

### Verify the scheduler without sending a production email

Keep `monthly_transport_enabled = false` (UI unchecked / DB default).

1. **Optional dry invoke** (from a trusted machine; do not paste the key into chat/Git):

   ```bash
   curl -sS -X POST \
     "https://<project-ref>.supabase.co/functions/v1/notification-center" \
     -H "Content-Type: application/json" \
     -H "apikey: <SUPABASE_SECRET_API_KEY>" \
     -d '{"action":"run_monthly_transport_report"}'
   ```

   Expected JSON when automation is still off:

   ```json
   { "ok": true, "skipped": true, "reason": "monthly_transport_enabled is false" }
   ```

2. In Dashboard → **Edge Functions → notification-center → Logs**, confirm the scheduled
   (or curl) invoke arrived and returned the skip payload (HTTP 200).
3. In Dashboard → **Cron** → job run history for `transport-monthly-report-daily`, confirm a
   successful run after the next scheduled time (or after a one-off “Run” if the UI offers it).
4. In Settings → Notification Center → **Recent report deliveries**, confirm **no new**
   automated `channel = email` / `status = sent` row was created by this dry run.
5. Only after steps 1–4 succeed: enable **monthly automation** in Settings and Save
   (`monthly_transport_enabled = true`). Recipients stay as already configured.

On the next **1st of the month (Asia/Kolkata)** after enablement, the daily job will send the
previous calendar month once (idempotent).

## Manual August test path (completed in production)

1. Apply migrations 071 then 072
2. Deploy function + set Resend secrets
3. Settings → Notification Center → add recipients → Save
4. Generate August 2026 Report (preview DB totals)
5. Send Test Email (August 2026)
6. Confirm delivery history + inbox/email
7. Configure production daily Cron (this document)
8. Verify Cron with automation still **OFF**
9. Only then enable monthly automation
