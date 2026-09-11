import { supabase } from "@/lib/supabase";
import { purchaseOrderSchema, type PurchaseOrder } from "@/components/purchaseOrder/purchaseOrder.schema";

export interface PurchaseOrderRecord extends PurchaseOrder {
  id: number;
  billingPartyName: string;
  usedWeight: number;
}

export type PurchaseOrderLookup = Pick<PurchaseOrderRecord, "id" | "poNumber" | "issueDate">;
export type PurchaseOrderParty = { id: number; name: string; code: string };

export async function getPurchaseOrders(): Promise<PurchaseOrderRecord[]> {
  const { data, error } = await supabase.rpc("get_purchase_orders");
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    billingPartyId: Number(row.billing_party_id),
    billingPartyName: String(row.billing_party_name),
    poNumber: String(row.po_number),
    issueDate: String(row.issue_date),
    allottedWeight: Number(row.allotted_weight),
    usedWeight: Number(row.used_weight),
    status: row.status === "Inactive" ? "Inactive" : "Active",
  }));
}

export async function getPurchaseOrderParties(): Promise<PurchaseOrderParty[]> {
  const { data, error } = await supabase.rpc("get_purchase_order_billing_parties");
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id), name: String(row.name), code: String(row.code),
  }));
}

export async function getActiveLrPurchaseOrders(billingParty: string): Promise<PurchaseOrderLookup[]> {
  const { data, error } = await supabase.rpc("get_lr_purchase_orders", { p_billing_party: billingParty });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id), poNumber: String(row.po_number), issueDate: String(row.issue_date),
  }));
}

export async function savePurchaseOrder(id: number | null, values: PurchaseOrder): Promise<void> {
  const parsed = purchaseOrderSchema.parse(values);
  const row = {
    billing_party_id: parsed.billingPartyId,
    po_number: parsed.poNumber,
    issue_date: parsed.issueDate,
    allotted_weight: parsed.allottedWeight,
    status: parsed.status,
  };
  const query = id === null
    ? supabase.from("purchase_orders").insert(row)
    : supabase.from("purchase_orders").update(row).eq("id", id);
  const { error } = await query.select("id").single();
  if (error) throw error;
}
