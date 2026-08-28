import { supabase } from "@/lib/supabase";

/**
 * Narrow compensation / bulk-upload rollback helpers (migration 047).
 * These call SECURITY DEFINER RPCs — not a general-purpose delete API.
 */

export type UploadRollbackEntity =
  | "lrs"
  | "pods"
  | "lorry_expenses"
  | "customers"
  | "billing_parties"
  | "vehicles"
  | "drivers"
  | "transporters"
  | "materials"
  | "bills"
  | "credit_notes"
  | "debit_notes";

/** Discard the caller's own LR draft (or admin). Used by Cancel / race discard. */
export async function discardOwnLrDraft(lrId: string | number): Promise<void> {
  const { error } = await supabase.rpc("discard_own_lr_draft", {
    p_lr_id: String(lrId),
  });
  if (error) throw error;
}

/** Delete a bill header with zero line items (create compensation only). */
export async function discardUnlinedBill(billId: number): Promise<void> {
  const { error } = await supabase.rpc("discard_unlined_bill", {
    p_bill_id: billId,
  });
  if (error) throw error;
}

/** Roll back rows created in the current bulk-upload attempt. */
export async function rollbackUploadBatch(
  entity: UploadRollbackEntity,
  ids: Array<string | number>
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.rpc("rollback_upload_batch", {
    p_entity: entity,
    p_ids: ids.map(String),
  });
  if (error) throw error;
}
