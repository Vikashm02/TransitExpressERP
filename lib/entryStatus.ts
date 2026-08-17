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
 * New drafts must use allocate_next_lr_number() instead.
 * Kept only so isDraftLrNumber / finalize can recognize old rows.
 */
export function makeDraftLrNumber(): string {
  const token =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : String(Date.now());
  return `DRAFT-${token}`;
}

export function isDraftLrNumber(lrNumber: string | null | undefined): boolean {
  return Boolean(lrNumber?.startsWith("DRAFT-"));
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
