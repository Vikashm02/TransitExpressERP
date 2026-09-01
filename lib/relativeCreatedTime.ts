/**
 * Shared relative / absolute creation-time formatting for ERP list UIs.
 * Source of truth remains DB `created_at` (never rewritten).
 *
 * Thresholds (local timezone via Date / date-fns):
 *   < 1 min        → Just now
 *   1–59 min       → X minute(s) ago
 *   1–23 hours     → X hour(s) ago
 *   calendar day 1 → Yesterday
 *   2–6 days       → X days ago
 *   7+ days        → dd MMM yyyy, hh:mm a
 */

import {
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  format,
  isValid,
  parseISO,
} from "date-fns";

/** Matches Staff Activity / report “Generated” style used elsewhere in ERP. */
export const ABSOLUTE_CREATED_FORMAT = "dd MMM yyyy, hh:mm a";

export type CreatedTimestamp = string | Date | null | undefined;

export function parseCreatedTimestamp(value: CreatedTimestamp): Date | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return isValid(value) ? value : null;
  }

  try {
    const parsed = parseISO(value);
    if (isValid(parsed)) return parsed;
  } catch {
    // fall through
  }

  const fallback = new Date(value);
  return isValid(fallback) ? fallback : null;
}

export function formatAbsoluteCreatedAt(value: CreatedTimestamp): string | null {
  const date = parseCreatedTimestamp(value);
  if (!date) return null;
  return format(date, ABSOLUTE_CREATED_FORMAT);
}

/**
 * Relative label when recent; absolute date/time when 7+ calendar days old.
 * Returns null when the timestamp is missing/invalid (callers show empty UI).
 */
export function formatRelativeCreatedAt(
  value: CreatedTimestamp,
  now: Date = new Date()
): string | null {
  const date = parseCreatedTimestamp(value);
  if (!date) return null;

  const minutes = differenceInMinutes(now, date);
  if (minutes < 0) {
    // Clock skew / future stamp — fall back to absolute.
    return format(date, ABSOLUTE_CREATED_FORMAT);
  }
  if (minutes < 1) return "Just now";
  if (minutes < 60) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }

  const hours = differenceInHours(now, date);
  if (hours < 24) {
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }

  const days = differenceInCalendarDays(now, date);
  if (days === 1) return "Yesterday";
  if (days >= 2 && days <= 6) return `${days} days ago`;

  return format(date, ABSOLUTE_CREATED_FORMAT);
}

/** One shared 60s clock for all RelativeCreatedTime instances (no per-row timers). */
let relativeCreatedClockMs = Date.now();
const relativeCreatedClockListeners = new Set<() => void>();
let relativeCreatedClockTimer: ReturnType<typeof setInterval> | null = null;

export function subscribeRelativeCreatedClock(onStoreChange: () => void): () => void {
  relativeCreatedClockListeners.add(onStoreChange);
  if (!relativeCreatedClockTimer) {
    relativeCreatedClockTimer = setInterval(() => {
      relativeCreatedClockMs = Date.now();
      for (const listener of relativeCreatedClockListeners) {
        listener();
      }
    }, 60_000);
  }
  return () => {
    relativeCreatedClockListeners.delete(onStoreChange);
    if (relativeCreatedClockListeners.size === 0 && relativeCreatedClockTimer) {
      clearInterval(relativeCreatedClockTimer);
      relativeCreatedClockTimer = null;
    }
  };
}

export function getRelativeCreatedClock(): number {
  return relativeCreatedClockMs;
}

/** Stable SSR snapshot — client component shows absolute until mounted. */
export function getRelativeCreatedClockServer(): number {
  return 0;
}
