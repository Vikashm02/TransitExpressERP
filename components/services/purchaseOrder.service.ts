import { readPartyIdentity } from "@/components/lr/partyIdentity";
import { supabase } from "@/lib/supabase";
import { purchaseOrderSchema, type PurchaseOrder } from "@/components/purchaseOrder/purchaseOrder.schema";

export interface PurchaseOrderRecord extends PurchaseOrder {
  id: number;
  billingPartyName: string;
  consignee: string;
  usedWeight: number;
  materialName: string;
}

export type PurchaseOrderLookup = Pick<PurchaseOrderRecord, "id" | "poNumber" | "issueDate" | "billingPartyId" | "consigneeId" | "materialId">;
export type PurchaseOrderParty = { id: number; name: string; code: string };

export async function getPurchaseOrders(): Promise<PurchaseOrderRecord[]> {
  const { data, error } = await supabase.rpc("get_purchase_orders");
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    billingPartyId: Number(row.billing_party_id),
    billingPartyName: String(row.billing_party_name),
    consignor: String(row.consignor ?? ""),
    consigneeId: readPartyIdentity(row.consignee_id) ?? 0,
    consignee: String(row.consignee ?? ""),
    materialId: readPartyIdentity(row.material_id) ?? null,
    materialName: String(row.material_name ?? ""),
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

/** PO-entry-only Customer Master lookup; does not depend on LR permissions. */
export async function getPurchaseOrderCustomers(): Promise<PurchaseOrderParty[]> {
  const { data, error } = await supabase.rpc("get_purchase_order_customers");
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id), name: String(row.name), code: String(row.code),
  }));
}

export async function getActiveLrPurchaseOrders(billingPartyId: number | null | undefined, consignor: string, consigneeId: number | null | undefined, materialId: number | null | undefined): Promise<PurchaseOrderLookup[]> {
  if (billingPartyId == null || consigneeId == null || materialId == null || !consignor.trim()) return [];
  readPartyIdentity(billingPartyId);
  readPartyIdentity(consigneeId);
  readPartyIdentity(materialId);
  const { data, error } = await supabase.rpc("get_lr_purchase_orders_by_party_consignee_material_id", {
    p_billing_party_id: billingPartyId, p_consignor: consignor, p_consignee_id: consigneeId, p_material_id: materialId,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id), billingPartyId: Number(row.billing_party_id), consigneeId: readPartyIdentity(row.consignee_id) ?? 0, materialId: readPartyIdentity(row.material_id),
    poNumber: String(row.po_number), issueDate: String(row.issue_date),
  })).filter((row: PurchaseOrderLookup) => row.billingPartyId === billingPartyId && row.consigneeId === consigneeId && row.materialId === materialId);
}

export async function getPurchaseOrderMaterials(): Promise<{ id: number; name: string }[]> {
  const { data, error } = await supabase.rpc("get_purchase_order_materials");
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({ id: readPartyIdentity(row.id)!, name: String(row.material_name) }));
}

export async function savePurchaseOrder(id: number | null, values: PurchaseOrder): Promise<void> {
  const parsed = purchaseOrderSchema.parse(values);
  if (id === null && parsed.materialId == null) throw new Error("Select Material before creating a PO.");
  const row = {
    billing_party_id: parsed.billingPartyId,
    ...(parsed.materialId !== undefined ? { material_id: parsed.materialId } : {}),
    consignor: parsed.consignor,
    consignee_id: parsed.consigneeId,
    po_number: parsed.poNumber,
    issue_date: parsed.issueDate,
    allotted_weight: parsed.allottedWeight || null,
    status: parsed.status,
  };
  const query = id === null
    ? supabase.from("purchase_orders").insert(row)
    : supabase.from("purchase_orders").update(row).eq("id", id);
  const { error } = await query.select("id").single();
  if (error) throw error;
}
