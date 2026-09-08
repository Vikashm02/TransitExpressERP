// Supabase Edge Function: notification-center
// Deploy: supabase functions deploy notification-center
// Secrets: SUPABASE_URL, SERVICE_ROLE_KEY, RESEND_API_KEY, REPORT_EMAIL_FROM,
//          VAPID_* (for test push via process-notifications reuse path),
//          SUPABASE_SECRET_KEYS (cron auth)
//
// Actions (admin JWT unless noted):
//   test_in_app | test_push | test_email
//   preview_transport_report | send_transport_report
//   run_monthly_transport_report  (cron: Secret API key on apikey)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SummaryJson = {
  period_from: string;
  period_to_exclusive: string;
  total_lrs: number;
  total_loading_weight: number;
  unique_vehicles: number;
  top_consignees: Array<{
    consignee: string;
    loading_weight: number;
    lr_count: number;
  }>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SUPABASE_PROJECT_URL") ?? "";
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Missing Edge Function secrets" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body.action ?? "");

    const bearer = bearerToken(req);
    const isSecretApiKey = hasValidSecretApiKey(req);

    // Cron path — previous completed month, idempotent.
    if (action === "run_monthly_transport_report") {
      if (!isSecretApiKey) {
        return json({ error: "Forbidden: monthly cron requires Secret API Key on apikey" }, 403);
      }
      return await runMonthlyTransportReport(admin);
    }

    // Admin JWT required for all other actions.
    if (!bearer) return json({ error: "Unauthorized" }, 401);
    const { data: userData, error: userError } = await admin.auth.getUser(bearer);
    if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await admin
      .from("app_users")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();

    const role = String(profile?.role ?? "");
    if (role !== "creator" && role !== "admin") {
      return json({ error: "Forbidden: admin only" }, 403);
    }

    const uid = userData.user.id;

    if (action === "test_in_app") {
      const title = String(body.title ?? "Test in-app notification").slice(0, 200);
      const message = String(body.message ?? "This is a test in-app notification from Settings.").slice(0, 2000);
      const { error } = await admin.from("notification_inbox").insert({
        user_id: uid,
        event_id: null,
        title,
        body: message,
        href: "/settings",
      });
      if (error) {
        // event_id may be NOT NULL — fall back via notification_events
        const { data: ev, error: evErr } = await admin
          .from("notification_events")
          .insert({
            rule_key: "admin.test",
            title,
            body: message,
            href: "/settings",
            status: "sent",
            deliver_after: new Date().toISOString(),
            payload: { channel: "in_app_test" },
            created_by: uid,
            processed_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (evErr) return json({ ok: false, channel: "in_app", status: "failed", error: safeErr(evErr) }, 500);
        const { error: inboxErr } = await admin.from("notification_inbox").insert({
          user_id: uid,
          event_id: ev.id,
          title,
          body: message,
          href: "/settings",
        });
        if (inboxErr) return json({ ok: false, channel: "in_app", status: "failed", error: safeErr(inboxErr) }, 500);
      }
      return json({ ok: true, channel: "in_app", status: "delivered", recipient: "self" });
    }

    if (action === "test_push") {
      const title = String(body.title ?? "Test push notification").slice(0, 200);
      const message = String(body.message ?? "This is a test push from Transjit Settings.").slice(0, 2000);

      const { data: ev, error: evErr } = await admin
        .from("notification_events")
        .insert({
          rule_key: "admin.test",
          title,
          body: message,
          href: "/settings",
          status: "pending",
          deliver_after: new Date().toISOString(),
          payload: { channel: "push_test" },
          created_by: uid,
        })
        .select("id")
        .single();
      if (evErr || !ev) {
        return json({ ok: false, channel: "push", status: "failed", error: "Unable to enqueue test event" }, 500);
      }

      const pushResult = await deliverPushForEvent(admin, ev.id, title, message, "/settings");
      return json({
        ok: pushResult.status === "sent",
        channel: "push",
        status: pushResult.status,
        attempted: pushResult.attempted,
        succeeded: pushResult.succeeded,
        error: pushResult.error ?? null,
      });
    }

    if (action === "test_email") {
      const settings = await loadReportSettings(admin);
      const recipients = settings.report_email_to;
      if (recipients.length === 0) {
        return json({
          ok: false,
          channel: "email",
          status: "failed",
          error: "Configure Report Email recipients in Settings first.",
        }, 400);
      }
      const recipientAudit = formatRecipientAudit(recipients);
      const title = String(body.title ?? "Transjit test email").slice(0, 200);
      const message = String(
        body.message ?? "This is a test email from Transjit Notification Center.",
      ).slice(0, 4000);
      const send = await sendResendEmail({
        to: recipients,
        subject: title,
        text: message,
      });
      return json({
        ok: send.ok,
        channel: "email",
        status: send.ok ? "sent" : "failed",
        recipient: recipientAudit,
        error: send.error ?? null,
      });
    }

    if (action === "preview_transport_report" || action === "send_transport_report") {
      const year = Number(body.year);
      const month = Number(body.month);
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return json({ error: "year and month are required" }, 400);
      }
      const { from, toExclusive, periodKey, periodLabel } = monthBounds(year, month);
      const summary = await fetchSummary(admin, from, toExclusive);
      if (!summary) return json({ error: "Unable to generate summary" }, 500);

      if (action === "preview_transport_report") {
        return json({ ok: true, periodKey, periodLabel, summary, emailText: formatEmail(summary, periodLabel) });
      }

      // Manual admin send uses channel email_manual so retests are allowed.
      // Automated monthly cron uses channel email (idempotent when sent).
      const channel = body.force === false ? "email" : "email_manual";
      return await sendTransportReportEmail(admin, {
        summary,
        periodKey,
        periodLabel,
        from,
        toExclusive,
        channel,
        createdBy: uid,
        allowOverwriteFailed: true,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "Notification center request failed" }, 500);
  }
});

