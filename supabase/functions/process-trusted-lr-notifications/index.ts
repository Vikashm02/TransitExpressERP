// Permanent dispatcher for exactly one trusted lr.updated event.
// It is separate from browser process-notifications and the Phase 2B sender.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { importPKCS8, SignJWT } from "npm:jose@5.10.0";
import webpush from "npm:web-push@3.6.7";
import { resolveEligibleNotificationRecipients } from "../_shared/notificationRecipients.ts";

const APP_ID = "in.transjitexpresserp.app";
const PLATFORM = "android";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENT_SOURCE = "trusted_lr_trigger";
const MAX_EXTERNAL_ATTEMPTS = 3;
const STALE_CLAIM_MS = 10 * 60 * 1000;

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
type TrustedEvent = {
  id: number;
  rule_key: string;
  source: string;
  title: string;
  body: string;
  href: string;
  payload: unknown;
  status: string;
  deliver_after: string;
  dispatch_claimed_at: string | null;
};
type BrowserSubscription = { id: number; user_id: string; endpoint: string; p256dh: string; auth: string };
type NativeDevice = { id: string; user_id: string; fcm_token: string };
type Delivery = {
  id: number;
  event_id: number;
  user_id: string;
  channel: "inbox" | "browser" | "android";
  target_key: string;
  status: "pending" | "sending" | "sent" | "failed" | "unknown" | "permanent_failed";
  attempt_count: number;
  last_attempt_at: string | null;
};

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ ok: false, code: "method_not_allowed", message: "POST is required." }, 405);
    if (!hasValidSecretApiKey(req)) return json({ ok: false, code: "forbidden", message: "Forbidden." }, 403);

    const body = await req.json().catch(() => null);
    if (!isDispatchRequest(body)) {
      return json({ ok: false, code: "invalid_request", message: "A positive safe-integer eventId or scheduled mode is required." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SUPABASE_PROJECT_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const serviceAccount = getServiceAccount();
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
    if (!supabaseUrl || !serviceRoleKey || !serviceAccount || !vapidPublic || !vapidPrivate) {
      console.error("[Trusted LR notifications] required server configuration is missing");
      return json({ ok: false, code: "server_misconfigured", message: "Server configuration is incomplete." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const eventId = "eventId" in body ? body.eventId : await findNextScheduledTrustedEventId(admin);
    if (eventId === null) return json({ ok: true, dispatched: false, reason: "no_due_event" });

    const claim = await claimTrustedEvent(admin, eventId);
    if (!claim.event) return json({ ok: true, dispatched: false, reason: claim.reason });
    const event = claim.event;
    if (!isSafeTrustedLrHref(event)) {
      await updateEventSummary(admin, event.id, "cancelled", "Trusted LR notification has an invalid route.");
      return json({ ok: true, dispatched: false, reason: "invalid_event_route" });
    }

    const recipientIds = await resolveEligibleNotificationRecipients(admin, "lr");
    if (recipientIds.length === 0) {
      await updateEventSummary(admin, event.id, "cancelled", "No eligible LR notification recipients.");
      return json({ ok: true, dispatched: true, recipients: 0, delivered: 0, failed: 0 });
    }

    // Any abandoned external request has an unknowable outcome. Never resend it.
    // Inbox is local and can instead be reconciled against its unique database row.
    await reconcileStaleDeliveries(admin, event.id);

    let delivered = 0;
    let failed = 0;
    for (const userId of recipientIds) {
      const result = await deliverInbox(admin, event, userId);
      delivered += result.delivered;
      failed += result.failed;
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const { data: rawSubscriptions, error: subscriptionsError } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", recipientIds);
    if (subscriptionsError) throw subscriptionsError;
    const subscriptions = (rawSubscriptions ?? []) as BrowserSubscription[];
    await markMissingTargetsPermanent(admin, event.id, "browser", new Set(subscriptions.map((item) => `subscription:${item.id}`)));
    for (const subscription of subscriptions) {
      const result = await deliverBrowser(admin, event, subscription);
      delivered += result.delivered;
      failed += result.failed;
    }

    const { data: rawDevices, error: devicesError } = await admin
      .from("native_device_tokens")
      .select("id, user_id, fcm_token")
      .in("user_id", recipientIds)
      .eq("active", true)
      .eq("platform", PLATFORM)
      .eq("app_id", APP_ID);
    if (devicesError) throw devicesError;
    const devices = (rawDevices ?? []) as NativeDevice[];
    await markMissingTargetsPermanent(admin, event.id, "android", new Set(devices.map((item) => `device:${item.id}`)));

    let accessToken: string | null = null;
    for (const device of devices) {
      const result = await deliverAndroid(admin, event, device, serviceAccount.project_id, async () => {
        accessToken ??= await getGoogleAccessToken(serviceAccount);
        return accessToken;
      });
      delivered += result.delivered;
      failed += result.failed;
    }

    const finalStatus = await summarizeEventFromLedger(admin, event.id);
    return json({ ok: true, dispatched: true, recipients: recipientIds.length, delivered, failed, status: finalStatus });
  } catch (error) {
    console.error("[Trusted LR notifications] dispatcher failed", { code: supabaseErrorCode(error) });
    return json({ ok: false, code: "dispatch_failed", message: "Unable to dispatch the notification event." }, 500);
  }
});

type DispatchRequest = { eventId: number } | { mode: "scheduled" };

function isDispatchRequest(value: unknown): value is DispatchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length !== 1) return false;
  const [key, entry] = entries[0];
  if (key === "eventId") return typeof entry === "number" && Number.isSafeInteger(entry) && entry > 0;
  return key === "mode" && entry === "scheduled";
}

type EventClaim = {
  event: TrustedEvent | null;
  reason: "claimed" | "event_not_claimable" | "terminal_failed_no_action";
};

async function findNextScheduledTrustedEventId(admin: SupabaseClient): Promise<number | null> {
  const now = new Date().toISOString();
  const baseQuery = () => admin
    .from("notification_events")
    .select("id")
    .in("rule_key", ["lr.updated", "lr.created"])
    .eq("source", EVENT_SOURCE)
    .lte("deliver_after", now);

  const { data: pending, error: pendingError } = await baseQuery()
    .eq("status", "pending")
    .order("deliver_after", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pendingError) throw pendingError;
  const pendingId = toSafeEventId(pending?.id);
  if (pendingId !== null) return pendingId;

  // A failed event is due only when the existing delivery state machine says
  // there is safe work to retry or reconcile. Terminal failed events remain
  // untouched, so scheduled invocations cannot create a processing loop.
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data: failed, error: failedError } = await baseQuery()
      .eq("status", "failed")
      .order("deliver_after", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (failedError) throw failedError;
    for (const row of failed ?? []) {
      const eventId = toSafeEventId(row.id);
      if (eventId !== null && await hasActionableFailedWork(admin, eventId)) return eventId;
    }
    if ((failed ?? []).length < pageSize) break;
  }

  const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: stale, error: staleError } = await baseQuery()
    .eq("status", "processing")
    .lt("dispatch_claimed_at", staleCutoff)
    .order("dispatch_claimed_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (staleError) throw staleError;
  return toSafeEventId(stale?.id);
}

function toSafeEventId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function claimTrustedEvent(admin: SupabaseClient, eventId: number): Promise<EventClaim> {
  const fields = "id, rule_key, source, title, body, href, payload, status, deliver_after, dispatch_claimed_at";
  const claim = async (status: "pending" | "failed" | "processing", staleOnly = false) => {
    let query = admin
      .from("notification_events")
      .update({ status: "processing", dispatch_claimed_at: new Date().toISOString(), processed_at: null })
      .eq("id", eventId)
      .in("rule_key", ["lr.updated", "lr.created"])
      .eq("source", EVENT_SOURCE)
      .eq("status", status)
      .select(fields)
      .maybeSingle();
    if (status === "pending") query = query.lte("deliver_after", new Date().toISOString());
    if (staleOnly) query = query.lt("dispatch_claimed_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString());
    const { data, error } = await query;
    if (error) throw error;
    return data as TrustedEvent | null;
  };

  const pending = await claim("pending");
  if (pending) return { event: pending, reason: "claimed" };

  // A failed parent is reopened only when its ledger contains work that is
  // known to be safe to retry or reconcile. Unknown/permanent/exhausted
  // external outcomes remain terminal and never cause a processing loop.
  const trustedFailed = await loadTrustedEventStatus(admin, eventId, "failed");
  if (trustedFailed) {
    if (!await hasActionableFailedWork(admin, eventId)) {
      return { event: null, reason: "terminal_failed_no_action" };
    }
    const failed = await claim("failed");
    if (failed) return { event: failed, reason: "claimed" };
  }

  const stale = await claim("processing", true);
  if (stale) return { event: stale, reason: "claimed" };
  return { event: null, reason: "event_not_claimable" };
}

async function loadTrustedEventStatus(
  admin: SupabaseClient,
  eventId: number,
  status: "failed"
): Promise<boolean> {
  const { data, error } = await admin
    .from("notification_events")
    .select("id")
    .eq("id", eventId)
    .in("rule_key", ["lr.updated", "lr.created"])
    .eq("source", EVENT_SOURCE)
    .eq("status", status)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function hasActionableFailedWork(admin: SupabaseClient, eventId: number): Promise<boolean> {
  const { data, error } = await admin
    .from("notification_deliveries")
    .select("channel, status, attempt_count, last_attempt_at")
    .eq("event_id", eventId);
  if (error) throw error;

  const staleCutoff = Date.now() - STALE_CLAIM_MS;
  return (data ?? []).some((row) => {
    const channel = String(row.channel);
    const status = String(row.status);
    const attempts = Number(row.attempt_count);
    if ((channel === "browser" || channel === "android") && status === "failed" && attempts < MAX_EXTERNAL_ATTEMPTS) {
      return true;
    }
    if (channel !== "inbox") return false;
    if (status === "pending" || status === "failed") return true;
    if (status !== "sending" || typeof row.last_attempt_at !== "string") return false;
    return Date.parse(row.last_attempt_at) < staleCutoff;
  });
}

async function ensureDelivery(
  admin: SupabaseClient,
  eventId: number,
  userId: string,
  channel: Delivery["channel"],
  targetKey: string
): Promise<Delivery> {
  const { data, error } = await admin
    .from("notification_deliveries")
    .insert({ event_id: eventId, user_id: userId, channel, target_key: targetKey })
    .select("id, event_id, user_id, channel, target_key, status, attempt_count, last_attempt_at")
    .maybeSingle();
  if (!error && data) return data as Delivery;
  if (error?.code !== "23505") throw error;
  const { data: existing, error: existingError } = await admin
    .from("notification_deliveries")
    .select("id, event_id, user_id, channel, target_key, status, attempt_count, last_attempt_at")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("channel", channel)
    .eq("target_key", targetKey)
    .single();
  if (existingError) throw existingError;
  return existing as Delivery;
}

async function claimExternalDelivery(admin: SupabaseClient, delivery: Delivery): Promise<Delivery | null> {
  if (delivery.status !== "pending" && delivery.status !== "failed") return null;
  if (delivery.attempt_count >= MAX_EXTERNAL_ATTEMPTS) return null;
  const { data, error } = await admin
    .from("notification_deliveries")
    .update({
      status: "sending",
      attempt_count: delivery.attempt_count + 1,
      attempted_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      failure_code: null,
    })
    .eq("id", delivery.id)
    .eq("status", delivery.status)
    .eq("attempt_count", delivery.attempt_count)
    .select("id, event_id, user_id, channel, target_key, status, attempt_count, last_attempt_at")
    .maybeSingle();
  if (error) throw error;
  return data as Delivery | null;
}

async function deliverInbox(admin: SupabaseClient, event: TrustedEvent, userId: string): Promise<{ delivered: number; failed: number }> {
  const delivery = await ensureDelivery(admin, event.id, userId, "inbox", "inbox");
  const { data: existing, error: existingError } = await admin
    .from("notification_inbox")
    .select("id")
    .eq("event_id", event.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    await markDelivery(admin, delivery.id, "sent", null);
    return { delivered: 0, failed: 0 };
  }
  if (delivery.status === "sent" || delivery.status === "unknown" || delivery.status === "permanent_failed") return { delivered: 0, failed: 0 };

  const { data: claimed, error: claimError } = await admin
    .from("notification_deliveries")
    .update({ status: "sending", attempted_at: new Date().toISOString(), last_attempt_at: new Date().toISOString() })
    .eq("id", delivery.id)
    .in("status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { delivered: 0, failed: 0 };

  const { error: insertError } = await admin.from("notification_inbox").insert({
    user_id: userId,
    event_id: event.id,
    title: event.title,
    body: event.body ?? "",
    href: event.href,
  });
  if (insertError && insertError.code !== "23505") {
    await markDelivery(admin, delivery.id, "failed", "inbox_insert_failed");
    return { delivered: 0, failed: 1 };
  }
  await markDelivery(admin, delivery.id, "sent", null);
  return { delivered: 1, failed: 0 };
}

async function deliverBrowser(admin: SupabaseClient, event: TrustedEvent, subscription: BrowserSubscription): Promise<{ delivered: number; failed: number }> {
  const delivery = await ensureDelivery(admin, event.id, subscription.user_id, "browser", `subscription:${subscription.id}`);
  const claimed = await claimExternalDelivery(admin, delivery);
  if (!claimed) return { delivered: 0, failed: 0 };

  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify({ title: event.title, body: event.body ?? "", href: event.href })
    );
    await markDelivery(admin, claimed.id, "sent", null);
    return { delivered: 1, failed: 0 };
  } catch (error) {
    const status = pushStatus(error);
    if (status === 404 || status === 410) {
      await admin.from("push_subscriptions").delete().eq("id", subscription.id);
      await markDelivery(admin, claimed.id, "permanent_failed", "browser_subscription_expired");
    } else if (isRetryableProviderStatus(status)) {
      // A retryable provider response proves no successful send was accepted.
      await markDelivery(admin, claimed.id, "failed", "browser_send_failed");
    } else if (status > 0) {
      await markDelivery(admin, claimed.id, "permanent_failed", "browser_send_rejected");
    } else {
      // A transport interruption may have reached the provider. Never resend automatically.
      await markDelivery(admin, claimed.id, "unknown", "browser_send_outcome_unknown");
    }
    console.error("[Trusted LR notifications] browser send failed", { status: status || null });
    return { delivered: 0, failed: 1 };
  }
}

async function deliverAndroid(
  admin: SupabaseClient,
  event: TrustedEvent,
  device: NativeDevice,
  firebaseProjectId: string,
  getAccessToken: () => Promise<string>
): Promise<{ delivered: number; failed: number }> {
  const delivery = await ensureDelivery(admin, event.id, device.user_id, "android", `device:${device.id}`);
  const claimed = await claimExternalDelivery(admin, delivery);
  if (!claimed) return { delivered: 0, failed: 0 };

  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(firebaseProjectId)}/messages:send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          message: {
            token: device.fcm_token,
            notification: { title: event.title, body: event.body ?? "" },
            data: buildSafeEventData(event),
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

    if (response.ok) {
      await markDelivery(admin, claimed.id, "sent", null);
      return { delivered: 1, failed: 0 };
    }
    if (await isUnregisteredFcmToken(response)) {
      await admin
        .from("native_device_tokens")
        .update({ active: false, disabled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", device.id)
        .eq("active", true);
      await markDelivery(admin, claimed.id, "permanent_failed", "android_token_unregistered");
    } else if (isRetryableProviderStatus(response.status)) {
      await markDelivery(admin, claimed.id, "failed", "android_send_failed");
    } else {
      // A non-retryable FCM rejection does not deactivate the device unless it
      // was specifically confirmed as UNREGISTERED above.
      await markDelivery(admin, claimed.id, "permanent_failed", "android_send_rejected");
    }
    console.error("[Trusted LR notifications] Android send failed", { status: response.status });
    return { delivered: 0, failed: 1 };
  } catch {
    // Fetch/OAuth interruption can occur after a remote send; record unknown, never resend automatically.
    await markDelivery(admin, claimed.id, "unknown", "android_send_outcome_unknown");
    console.error("[Trusted LR notifications] Android send outcome unknown");
    return { delivered: 0, failed: 1 };
  }
}

async function reconcileStaleDeliveries(admin: SupabaseClient, eventId: number): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data: staleInbox, error: inboxError } = await admin
    .from("notification_deliveries")
    .select("id, event_id, user_id")
    .eq("event_id", eventId)
    .eq("channel", "inbox")
    .eq("status", "sending")
    .lt("last_attempt_at", cutoff);
  if (inboxError) throw inboxError;
  for (const row of staleInbox ?? []) {
    const { data: inbox, error } = await admin
      .from("notification_inbox")
      .select("id")
      .eq("event_id", row.event_id)
      .eq("user_id", row.user_id)
      .maybeSingle();
    if (error) throw error;
    await markDelivery(admin, Number(row.id), inbox ? "sent" : "pending", inbox ? null : "inbox_claim_recovered");
  }
  const { error: externalError } = await admin
    .from("notification_deliveries")
    .update({ status: "unknown", failure_code: "external_send_outcome_unknown" })
    .eq("event_id", eventId)
    .in("channel", ["browser", "android"])
    .eq("status", "sending")
    .lt("last_attempt_at", cutoff);
  if (externalError) throw externalError;
}

async function markMissingTargetsPermanent(
  admin: SupabaseClient,
  eventId: number,
  channel: "browser" | "android",
  currentTargetKeys: Set<string>
): Promise<void> {
  const { data, error } = await admin
    .from("notification_deliveries")
    .select("id, target_key, status")
    .eq("event_id", eventId)
    .eq("channel", channel)
    .in("status", ["pending", "failed"]);
  if (error) throw error;
  for (const row of data ?? []) {
    if (currentTargetKeys.has(String(row.target_key))) continue;
    // This is a terminal state change from pending/failed, not a completion
    // of a sending request. Match the observed state to avoid overwriting a
    // concurrent claim or any sent/unknown/permanent terminal record.
    const { error: transitionError } = await admin
      .from("notification_deliveries")
      .update({ status: "permanent_failed", failure_code: `${channel}_target_missing` })
      .eq("id", Number(row.id))
      .in("status", ["pending", "failed"]);
    if (transitionError) throw transitionError;
  }
}

async function markDelivery(
  admin: SupabaseClient,
  deliveryId: number,
  status: Delivery["status"],
  failureCode: string | null
): Promise<void> {
  const { error } = await admin
    .from("notification_deliveries")
    .update({
      status,
      failure_code: failureCode,
      delivered_at: status === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", deliveryId)
    .eq("status", "sending");
  if (error) throw error;
}

async function summarizeEventFromLedger(admin: SupabaseClient, eventId: number): Promise<string> {
  const { data, error } = await admin
    .from("notification_deliveries")
    .select("status, attempt_count")
    .eq("event_id", eventId);
  if (error) throw error;
  const deliveries = (data ?? []) as Array<Pick<Delivery, "status" | "attempt_count">>;
  const hasActionable = deliveries.some((row) => row.status === "pending" || row.status === "sending");
  const hasRetryableFailure = deliveries.some((row) => row.status === "failed" && row.attempt_count < MAX_EXTERNAL_ATTEMPTS);
  const hasFailure = deliveries.some((row) => row.status === "failed" || row.status === "unknown" || row.status === "permanent_failed");
  const status = hasActionable ? "processing" : hasRetryableFailure || hasFailure ? "failed" : "sent";
  const message = hasActionable
    ? "Delivery work remains in progress."
    : hasRetryableFailure
      ? "One or more target deliveries can be retried."
      : hasFailure
        ? "One or more target deliveries require review."
        : null;
  await updateEventSummary(admin, eventId, status, message);
  return status;
}

async function updateEventSummary(admin: SupabaseClient, eventId: number, status: string, errorMessage: string | null): Promise<void> {
  const { error } = await admin
    .from("notification_events")
    .update({ status, error_message: errorMessage, processed_at: status === "processing" ? null : new Date().toISOString() })
    .eq("id", eventId)
    .eq("status", "processing");
  if (error) throw error;
}

function buildSafeEventData(event: TrustedEvent): Record<string, string> {
  const data: Record<string, string> = { href: event.href, eventId: String(event.id) };
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return data;
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.lrId === "number" && Number.isSafeInteger(payload.lrId) && payload.lrId > 0) data.lrId = String(payload.lrId);
  if (typeof payload.lrNumber === "string" && /^[A-Za-z0-9./_-]{1,100}$/.test(payload.lrNumber)) data.lrNumber = payload.lrNumber;
  return data;
}

function isSafeTrustedLrHref(event: TrustedEvent): boolean {
  if (event.rule_key === "lr.updated") {
    return event.href === "/lr" || /^\/lr\?view=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}&focus=(lr|party|vehicle|material|dispatch|remarks)$/i.test(event.href);
  }
  return event.rule_key === "lr.created" && /^\/lr\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/print$/i.test(event.href);
}

function getServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof parsed.project_id !== "string" || typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
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
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) throw new Error("OAuth token response was invalid");
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

function pushStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode) || 0
    : 0;
}

function supabaseErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
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
