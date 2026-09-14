// Bid reminder dispatcher (Phase 1). NOT YET DEPLOYED — review only.
//
// Isolated from process-trusted-lr-notifications: separate table
// (bid_reminders), separate scheduler, same proven patterns:
// Secret-API-key auth, idempotent claim, per-target retries (<=3),
// FCM HTTP v1 via FIREBASE_SERVICE_ACCOUNT_JSON, inbox fan-out for the
// in-app bell, terminal states never reprocessed.
//
// Missed-reminder policy: send if <= 15 minutes late, else Expired.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { importPKCS8, SignJWT } from "npm:jose@5.10.0";
import webpush from "npm:web-push@3.6.7";

const APP_ID = "in.transjitexpresserp.app";
const PLATFORM = "android";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_EXTERNAL_ATTEMPTS = 3;
const GRACE_MS = 15 * 60 * 1000;
const STALE_CLAIM_MS = 5 * 60 * 1000;
const BATCH_LIMIT = 25;

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
type BidReminder = {
  id: string;
  bid_id: string;
  user_id: string;
  remind_at: string;
  status: string;
  attempt_count: number;
  cancel_requested: boolean;
};

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ ok: false, code: "method_not_allowed", message: "POST is required." }, 405);
    if (!hasValidSecretApiKey(req)) return json({ ok: false, code: "forbidden", message: "Forbidden." }, 403);

    const body = await req.json().catch(() => null);
    const scheduled = body !== null && typeof body === "object" && (body as { mode?: unknown }).mode === "scheduled";
    const reminderId =
      body !== null && typeof body === "object" && typeof (body as { reminderId?: unknown }).reminderId === "string"
        ? (body as { reminderId: string }).reminderId
        : null;
    if (!scheduled && !reminderId) {
      return json({ ok: false, code: "invalid_request", message: 'mode "scheduled" or a reminderId is required.' }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SUPABASE_PROJECT_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const serviceAccount = getServiceAccount();
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
    if (!supabaseUrl || !serviceRoleKey || !serviceAccount || !vapidPublic || !vapidPrivate) {
      console.error("[Bid reminders] required server configuration is missing");
      return json({ ok: false, code: "server_misconfigured", message: "Server configuration is incomplete." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    let processed = 0;
    let sent = 0;
    let failed = 0;

    if (reminderId) {
      const outcome = await dispatchReminder(admin, serviceAccount, reminderId);
      processed = 1;
      if (outcome === "sent") sent = 1;
      else if (outcome === "failed") failed = 1;
    } else {
      const recovered = await recoverStaleSending(admin);
      const due = await findDueReminders(admin);
      for (const row of due) {
        const outcome = await dispatchReminder(admin, serviceAccount, row.id);
        processed += 1;
        if (outcome === "sent") sent += 1;
        else if (outcome === "failed") failed += 1;
      }
      processed += recovered;
    }

    return json({ ok: true, processed, sent, failed });
  } catch (error) {
    console.error("[Bid reminders] dispatcher failed", error instanceof Error ? error.message : "unknown");
    return json({ ok: false, code: "dispatch_failed", message: "Unable to dispatch bid reminders." }, 500);
  }
});

async function findDueReminders(admin: SupabaseClient): Promise<Array<{ id: string }>> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("bid_reminders")
    .select("id")
    .eq("status", "Scheduled")
    .lte("remind_at", now)
    .order("remind_at", { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string }>;
}

type Outcome = "sent" | "failed" | "skipped";

/**
 * Deterministic stale-claim recovery (5-minute threshold). A Sending row
 * older than the threshold whose worker died is returned to Scheduled ONLY
 * when it is still genuinely sendable; otherwise it moves to the correct
 * terminal state. Overdue rows Expire; exhausted rows Fail; cancelled or
 * dead-bid rows Cancel. Never touches fresh Sending rows.
 */
async function recoverStaleSending(admin: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data, error } = await admin
    .from("bid_reminders")
    .select("id, bid_id, user_id, remind_at, status, attempt_count, cancel_requested")
    .eq("status", "Sending")
    .lt("claimed_at", cutoff)
    .limit(BATCH_LIMIT);
  if (error) throw error;

  let recovered = 0;
  for (const row of (data ?? []) as BidReminder[]) {
    if (row.cancel_requested) {
      await admin
        .from("bid_reminders")
        .update({ status: "Cancelled", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "Sending");
    } else if (Date.now() - Date.parse(row.remind_at) > GRACE_MS) {
      await admin
        .from("bid_reminders")
        .update({ status: "Expired", failure_code: "missed_grace_window", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "Sending");
    } else if (row.attempt_count >= MAX_EXTERNAL_ATTEMPTS) {
      await admin
        .from("bid_reminders")
        .update({ status: "Failed", failure_code: "delivery_attempts_exhausted", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "Sending");
    } else {
      const { data: bidRows } = await admin
        .from("transport_bids")
        .select("status")
        .eq("id", row.bid_id)
        .limit(1);
      const live = (bidRows ?? [])[0] && String((bidRows as Array<Record<string, unknown>>)[0].status) === "Live";
      await admin
        .from("bid_reminders")
        .update(
          live
            ? { status: "Scheduled", claimed_at: null, updated_at: new Date().toISOString() }
            : { status: "Cancelled", failure_code: "bid_no_longer_live", updated_at: new Date().toISOString() }
        )
        .eq("id", row.id)
        .eq("status", "Sending");
    }
    recovered += 1;
  }
  return recovered;
}

async function dispatchReminder(
  admin: SupabaseClient,
  serviceAccount: ServiceAccount,
  reminderId: string
): Promise<Outcome> {
  // Atomic claim at the database level: a single UPDATE transitions the
  // row, and only the worker receiving the RETURNED row may continue.
  // Concurrent workers receive zero rows and skip — double-send impossible.
  const { data: claimedRows, error: claimError } = await admin.rpc("claim_bid_reminder", {
    p_reminder_id: reminderId,
  });
  if (claimError) throw claimError;
  const current = (claimedRows ?? [])[0] as BidReminder | undefined;
  if (!current) return "skipped";

  const finish = async (
    status: "Sent" | "Cancelled" | "Expired" | "Failed" | "Scheduled",
    patch: Record<string, unknown> = {}
  ): Promise<Outcome> => {
    await admin
      .from("bid_reminders")
      .update({ status, updated_at: new Date().toISOString(), ...patch })
      .eq("id", current.id);
    return status === "Sent" ? "sent" : status === "Scheduled" ? "failed" : "skipped";
  };

  // Pre-send recheck immediately before any external delivery. A user
  // or bid-close cancel aborts to Cancelled; any other supersede (e.g. a
  // stale-recovery pass) leaves the row untouched — never clobber it.
  const recheck = async (): Promise<{ ok: boolean; cancelled: boolean }> => {
    const { data: freshRows } = await admin
      .from("bid_reminders")
      .select("status, remind_at, attempt_count, cancel_requested")
      .eq("id", current.id)
      .limit(1);
    const fresh = (freshRows ?? [])[0] as
      | { status: string; remind_at: string; attempt_count: number; cancel_requested: boolean }
      | undefined;
    if (!fresh) return { ok: false, cancelled: false };
    if (fresh.cancel_requested) return { ok: false, cancelled: true };
    const same =
      fresh.status === "Sending" &&
      fresh.attempt_count === current.attempt_count &&
      fresh.remind_at === current.remind_at;
    return { ok: same, cancelled: false };
  };

  // Missed-reminder policy: > 15 minutes late is Expired, never sent.
  if (Date.now() - Date.parse(current.remind_at) > GRACE_MS) {
    return finish("Expired", { failure_code: "missed_grace_window" });
  }

  // Re-validate the bid is still Live at send time.
  const { data: bidRows, error: bidError } = await admin
    .from("transport_bids")
    .select(
      "id, bid_reference, billing_party_name, consignor_name, consignee_name, pickup_location, dropoff_location, status, closes_at, bid_rate, bid_rate_basis, expected_load_mt"
    )
    .eq("id", current.bid_id)
    .limit(1);
  if (bidError) throw bidError;
  const bid = (bidRows ?? [])[0] as Record<string, unknown> | undefined;
  if (!bid || String(bid.status) !== "Live") {
    return finish("Cancelled", { failure_code: "bid_no_longer_live" });
  }

  // Eligibility re-check for THIS user via direct table reads (never
  // has_permission()/has_module_action() — those bind auth.uid(), which
  // is null under service role).
  if (!(await isUserEligibleForBids(admin, current.user_id))) {
    return finish("Cancelled", { failure_code: "recipient_ineligible" });
  }

  const href = `/bids?view=${current.bid_id}`;
  const { title, body } = buildReminderContent(bid);

  // Final gate: abort a user/close-cancelled send; leave superseded rows
  // alone so recovery decisions are never overwritten.
  const preSend = await recheck();
  if (!preSend.ok) {
    if (preSend.cancelled) return finish("Cancelled", { failure_code: "cancelled_before_send" });
    return "skipped";
  }

  // Inbox row for the in-app bell (service role bypasses RLS safely here).
  // First attempt only: retries must not duplicate the bell entry.
  if (current.attempt_count === 1) {
    const { error: inboxError } = await admin.from("notification_inbox").insert({
      user_id: current.user_id,
      event_id: null,
      title,
      body,
      href,
    });
    if (inboxError) {
      console.error("[Bid reminders] inbox insert failed", inboxError.message);
    }
  }

  let accessToken: string | null = null;
  const getAccessToken = async () => {
    accessToken ??= await getGoogleAccessToken(serviceAccount);
    return accessToken;
  };

  // Android devices for THIS user only.
  const { data: devices, error: devicesError } = await admin
    .from("native_device_tokens")
    .select("id, fcm_token")
    .eq("user_id", current.user_id)
    .eq("active", true)
    .eq("platform", PLATFORM)
    .eq("app_id", APP_ID);
  if (devicesError) throw devicesError;

  let androidFailed = false;
  for (const device of (devices ?? []) as Array<{ id: string; fcm_token: string }>) {
    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json; charset=UTF-8" },
          body: JSON.stringify({
            message: {
              token: device.fcm_token,
              notification: { title, body },
              data: { href, reminderId: current.id },
              android: {
                priority: "high",
                notification: {
                  channel_id: "transjit_erp_alerts_v1",
                  sound: "transjit_koyal_notification",
                  default_vibrate_timings: true,
                },
              },
            },
          }),
        }
      );
      if (!response.ok) {
        if (await isUnregisteredFcmToken(response)) {
          await admin
            .from("native_device_tokens")
            .update({ active: false, disabled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", device.id)
            .eq("active", true);
        } else if (isRetryableProviderStatus(response.status)) {
          androidFailed = true;
        } else {
          console.error("[Bid reminders] Android send rejected", { status: response.status });
        }
      }
    } catch {
      androidFailed = true;
    }
  }

  // Browser push to THIS user's subscriptions only.
  const { data: subscriptions } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", current.user_id);
  for (const sub of (subscriptions ?? []) as Array<{ endpoint: string; p256dh: string; auth: string }>) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body, href })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Bid reminders] browser send failed", message.slice(0, 120));
      if (message.includes("410") || message.includes("404")) {
        await admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }

  // attempt_count was already incremented by the atomic claim, so
  // current.attempt_count < MAX means a retry remains.
  if (androidFailed && current.attempt_count < MAX_EXTERNAL_ATTEMPTS) {
    return finish("Scheduled", { failure_code: "android_send_failed" });
  }
  if (androidFailed) {
    // Exhausted: terminal Failed, never Sent. sent_at stays NULL and the
    // failure reason is preserved for diagnosis.
    return finish("Failed", { failure_code: "delivery_attempts_exhausted" });
  }
  return finish("Sent", { sent_at: new Date().toISOString(), failure_code: null });
}

