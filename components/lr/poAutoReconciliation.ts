import type { PurchaseOrderLookup } from "@/components/services/purchaseOrder.service";
import type { LR } from "./lr.schema";

export type TaggedPurchaseOrderLookup = {
  key: string;
  options: PurchaseOrderLookup[];
  failed: boolean;
  legacyUnresolved?: boolean;
};

/**
 * A sole Active PO may fill an unlinked LR only when its persisted snapshot
 * agrees with that PO. The candidate list has already been constrained by the
 * stable Billing Party + Consignor + Consignee + Material identity.
 */
export function shouldAutoReconcileSingleActivePo(
  lr: Pick<LR, "purchaseOrderId" | "poNumber" | "poDate">,
  options: PurchaseOrderLookup[],
  autoSelect: boolean,
): boolean {
  if (!autoSelect || options.length !== 1 || lr.purchaseOrderId != null) return false;

  const po = options[0];
  const snapshotPoNumber = lr.poNumber.trim();
  const snapshotPoDate = lr.poDate?.trim() ?? "";

  return (!snapshotPoNumber || snapshotPoNumber.toUpperCase() === po.poNumber.trim().toUpperCase())
    && (!snapshotPoDate || snapshotPoDate === po.issueDate.trim());
}

/** A response may reconcile only when its tagged identity is still current. */
export function shouldReconcileCurrentPurchaseOrderLookup(
  lr: Pick<LR, "purchaseOrderId" | "poNumber" | "poDate">,
  lookup: TaggedPurchaseOrderLookup | null,
  currentLookupKey: string,
  enabled: boolean,
  autoSelect: boolean,
): boolean {
  return enabled
    && lookup !== null
    && lookup.key === currentLookupKey
    && !lookup.failed
    && !lookup.legacyUnresolved
    && shouldAutoReconcileSingleActivePo(lr, lookup.options, autoSelect);
}