async function runMonthlyTransportReport(admin: ReturnType<typeof createClient>) {
  const settings = await loadReportSettings(admin);
  if (!settings.monthly_transport_enabled) {
    return json({ ok: true, skipped: true, reason: "monthly_transport_enabled is false" });
  }

  const todayIst = istTodayYmd();
  const day = Number(todayIst.slice(8, 10));
  if (day !== settings.monthly_day) {
    return json({ ok: true, skipped: true, reason: `not monthly_day (${settings.monthly_day})` });
  }

  const { year, month } = previousMonth(todayIst);
  const { from, toExclusive, periodKey, periodLabel } = monthBounds(year, month);
  const summary = await fetchSummary(admin, from, toExclusive);
  if (!summary) return json({ error: "Unable to generate summary" }, 500);

  return await sendTransportReportEmail(admin, {
    summary,
    periodKey,
    periodLabel,
    from,
    toExclusive,
    channel: "email",
    createdBy: null,
    allowOverwriteFailed: true,
  });
}

async function sendTransportReportEmail(
  admin: ReturnType<typeof createClient>,
  input: {
    summary: SummaryJson;
    periodKey: string;
    periodLabel: string;
    from: string;
    toExclusive: string;
    channel: string;
    createdBy: string | null;
    allowOverwriteFailed: boolean;
  },
) {
  const settings = await loadReportSettings(admin);
  const recipients = settings.report_email_to;
  if (recipients.length === 0) {
    return json({
      ok: false,
      status: "failed",
      error: "Configure Report Email recipients in Settings first.",
    }, 400);
  }
  const recipientAudit = formatRecipientAudit(recipients);

  // Automated channel 'email': skip if a successful send already exists for the period.
  if (input.channel === "email") {
    const { data: existingSent } = await admin
      .from("report_deliveries")
      .select("id, status")
      .eq("report_type", "transport_monthly_summary")
      .eq("period_key", input.periodKey)
      .eq("channel", "email")
      .eq("status", "sent")
      .maybeSingle();

    if (existingSent) {
      return json({
        ok: true,
        status: "skipped",
        reason: "already_sent",
        periodKey: input.periodKey,
        recipient: recipientAudit,
      });
    }
  }

  const snapshot = {
    total_lrs: input.summary.total_lrs,
    total_loading_weight: input.summary.total_loading_weight,
    unique_vehicles: input.summary.unique_vehicles,
    top_consignee_count: input.summary.top_consignees?.length ?? 0,
  };

  const { data: inserted, error: insErr } = await admin
    .from("report_deliveries")
    .insert({
      report_type: "transport_monthly_summary",
      period_key: input.periodKey,
      period_from: input.from,
      period_to_exclusive: input.toExclusive,
      channel: input.channel,
      recipient: recipientAudit,
      status: "pending",
      summary_snapshot: snapshot,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    if (input.channel === "email") {
      const { data: again } = await admin
        .from("report_deliveries")
        .select("id, status")
        .eq("report_type", "transport_monthly_summary")
        .eq("period_key", input.periodKey)
        .eq("channel", "email")
        .maybeSingle();
      if (again?.status === "sent") {
        return json({
          ok: true,
          status: "skipped",
          reason: "already_sent",
          periodKey: input.periodKey,
        });
      }
      if (again?.id) {
        // Another worker created pending/failed — reuse row and continue send.
        const deliveryId = again.id as number;
        await admin
          .from("report_deliveries")
          .update({
            status: "pending",
            error_message: null,
            recipient: recipientAudit,
            summary_snapshot: snapshot,
          })
          .eq("id", deliveryId);
        return await finalizeEmailSend(admin, {
          deliveryId,
          to: recipients,
          recipientAudit,
          periodKey: input.periodKey,
          periodLabel: input.periodLabel,
          summary: input.summary,
          snapshot,
        });
      }
    }
    return json({ ok: false, status: "failed", error: "Unable to record delivery" }, 500);
  }

  return await finalizeEmailSend(admin, {
    deliveryId: inserted.id as number,
    to: recipients,
    recipientAudit,
    periodKey: input.periodKey,
    periodLabel: input.periodLabel,
    summary: input.summary,
    snapshot,
  });
}

async function finalizeEmailSend(
  admin: ReturnType<typeof createClient>,
  input: {
    deliveryId: number;
    to: string[];
    recipientAudit: string;
    periodKey: string;
    periodLabel: string;
    summary: SummaryJson;
    snapshot: Record<string, unknown>;
  },
) {
  const text = formatEmail(input.summary, input.periodLabel);
  const send = await sendResendEmail({
    to: input.to,
    subject: `TRANSPORT MONTHLY SUMMARY — ${input.periodLabel}`,
    text,
  });

  if (!send.ok) {
    await admin
      .from("report_deliveries")
      .update({
        status: "failed",
        error_message: send.error ?? "Email send failed",
        recipient: input.recipientAudit,
      })
      .eq("id", input.deliveryId);
    return json({
      ok: false,
      status: "failed",
      periodKey: input.periodKey,
      recipient: input.recipientAudit,
      error: send.error ?? "Email send failed",
    }, 502);
  }

  await admin
    .from("report_deliveries")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      error_message: null,
      recipient: input.recipientAudit,
      summary_snapshot: input.snapshot,
    })
    .eq("id", input.deliveryId);

  return json({
    ok: true,
    status: "sent",
    periodKey: input.periodKey,
    periodLabel: input.periodLabel,
    recipient: input.recipientAudit,
    summary: input.snapshot,
  });
}

