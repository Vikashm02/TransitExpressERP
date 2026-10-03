/**
 * TEMPORARY LR-specific recovery exception (remove after LR19646/LR19647
 * are finalized).
 *
 * Allows Om Shukla to CONTINUE (not edit-final, not bypass permissions)
 * two expired draft LRs whose 48-hour staff edit window has lapsed.
 *
 * Applies only when ALL are true:
 *  - authenticated user id is Om Shukla's Supabase auth UUID
 *  - lrNumber is exactly "LR19646" or "LR19647"
 *  - entryStatus is draft (mirrors existing isDraftEntry semantics)
 *  - the user still has the normal Create/Edit continue eligibility
 *
 * Semantics:
 *   existing normal gate (canStaffEditRecord result)  OR  (canContinueDraft
 *   eligibility AND Om AND draft AND one of the two LR numbers)
 *
 * This module is intentionally dependency-free (pure predicate/combiner).
 * Callers keep using the existing canStaffEditRecord() and isDraftEntry()
 * helpers from @/lib/editWindow and @/lib/entryStatus; the generic
 * 48-hour logic is NOT duplicated here.
 */

export const LR_RECOVERY_USER_ID =
  "15e8e879-4a4b-4805-a7af-ea332fd0b895";

export const LR_RECOVERY_LR_NUMBERS: ReadonlySet<string> = new Set([
  "LR19646",
  "LR19647",
]);

type LrLike = {
  lrNumber?: string | null;
  entryStatus?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
} | null | undefined;

export function isLrRecoveryExceptionApplicable(
  userId: string | null | undefined,
  lr: LrLike
): boolean {
  if (!userId || userId !== LR_RECOVERY_USER_ID) return false;
  if (!lr || lr.entryStatus !== "draft") return false;
  return LR_RECOVERY_LR_NUMBERS.has(lr.lrNumber ?? "");
}

/**
 * Draft-continuation gate used by LR list/table/dialog. Never weakens the
 * existing Create/Edit permission requirement — recovery only bypasses the
 * expired 48-hour window for the two listed drafts, for Om only.
 *
 * `staffEditAllowed` must be the caller's existing
 * canStaffEditRecord(isAdmin, canContinueDraft, lr) result.
 */
export function canContinueDraftRecord(
  canContinueDraft: boolean,
  staffEditAllowed: boolean,
  lr: LrLike,
  userId: string | null | undefined
): boolean {
  if (!canContinueDraft) return false;
  if (staffEditAllowed) return true;
  return isLrRecoveryExceptionApplicable(userId, lr);
}
