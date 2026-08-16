// Supabase Edge Function: process-notifications
// Deploy: supabase functions deploy process-notifications
//         (uses supabase/config.toml → verify_jwt = false)
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
//          SUPABASE_URL, SERVICE_ROLE_KEY (DB admin client; kept temporarily),
//          SUPABASE_SECRET_KEYS (platform-injected; Cron auth)
//
// Authorization:
//   scheduled / cron  → apikey header must match a project Secret API key
//                       (SUPABASE_SECRET_KEYS). User JWTs / publishable / anon
//                       are rejected.
//   immediate         → authenticated user JWT for their own eventId,
//                       OR legacy SERVICE_ROLE_KEY Bearer (server path)
//
// Modes:
//   { mode: "immediate", eventId: number }
//   { mode: "scheduled" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SUPABASE_PROJECT_URL") ?? "";
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

    if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate) {
      return json({ error: "Missing Edge Function secrets" }, 500);
    }

    const bearer = bearerToken(req);
    // Legacy server path for immediate mode only (not used for Cron auth).
    const isLegacyServiceBearer = Boolean(bearer && bearer === serviceKey);
    const isSecretApiKey = hasValidSecretApiKey(req);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode = body.mode === "immediate" ? "immediate" : "scheduled";

    // Scheduled/bulk processing: Secret API Key on `apikey` only.
    if (mode === "scheduled") {
      if (!isSecretApiKey) {
        return json(
          {
            error:
              "Forbidden: scheduled processing requires a valid Secret API Key in the apikey header",
          },
          403
        );
      }
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const admin = createClient(supabaseUrl, serviceKey);

    let events: Array<Record<string, unknown>> = [];

    if (mode === "immediate") {
      const eventId = Number(body.eventId);
      if (!eventId) {
        return json({ error: "eventId is required for immediate mode" }, 400);
      }

      const { data: event } = await admin
        .from("notification_events")
        .select("*")
        .eq("id", eventId)
        .eq("status", "pending")
        .maybeSingle();

      if (!event) {
        return json({ ok: true, processed: 0, reason: "event_not_pending" });
      }

      if (!isLegacyServiceBearer && !isSecretApiKey) {
        // Authenticated ERP user may only process their own enqueued event.
        if (!bearer) {
          return json({ error: "Unauthorized" }, 401);
        }
        const { data: userData, error: userError } = await admin.auth.getUser(bearer);
        if (userError || !userData.user) {
          return json({ error: "Unauthorized" }, 401);
        }
        if (event.created_by && event.created_by !== userData.user.id) {
          return json({ error: "Forbidden: cannot process another user's event" }, 403);
        }
      }

      events = [event];
    } else {
      const now = new Date().toISOString();
      const { data } = await admin
        .from("notification_events")
        .select("*")
        .eq("status", "pending")
        .lte("deliver_after", now)
        .order("created_at", { ascending: true })
        .limit(200);
      events = data ?? [];
    }

    if (events.length === 0) {
      return json({ ok: true, processed: 0 });
    }

    const { data: subs } = await admin.from("push_subscriptions").select("*");
    const subscriptions = subs ?? [];

    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const event of events) {
      const key = String(event.rule_key);
      const list = groups.get(key) ?? [];
      list.push(event);
      groups.set(key, list);
    }

    let processed = 0;
    let failed = 0;

    for (const [ruleKey, group] of groups) {
      const ids = group.map((e) => Number(e.id));
      await admin.from("notification_events").update({ status: "processing" }).in("id", ids);

      let title = String(group[0].title);
      let bodyText = String(group[0].body ?? "");
      let href = String(group[0].href ?? "/");

      if (group.length > 1) {
        title = summarizeTitle(ruleKey, group.length);
        bodyText = group
          .slice(0, 5)
          .map((e) => String(e.title))
          .join(" · ");
        if (group.length > 5) bodyText += ` · +${group.length - 5} more`;
      }

      const userIds = Array.from(new Set(subscriptions.map((s) => s.user_id as string)));
      if (userIds.length > 0) {
        const inboxRows = userIds.map((userId) => ({
          user_id: userId,
          event_id: ids[0],
          title,
          body: bodyText,
          href,
        }));
        await admin.from("notification_inbox").insert(inboxRows);
      }

      const payload = JSON.stringify({ title, body: bodyText, href });
      let successCount = 0;
      let attemptCount = 0;
      const errors: string[] = [];

      for (const sub of subscriptions) {
        attemptCount += 1;
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload
          );
          successCount += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(message);
          if (message.includes("410") || message.includes("404")) {
            await admin.from("push_subscriptions").delete().eq("id", sub.id);
          }
          console.error("push failed", message);
        }
      }

      // No subscribers / all pushes failed → do NOT mark as sent.
      if (attemptCount === 0 || successCount === 0) {
        await admin
          .from("notification_events")
          .update({
            status: "failed",
            processed_at: new Date().toISOString(),
            error_message:
              attemptCount === 0
                ? "No push subscriptions available"
                : `All ${attemptCount} push attempt(s) failed: ${errors.slice(0, 3).join("; ")}`,
          })
          .in("id", ids);
        failed += group.length;
        continue;
      }

      await admin
        .from("notification_events")
        .update({
          status: "sent",
          processed_at: new Date().toISOString(),
          error_message: null,
        })
        .in("id", ids);

      processed += group.length;
    }

    return json({ ok: true, processed, failed });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function bearerToken(req: Request): string {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

/**
 * Cron / service-to-service auth: `apikey` must equal one of the project's
 * Secret API keys from the platform-injected SUPABASE_SECRET_KEYS map
 * (or local SUPABASE_SECRET_KEY). Publishable/anon keys are never accepted.
 */
function hasValidSecretApiKey(req: Request): boolean {
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  if (!apiKey) return false;
  if (isPublishableOrAnonKey(apiKey)) return false;

  const configured = getConfiguredSecretApiKeys();
  if (configured.length === 0) return false;
  return configured.includes(apiKey);
}

function getConfiguredSecretApiKeys(): string[] {
  const keys: string[] = [];

  const multi = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (multi) {
    try {
      const parsed = JSON.parse(multi) as Record<string, unknown>;
      for (const value of Object.values(parsed)) {
        if (typeof value === "string" && value.length > 0) keys.push(value);
      }
    } catch {
      // ignore malformed platform payload
    }
  }

  const single = Deno.env.get("SUPABASE_SECRET_KEY");
  if (single) keys.push(single);

  return keys;
}

function isPublishableOrAnonKey(apiKey: string): boolean {
  if (apiKey.startsWith("sb_publishable_")) return true;

  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (anon && apiKey === anon) return true;

  const pubSingle = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  if (pubSingle && apiKey === pubSingle) return true;

  const pubMulti = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (pubMulti) {
    try {
      const parsed = JSON.parse(pubMulti) as Record<string, unknown>;
      for (const value of Object.values(parsed)) {
        if (typeof value === "string" && value === apiKey) return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

function summarizeTitle(ruleKey: string, count: number): string {
  if (ruleKey.startsWith("lr.")) return `${count} LR updates overnight`;
  if (ruleKey.startsWith("dc.")) return `${count} Delivery Challan updates`;
  if (ruleKey.startsWith("pod.")) return `${count} POD updates`;
  if (ruleKey.startsWith("financials.")) return `${count} Financials updates`;
  return `${count} notifications`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