async function isUserEligibleForBids(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data: users, error: usersError } = await admin
    .from("app_users")
    .select("id, role, full_access, approval_status, is_locked")
    .eq("id", userId)
    .limit(1);
  if (usersError) throw usersError;
  const user = (users ?? [])[0] as
    | { id: string; role: string | null; full_access: boolean | null; approval_status: string | null; is_locked: boolean | null }
    | undefined;
  if (!user) return false;
  if (user.role === "creator" || user.role === "admin" || user.full_access === true) return true;
  if (user.is_locked || user.approval_status !== "approved") return false;
  const { data: permissions, error: permissionsError } = await admin
    .from("app_user_permissions")
    .select("can_view, can_create, can_edit, permission_level")
    .eq("user_id", userId)
    .eq("permission_key", "bids")
    .limit(1);
  if (permissionsError) throw permissionsError;
  const permission = (permissions ?? [])[0] as
    | { can_view: boolean | null; can_create: boolean | null; can_edit: boolean | null; permission_level: string | null }
    | undefined;
  if (!permission) return false;
  if (permission.can_view === true || permission.can_create === true || permission.can_edit === true) return true;
  return ["view", "create_view", "edit"].includes(permission.permission_level ?? "none");
}

function buildReminderContent(bid: Record<string, unknown>): { title: string; body: string } {
  const billingParty = String(bid.billing_party_name ?? "").trim() || "Transport bid";
  const route = `${String(bid.pickup_location ?? "").trim()} → ${String(bid.dropoff_location ?? "").trim()}`;
  const closesAt = String(bid.closes_at ?? "");
  const closesLabel = closesAt ? formatClosesLine(closesAt) : "Closing time not set";
  const rate = Number(bid.bid_rate);
  const basis = String(bid.bid_rate_basis ?? "Per MT");
  const ourBid = Number.isFinite(rate)
    ? `Our Bid: ₹${rate.toLocaleString("en-IN", { maximumFractionDigits: 2 })} / ${basis === "Per MT" ? "MT" : "vehicle"}`
    : "Our Bid: —";
  const lines = [billingParty, route, closesLabel, ourBid].filter(Boolean);
  return { title: "Transport Bid Reminder", body: lines.join("\n").slice(0, 4000) };
}