async function fetchSummary(
  admin: ReturnType<typeof createClient>,
  from: string,
  toExclusive: string,
): Promise<SummaryJson | null> {
  // Service role bypasses RPC auth; compute inline for reliability in cron.
  const { data, error } = await admin.rpc("get_transport_monthly_summary", {
    p_from: from,
    p_to_exclusive: toExclusive,
  });

  if (!error && data && typeof data === "object") {
    return data as SummaryJson;
  }

  // Fallback: direct aggregation (service role) if RPC rejects null auth.uid().
  const { data: rows, error: qErr } = await admin
    .from("lrs")
    .select("id, consignee, loading_weight, vehicle_number, entry_status, status, lr_date")
    .gte("lr_date", from)
    .lt("lr_date", toExclusive);

  if (qErr || !rows) {
    console.error("summary query failed", error ?? qErr);
    return null;
  }

  const base = rows.filter(
    (r) =>
      (r.entry_status ?? "final") === "final" &&
      r.status !== "Cancelled",
  );

  const total_lrs = base.length;
  let total_loading_weight = 0;
  const vehicles = new Set<string>();
  const byConsignee = new Map<string, { loading_weight: number; lr_count: number }>();

  for (const r of base) {
    const w = Number(r.loading_weight ?? 0);
    total_loading_weight += Number.isFinite(w) ? w : 0;
    const vn = String(r.vehicle_number ?? "").trim();
    if (vn) vehicles.add(vn);
    const name = String(r.consignee ?? "").trim() || "Unknown";
    const cur = byConsignee.get(name) ?? { loading_weight: 0, lr_count: 0 };
    cur.loading_weight += Number.isFinite(w) ? w : 0;
    cur.lr_count += 1;
    byConsignee.set(name, cur);
  }

  const top_consignees = Array.from(byConsignee.entries())
    .map(([consignee, v]) => ({
      consignee,
      loading_weight: v.loading_weight,
      lr_count: v.lr_count,
    }))
    .sort((a, b) => b.loading_weight - a.loading_weight || a.consignee.localeCompare(b.consignee))
    .slice(0, 10);

  return {
    period_from: from,
    period_to_exclusive: toExclusive,
    total_lrs,
    total_loading_weight,
    unique_vehicles: vehicles.size,
    top_consignees,
  };
}

