/**
 * Shared draft / incomplete entry helpers (migration 034 entry_status).
 */

export type EntryStatus = "draft" | "final";

export function isDraftEntry(status: string | null | undefined): boolean {
  return status === "draft";
}

/** Subtle amber row highlight for incomplete/draft records. */
export function draftRowClassName(status: string | null | undefined): string | undefined {
  if (!isDraftEntry(status)) return undefined;
  return "bg-warning/10 hover:bg-warning/15";
}

export function entryStatusLabel(status: string | null | undefined): string {
  return isDraftEntry(status) ? "Incomplete" : "Complete";
}

export function entryStatusBadgeStatus(status: string | null | undefined): "Pending" | "Completed" {
  return isDraftEntry(status) ? "Pending" : "Completed";
}

/**
 * Legacy helper for pre-036 temporary draft numbers (`DRAFT-*`).
 * New drafts reserve a real LR number on first Consignor/Consignee via
 * create_numbered_lr_draft (migration 062). Kept so finalize can recognize
 * old DRAFT-* rows.
 */
export function makeDraftLrNumber(): string {
  const token =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : String(Date.now());
  return `DRAFT-${token}`;
}

/** True when the value is a legacy DRAFT-* placeholder (not a real LR). */
export function isDraftLrNumber(lrNumber: string | null | undefined): boolean {
  return Boolean(lrNumber?.startsWith("DRAFT-"));
}

/** Needs allocate_next_lr_number() before the row can become final. */
export function needsLrNumberAllocation(
  lrNumber: string | null | undefined
): boolean {
  const trimmed = lrNumber?.trim() ?? "";
  return !trimmed || isDraftLrNumber(trimmed);
}

/**
 * Continue-draft is allowed with Create OR Edit.
 * Finalized Edit still requires Edit alone (enforced by callers + RLS).
 */
export function canContinueDraftEntry(options: {
  canCreate: boolean;
  canEdit: boolean;
}): boolean {
  return options.canCreate || options.canEdit;
}