function formatClosesLine(closesAt: string): string {
  const closes = new Date(closesAt);
  if (Number.isNaN(closes.getTime())) return "Bid closing soon";
  const now = new Date();
  const dayLabel =
    closes.toDateString() === now.toDateString()
      ? "today"
      : new Date(closes.getTime() - 86400000).toDateString() === now.toDateString()
        ? "tomorrow"
        : closes.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const time = closes.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return `Bid closes ${dayLabel} at ${time}`;
}

function getServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (
      typeof parsed.project_id !== "string" ||
      typeof parsed.client_email !== "string" ||
      typeof parsed.private_key !== "string"
    ) {
      return null;
    }
    return { project_id: parsed.project_id, client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

async function getGoogleAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const key = await importPKCS8(serviceAccount.private_key, "RS256");
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(serviceAccount.client_email)
    .setSubject(serviceAccount.client_email)
    .setAudience(OAUTH_TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime("55m")
    .sign(key);
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error("OAuth token request failed");
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("OAuth token response was invalid");
  }
  return payload.access_token;
}

async function isUnregisteredFcmToken(response: Response): Promise<boolean> {
  if (response.status !== 404) return false;
  const payload = (await response.json().catch(() => null)) as { error?: { details?: Array<{ errorCode?: unknown }> } } | null;
  return payload?.error?.details?.some((detail) => detail.errorCode === "UNREGISTERED") === true;
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function hasValidSecretApiKey(req: Request): boolean {
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  if (!apiKey || apiKey.startsWith("sb_publishable_")) return false;
  return configuredSecretApiKeys().some((key) => constantTimeEqual(apiKey, key));
}

function configuredSecretApiKeys(): string[] {
  const keys: string[] = [];
  const multiple = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (multiple) {
    try {
      for (const value of Object.values(JSON.parse(multiple) as Record<string, unknown>)) {
        if (typeof value === "string" && value.length > 0) keys.push(value);
      }
    } catch {
      // Invalid server configuration leaves no valid key.
    }
  }
  const single = Deno.env.get("SUPABASE_SECRET_KEY");
  if (single) keys.push(single);
  return keys;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