async function deliverPushForEvent(
  admin: ReturnType<typeof createClient>,
  eventId: number,
  title: string,
  bodyText: string,
  href: string,
) {
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
  if (!vapidPublic || !vapidPrivate) {
    await admin
      .from("notification_events")
      .update({
        status: "failed",
        processed_at: new Date().toISOString(),
        error_message: "VAPID secrets not configured",
      })
      .eq("id", eventId);
    return { status: "failed" as const, attempted: 0, succeeded: 0, error: "VAPID secrets not configured" };
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  await admin.from("notification_events").update({ status: "processing" }).eq("id", eventId);

  const { data: subs } = await admin.from("push_subscriptions").select("*");
  const subscriptions = subs ?? [];
  const userIds = Array.from(new Set(subscriptions.map((s) => String(s.user_id))));
  if (userIds.length > 0) {
    await admin.from("notification_inbox").insert(
      userIds.map((userId) => ({
        user_id: userId,
        event_id: eventId,
        title,
        body: bodyText,
        href,
      })),
    );
  }

  const payload = JSON.stringify({ title, body: bodyText, href });
  let successCount = 0;
  const errors: string[] = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
      );
      successCount += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      if (message.includes("410") || message.includes("404")) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }

  if (subscriptions.length === 0 || successCount === 0) {
    const error =
      subscriptions.length === 0
        ? "No push subscriptions available"
        : `All push attempts failed`;
    await admin
      .from("notification_events")
      .update({
        status: "failed",
        processed_at: new Date().toISOString(),
        error_message: error,
      })
      .eq("id", eventId);
    return {
      status: "failed" as const,
      attempted: subscriptions.length,
      succeeded: 0,
      error,
    };
  }

  await admin
    .from("notification_events")
    .update({
      status: "sent",
      processed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", eventId);

  return {
    status: "sent" as const,
    attempted: subscriptions.length,
    succeeded: successCount,
    error: null as string | null,
  };
}

function coerceEmailList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0);
  }
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  return [];
}

function formatRecipientAudit(emails: string[]): string {
  return emails.join(", ");
}

async function loadReportSettings(admin: ReturnType<typeof createClient>) {
  const { data } = await admin.from("report_settings").select("*").eq("id", 1).maybeSingle();
  return {
    report_email_to: coerceEmailList(data?.report_email_to),
    monthly_transport_enabled: Boolean(data?.monthly_transport_enabled),
    monthly_day: Number(data?.monthly_day ?? 1),
    timezone: String(data?.timezone ?? "Asia/Kolkata"),
  };
}

async function sendResendEmail(input: { to: string[]; subject: string; text: string }) {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("REPORT_EMAIL_FROM") ?? "";
  if (!apiKey || !from) {
    return { ok: false, error: "RESEND_API_KEY or REPORT_EMAIL_FROM not configured" };
  }
  if (!input.to.length) {
    return { ok: false, error: "No report email recipients configured" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("resend failed", res.status, body.slice(0, 200));
    return { ok: false, error: `Email provider returned ${res.status}` };
  }
  return { ok: true };
}

function formatEmail(summary: SummaryJson, periodLabel: string): string {
  const lines = [
    "TRANSPORT MONTHLY SUMMARY",
    periodLabel,
    "",
    `Total LRs: ${summary.total_lrs}`,
    `Total Loading Weight: ${Number(summary.total_loading_weight).toLocaleString("en-IN", { maximumFractionDigits: 3 })} MT`,
    `Unique Vehicles: ${summary.unique_vehicles}`,
    "",
    "Top Consignees",
    "",
  ];
  const tops = summary.top_consignees ?? [];
  if (tops.length === 0) {
    lines.push("(No consignee data for this period)");
  } else {
    tops.forEach((row, i) => {
      lines.push(
        `${i + 1}. ${row.consignee} — ${Number(row.loading_weight).toLocaleString("en-IN", { maximumFractionDigits: 3 })} MT (${row.lr_count} LR${row.lr_count === 1 ? "" : "s"})`,
      );
    });
  }
  lines.push("");
  lines.push("Generated by Transjit ERP — Transport monthly summary.");
  return lines.join("\n");
}

function monthBounds(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const toExclusive = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  const periodKey = `${year}-${String(month).padStart(2, "0")}`;
  const periodLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { from, toExclusive, periodKey, periodLabel };
}

function previousMonth(todayYmd: string) {
  const [y, m] = todayYmd.split("-").map(Number);
  if (m === 1) return { year: y - 1, month: 12 };
  return { year: y, month: m - 1 };
}

function istTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function bearerToken(req: Request): string {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function hasValidSecretApiKey(req: Request): boolean {
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  if (!apiKey) return false;
  if (apiKey.startsWith("sb_publishable_")) return false;
  const keys: string[] = [];
  const multi = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (multi) {
    try {
      const parsed = JSON.parse(multi) as Record<string, unknown>;
      for (const value of Object.values(parsed)) {
        if (typeof value === "string" && value.length > 0) keys.push(value);
      }
    } catch {
      /* ignore */
    }
  }
  const single = Deno.env.get("SUPABASE_SECRET_KEY");
  if (single) keys.push(single);
  return keys.includes(apiKey);
}

function safeErr(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Request failed");
  }
  return "Request failed";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
