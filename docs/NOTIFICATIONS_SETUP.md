# Notifications & PWA setup

## Hosting note (inspected)

Project configuration:

- `next.config.mjs` has **no** `output: 'export'`
- `package.json` uses `next build` + `next start` (Node server)

There is **no** Hostinger deploy config in the repo. Production must allow:

1. Serving the Next.js app (or at least static assets + SW + manifest)
2. Supabase Edge Functions for **push send** and **scheduled delivery**

True Web Push sending and cron **do not require Hostinger Node** if
secrets live in Supabase Edge Function environment. The browser only
needs the public VAPID key.

If Hostinger currently serves a **static-only export** without a working
service worker / HTTPS app origin, PWA install and push will fail until
the site is served over HTTPS from the real app origin.

## Required environment variables

### Browser / Next.js (public)

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...   # Web Push applicationServerKey
```

### Server-only — Next.js (optional local API helpers)

```bash
VAPID_PRIVATE_KEY=...             # NEVER NEXT_PUBLIC_
VAPID_SUBJECT=mailto:admin@example.com
SUPABASE_SERVICE_ROLE_KEY=...     # NEVER NEXT_PUBLIC_
```

### Supabase Edge Function secrets (required for send + cron)

Set in Supabase Dashboard → Edge Functions → Secrets:

```bash
VAPID_PUBLIC_KEY=...              # same as NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com
SERVICE_ROLE_KEY=...              # DB admin client (temporary; do not use for Cron auth)
SUPABASE_URL=...                  # project URL
```

Platform also injects `SUPABASE_SECRET_KEYS` (JSON map of Secret API keys).
Cron authorization uses those keys via the `apikey` header — not
`SERVICE_ROLE_KEY`, and never any `NEXT_PUBLIC_*` value.

## Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

Put the public key in `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and both keys in
Edge Function secrets. Never commit private keys.

## Apply database migration

Run manually in Supabase SQL Editor:

`database/migrations/028_notifications_announcements_pwa.sql`

## Deploy Edge Function

```bash
supabase functions deploy process-notifications
```

## Authorization model (important)

### Scheduled / cron (bulk)

Requires a **Secret API Key** on the `apikey` header (server-side only):

```http
apikey: <SUPABASE_SECRET_API_KEY>
Content-Type: application/json
```

Body:

```json
{ "mode": "scheduled" }
```

Rules:

- Use a Secret API key from Dashboard → Settings → API Keys (`sb_secret_…`).
- **Never** put the Secret API key in any `NEXT_PUBLIC_*` variable.
- **Never** put it in browser / client code.
- **Do not** use the publishable / anon key for scheduled processing.
- **Do not** use a user JWT for scheduled processing.
- A normal authenticated ERP user JWT is **rejected** (HTTP 403) for
  `mode: "scheduled"`.

`supabase/config.toml` sets `verify_jwt = false` for this function so Cron
calls authenticated via `apikey` can reach the handler. Authorization is
enforced inside the Edge Function.

### Immediate (single event)

Called by the ERP client after enqueue via `supabase.functions.invoke`
with the user JWT. The function only processes that `eventId` and only
if `created_by` matches the caller (or a trusted server credential).

```json
{ "mode": "immediate", "eventId": 123 }
```

## Cron (scheduled / quiet-hours delivery)

In Supabase SQL (pg_cron + pg_net) or Dashboard Schedules, invoke every
5–15 minutes **with a Secret API key on `apikey`** (never from the browser):

```
POST https://<project-ref>.supabase.co/functions/v1/process-notifications
apikey: <SUPABASE_SECRET_API_KEY>
Content-Type: application/json

{ "mode": "scheduled" }
```

Do **not** send `Authorization: Bearer <SERVICE_ROLE_KEY>` for Cron.
Do **not** use the publishable/anon key or a user JWT.

## Delivery status

- At least one push succeeds → event status `sent`
- No subscriptions, or all push attempts fail → event status `failed`
  (never falsely marked `sent`)
- Dead subscriptions (404/410) are removed

## Announcement images

Bucket `announcement-assets` is **PUBLIC** by design so announcement
`<img>` banners can use `getPublicUrl()`. Upload/update/delete remain
admin-only via storage RLS.

## Reserved rules

`dc.deleted` is seeded but unused: Delivery Challan has no delete
service/UI yet. Keep the rule OFF until a real delete path exists.

## Client flow

1. User installs PWA / grants notification permission
2. Browser creates a PushSubscription
3. App stores it in `push_subscriptions` (RLS: own user)
4. ERP services enqueue rows in `notification_events` (non-blocking)
5. Immediate: client invokes Edge Function for that event only
6. Scheduled: cron invokes Edge Function with Secret API key (`apikey` header)
7. Edge Function sends Web Push + writes `notification_inbox`
