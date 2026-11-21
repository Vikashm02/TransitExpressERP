/**
 * CHANGE 1 — 48-hour staff edit window (shared frontend helper).
 *
 * Staff may edit an operational record only while
 *   now < record.created_at + 48 hours
 * using the ORIGINAL creation timestamp only. Never finalized_at /
 * updated_at / document dates. Creator/Admin (AuthProvider isAdmin,
 * matches DB is_admin()) bypass only this window; all existing
 * permission checks still apply. Database RLS remains authoritative.
 */

export const STAFF_EDIT_WINDOW_HOURS = 48;
export const STAFF_EDIT_WINDOW_MS = STAFF_EDIT_WINDOW_HOURS * 60 * 60 * 1000;

export const STAFF_EDIT_WINDOW_EXPIRED_MESSAGE =
  "The 48-hour staff edit window for this record has expired.";

type CreatedAtRecord = {
  created_at?: string | null;
  createdAt?: string | null;
  /** Reserved future LR (migration 128): open while a draft, then 48h from finalization. */
  reservedAt?: string | null;
  entryStatus?: string | null;
  finalizedAt?: string | null;
} | null | undefined;

function createdAtToTime(record: CreatedAtRecord): number | null {
  if (!record) return null;
  const raw = record.created_at ?? record.createdAt ?? null;
  if (!raw) return null;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : null;
}

/** True while now is strictly before created_at + 48h. Missing/invalid timestamp fails closed. */
export function isWithinEditWindow(
  record: CreatedAtRecord,
  nowMs: number = Date.now()
): boolean {
  // Same rule as the database (staff_within_lr_edit_window, migration 128).
  if (record?.reservedAt) {
    if ((record.entryStatus ?? "final") === "draft") return true;
    const finalized = record.finalizedAt ? new Date(record.finalizedAt).getTime() : NaN;
    return Number.isFinite(finalized) && nowMs < finalized + STAFF_EDIT_WINDOW_MS;
  }
  const createdTime = createdAtToTime(record);
  if (createdTime == null) return false;
  return nowMs < createdTime + STAFF_EDIT_WINDOW_MS;
}

/**
 * Staff Edit requires BOTH existing edit eligibility AND the 48h window.
 * Creator/Admin keep existing behavior (window bypass only).
 */
export function canStaffEditRecord(
  isAdmin: boolean,
  baseCanEdit: boolean,
  record: CreatedAtRecord,
  nowMs: number = Date.now()
): boolean {
  if (!baseCanEdit) return false;
  if (isAdmin) return true;
  return isWithinEditWindow(record, nowMs);
}
