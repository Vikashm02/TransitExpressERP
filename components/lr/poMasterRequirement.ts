/**
 * LR ↔ PO Master rule: an LR may only carry a PO number that already exists
 * as an Active PO in PO Master (matching Billing Party, Consignor, Consignee
 * and Material). A PO is chosen from the "Active PO" list, which sets
 * `purchaseOrderId`; a typed PO number with no `purchaseOrderId` means it was
 * not found in PO Master, and saving it would make the database create a new
 * PO on its own. That is blocked here.
 *
 * Applies to new LRs and drafts being submitted, and to an existing LR whose
 * PO number is being changed. An existing LR whose PO number is unchanged
 * keeps saving as before, so historical records are never blocked.
 */

type PoFields = {
  poNumber?: string | null;
  purchaseOrderId?: number | null;
};

export function isPoNumberMissingFromMaster(
  values: PoFields,
  original: PoFields | null | undefined,
  isNewOrDraft: boolean
): boolean {
  const typed = (values.poNumber ?? "").trim();
  if (!typed || values.purchaseOrderId != null) return false;
  if (isNewOrDraft) return true;
  return typed !== (original?.poNumber ?? "").trim();
}

export function poNotInMasterMessage(poNumber: string): string {
  return (
    `PO number "${poNumber.trim()}" is not in the PO Master, so this LR cannot be saved. ` +
    "Please add this PO in PO Master first (with the same Billing Party, Consignor, " +
    "Consignee and Material), then select it from the Active PO list. " +
    "If this LR has no PO, clear the PO Number and PO Date."
  );
}
