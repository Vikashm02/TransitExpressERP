import { supabase } from "@/lib/supabase";

export type BidReminderStatus = "Scheduled" | "Sending" | "Sent" | "Cancelled" | "Expired";

/** A bid reminder row. RLS restricts all access to the owning user. */
export interface BidReminder {
  id: string;
  bidId: string;
  userId: string;
  remindAt: string;
  status: BidReminderStatus;
  attemptCount: number;
  sentAt: string | null;
  createdAt: string;
}

function fromRow(row: Record<string, unknown>): BidReminder {
  return {
    id: String(row.id),
    bidId: String(row.bid_id),
    userId: String(row.user_id),
    remindAt: String(row.remind_at),
    status: row.status as BidReminderStatus,
    attemptCount: Number(row.attempt_count ?? 0),
    sentAt: (row.sent_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function toInsert(bidId: string, remindAtISO: string, userId: string): Record<string, unknown> {
  return { bid_id: bidId, user_id: userId, remind_at: remindAtISO, status: "Scheduled" };
}

async function currentUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

/** All reminders (any status) for one bid, owned by the caller, newest first. */
export async function getBidReminders(bidId: string): Promise<BidReminder[]> {
  const { data, error } = await supabase
    .from("bid_reminders")
    .select("*")
    .eq("bid_id", bidId)
    .order("remind_at", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map(fromRow);
}

/** Own Scheduled reminders across bids, for the landing-page bell column. */
export async function getMyScheduledReminders(): Promise<BidReminder[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("bid_reminders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "Scheduled")
    .order("remind_at", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map(fromRow);
}

/** Create one reminder. Duplicate active (bid/user/time) rows are rejected by the DB. */
export async function createBidReminder(bidId: string, remindAtISO: string): Promise<BidReminder> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("bid_reminders")
    .insert(toInsert(bidId, remindAtISO, userId))
    .select()
    .single();

  if (error) throw error;

  return fromRow(data as Record<string, unknown>);
}

/**
 * Move a Scheduled reminder to a new exact timestamp. Throws a friendly
 * error when the row is already being processed instead of silently
 * succeeding while the old time still sends.
 */
export async function rescheduleBidReminder(id: string, remindAtISO: string): Promise<BidReminder> {
  const { data, error } = await supabase
    .from("bid_reminders")
    .update({ remind_at: remindAtISO, status: "Scheduled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "Scheduled")
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new Error("This reminder is already being processed. Cancel it and create a new reminder.");
    }
    throw error;
  }

  return fromRow(data as Record<string, unknown>);
}

/**
 * Cancel preserves the row for history. Scheduled rows cancel immediately;
 * a row already claimed as Sending gets a cancel request that the
 * dispatcher honors before any external send.
 */
export async function cancelBidReminder(id: string): Promise<"cancelled" | "cancel_requested"> {
  const now = new Date().toISOString();
  const direct = await supabase
    .from("bid_reminders")
    .update({ status: "Cancelled", updated_at: now })
    .eq("id", id)
    .eq("status", "Scheduled")
    .select("id")
    .maybeSingle();

  if (direct.error) throw direct.error;
  if (direct.data) return "cancelled";

  const flagged = await supabase
    .from("bid_reminders")
    .update({ cancel_requested: true, updated_at: now })
    .eq("id", id)
    .eq("status", "Sending")
    .select("id")
    .maybeSingle();

  if (flagged.error) throw flagged.error;
  if (!flagged.data) throw new Error("Reminder is no longer active.");
  return "cancel_requested";
}

/** Nearest upcoming Scheduled reminder per bid, for table display. */
export function nearestReminderByBid(
  reminders: BidReminder[]
): Map<string, { count: number; nearest: BidReminder }> {
  const map = new Map<string, { count: number; nearest: BidReminder }>();
  for (const reminder of reminders) {
    if (reminder.status !== "Scheduled") continue;
    const entry = map.get(reminder.bidId);
    if (!entry || reminder.remindAt < entry.nearest.remindAt) {
      map.set(reminder.bidId, { count: (entry?.count ?? 0) + 1, nearest: reminder });
    } else {
      entry.count += 1;
    }
  }
  return map;
}

export function formatReminderTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
