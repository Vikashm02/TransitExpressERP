import { supabase } from "@/lib/supabase";

export type NotificationDeliveryMode = "immediate" | "scheduled";

export interface NotificationRule {
  id: number;
  ruleKey: string;
  category: string;
  name: string;
  description: string;
  enabled: boolean;
  deliveryMode: NotificationDeliveryMode;
  scheduledTime: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  targetScope: string;
  sortOrder: number;
}

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_QUIET_START = "22:00";
const DEFAULT_QUIET_END = "06:00";

/** Known IANA zones for admin UI; structure allows adding more later. */
export const NOTIFICATION_TIMEZONES = [
  { label: "Asia/Kolkata (IST)", value: "Asia/Kolkata" },
] as const;

function fromRule(row: Record<string, unknown>): NotificationRule {
  return {
    id: Number(row.id),
    ruleKey: String(row.rule_key),
    category: String(row.category),
    name: String(row.name),
    description: String(row.description ?? ""),
    enabled: Boolean(row.enabled),
    deliveryMode: (row.delivery_mode as NotificationDeliveryMode) || "immediate",
    scheduledTime: String(row.scheduled_time ?? "08:00"),
    quietHoursEnabled: row.quiet_hours_enabled === undefined ? true : Boolean(row.quiet_hours_enabled),
    quietHoursStart: String(row.quiet_hours_start ?? DEFAULT_QUIET_START),
    quietHoursEnd: String(row.quiet_hours_end ?? DEFAULT_QUIET_END),
    timezone: String(row.timezone ?? DEFAULT_TIMEZONE),
    targetScope: String(row.target_scope ?? "all"),
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export async function getNotificationRules(): Promise<NotificationRule[]> {
  const { data, error } = await supabase
    .from("notification_rules")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => fromRule(row as Record<string, unknown>));
}

export async function updateNotificationRule(
  id: number,
  patch: Partial<
    Pick<
      NotificationRule,
      | "enabled"
      | "deliveryMode"
      | "scheduledTime"
      | "quietHoursEnabled"
      | "quietHoursStart"
      | "quietHoursEnd"
      | "timezone"
    >
  >
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.enabled !== undefined) payload.enabled = patch.enabled;
  if (patch.deliveryMode !== undefined) payload.delivery_mode = patch.deliveryMode;
  if (patch.scheduledTime !== undefined) payload.scheduled_time = patch.scheduledTime;
  if (patch.quietHoursEnabled !== undefined) payload.quiet_hours_enabled = patch.quietHoursEnabled;
  if (patch.quietHoursStart !== undefined) payload.quiet_hours_start = patch.quietHoursStart;
  if (patch.quietHoursEnd !== undefined) payload.quiet_hours_end = patch.quietHoursEnd;
  if (patch.timezone !== undefined) payload.timezone = patch.timezone;

  const { error } = await supabase.from("notification_rules").update(payload).eq("id", id);
  if (error) throw error;
}

/**
 * Enqueue a notification event. Never throws to callers — ERP ops must
 * succeed even if notification enqueue fails.
 */
export async function emitNotificationEvent(input: {
  ruleKey: string;
  title: string;
  body?: string;
  href?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { data: rule, error: ruleError } = await supabase
      .from("notification_rules")
      .select(
        "enabled, delivery_mode, scheduled_time, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone"
      )
      .eq("rule_key", input.ruleKey)
      .maybeSingle();

    if (ruleError || !rule || !rule.enabled) return;

    const now = new Date();
    let deliverAfter = now;
    let invokeImmediate = false;

    if (rule.delivery_mode === "scheduled") {
      // Unchanged: hold until configured scheduled_time (browser local).
      deliverAfter = nextScheduledLocalDate(String(rule.scheduled_time || "08:00"));
    } else {
      // Immediate mode — respect quiet hours when enabled.
      const quietEnabled = rule.quiet_hours_enabled !== false;
      const quietStart = String(rule.quiet_hours_start ?? DEFAULT_QUIET_START);
      const quietEnd = String(rule.quiet_hours_end ?? DEFAULT_QUIET_END);
      const timezone = String(rule.timezone ?? DEFAULT_TIMEZONE);

      if (quietEnabled && isInQuietHours(now, quietStart, quietEnd, timezone)) {
        deliverAfter = nextQuietHoursEnd(now, quietStart, quietEnd, timezone);
        invokeImmediate = false;
      } else {
        deliverAfter = now;
        invokeImmediate = true;
      }
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    // created_by must equal auth.uid() so INSERT … RETURNING (.select) passes
    // notification_events_select (is_app_admin OR created_by = auth.uid()).
    const userId = session?.user?.id;
    if (!userId) {
      console.error("[notifications] enqueue skipped: no authenticated session");
      return;
    }

    const { data: inserted, error } = await supabase
      .from("notification_events")
      .insert({
        rule_key: input.ruleKey,
        title: input.title,
        body: input.body ?? "",
        href: input.href ?? "/",
        status: "pending",
        deliver_after: deliverAfter.toISOString(),
        payload: input.payload ?? {},
        created_by: userId,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[notifications] enqueue failed", error);
      return;
    }

    if (invokeImmediate && inserted?.id) {
      // Fire-and-forget; ignore failures so ERP stays non-blocking.
      void supabase.functions.invoke("process-notifications", {
        body: { mode: "immediate", eventId: inserted.id },
      });
    }
  } catch (error) {
    console.error("[notifications] emit failed", error);
  }
}

/** Next occurrence of HH:MM in the browser's local timezone. */
function nextScheduledLocalDate(hhmm: string): Date {
  const [hStr, mStr] = hhmm.split(":");
  const hours = Number(hStr) || 8;
  const minutes = Number(mStr) || 0;
  const now = new Date();
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function parseHHMM(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(":");
  const hours = Math.min(23, Math.max(0, Number(hStr) || 0));
  const minutes = Math.min(59, Math.max(0, Number(mStr) || 0));
  return hours * 60 + minutes;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    const asLocal = getZonedParts(new Date(utcMs), timeZone);
    const asLocalMs = Date.UTC(
      asLocal.year,
      asLocal.month - 1,
      asLocal.day,
      asLocal.hour,
      asLocal.minute,
      0
    );
    const desiredMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    utcMs += desiredMs - asLocalMs;
  }
  return new Date(utcMs);
}

function addCalendarDays(year: number, month: number, day: number, delta: number): {
  year: number;
  month: number;
  day: number;
} {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * Quiet hours support overnight windows where start > end
 * (e.g. 22:00 → 06:00).
 */
export function isInQuietHours(
  now: Date,
  quietStart: string,
  quietEnd: string,
  timeZone: string
): boolean {
  const start = parseHHMM(quietStart);
  const end = parseHHMM(quietEnd);
  if (start === end) return false;

  const parts = getZonedParts(now, timeZone);
  const current = parts.hour * 60 + parts.minute;

  if (start > end) {
    // Overnight: quiet if >= start OR < end
    return current >= start || current < end;
  }
  // Same-day window: quiet if >= start AND < end
  return current >= start && current < end;
}

/**
 * Next quiet-hours end (wall clock in rule timezone) as a UTC Date.
 * Used as deliver_after so cron/scheduled processing picks the event up.
 */
export function nextQuietHoursEnd(
  now: Date,
  quietStart: string,
  quietEnd: string,
  timeZone: string
): Date {
  const start = parseHHMM(quietStart);
  const end = parseHHMM(quietEnd);
  const endH = Math.floor(end / 60);
  const endM = end % 60;
  const parts = getZonedParts(now, timeZone);
  const current = parts.hour * 60 + parts.minute;

  let dayOffset = 0;
  if (start > end) {
    // Overnight: before end → today; at/after start → tomorrow; between end and start → next end is tomorrow? No — outside quiet.
    // When called during quiet: either current < end (today) or current >= start (tomorrow).
    if (current < end) {
      dayOffset = 0;
    } else {
      dayOffset = 1;
    }
  } else {
    // Same-day quiet: end is later today while still in window
    dayOffset = current < end ? 0 : 1;
  }

  const target = addCalendarDays(parts.year, parts.month, parts.day, dayOffset);
  const result = zonedWallTimeToUtc(
    target.year,
    target.month,
    target.day,
    endH,
    endM,
    timeZone
  );

  // Safety: if somehow not in the future, push one more day
  if (result.getTime() <= now.getTime()) {
    const next = addCalendarDays(target.year, target.month, target.day, 1);
    return zonedWallTimeToUtc(next.year, next.month, next.day, endH, endM, timeZone);
  }
  return result;
}

export async function savePushSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw new Error("Invalid push subscription");

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,endpoint" }
  );
  if (error) throw error;
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw error;
}

export interface InboxItem {
  id: number;
  title: string;
  body: string;
  href: string;
  readAt: string | null;
  createdAt: string;
}

export async function getNotificationInbox(limit = 30): Promise<InboxItem[]> {
  const { data, error } = await supabase
    .from("notification_inbox")
    .select("id, title, body, href, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    title: String(row.title),
    body: String(row.body ?? ""),
    href: String(row.href ?? "/"),
    readAt: (row.read_at as string | null) ?? null,
    createdAt: String(row.created_at),
  }));
}

export async function markInboxRead(id: number): Promise<void> {
  const { error } = await supabase
    .from("notification_inbox")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
