import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields } from "@/lib/caseMapping";
import type { DeliveryChallan } from "@/components/deliveryChallan/deliveryChallan.schema";
import { emitNotificationEvent } from "@/components/services/notification.service";

export interface DeliveryChallanRecord extends DeliveryChallan {
  id: number;
  createdBy: string | null;
  updatedBy: string | null;
  created_at?: string;
  updated_at?: string;
}

const TABLE = "delivery_challans";

function toRow(values: DeliveryChallan) {
  return objectToSnakeCase(values);
}

function fromRow(row: Record<string, unknown>): DeliveryChallanRecord {
  const { id, created_at, updated_at, created_by, updated_by, ...rest } = row;
  const challan = objectToCamelCase<DeliveryChallan>(rest);

  return {
    ...challan,
    // Postgres `numeric` often arrives as a string over PostgREST.
    qty: Number(challan.qty) || 0,
    id: id as number,
    createdBy: (created_by as string | null) ?? null,
    updatedBy: (updated_by as string | null) ?? null,
    created_at: created_at as string | undefined,
    updated_at: updated_at as string | undefined,
  };
}

/* ==========================================================
   GET ALL
========================================================== */

export async function getDeliveryChallans(): Promise<DeliveryChallanRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

/* ==========================================================
   GET ONE
========================================================== */

export async function getDeliveryChallan(id: number): Promise<DeliveryChallanRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   CREATE
========================================================== */

export async function createDeliveryChallan(
  values: DeliveryChallan
): Promise<DeliveryChallanRecord> {
  let createdBy: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    createdBy = data.user?.id ?? null;
  } catch {
    createdBy = null;
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...toRow(values), created_by: createdBy })
    .select()
    .single();

  if (error) throw error;

  const record = fromRow(data);
  void emitNotificationEvent({
    ruleKey: "dc.created",
    title: `Delivery Challan created for ${record.lrNumber}`,
    href: "/delivery-challans",
    payload: { id: record.id, lrNumber: record.lrNumber },
  });
  return record;
}

/* ==========================================================
   UPDATE
========================================================== */

export async function updateDeliveryChallan(
  id: number,
  values: DeliveryChallan
): Promise<DeliveryChallanRecord> {
  const sanitized = omitServerFields(values as unknown as Record<string, unknown>) as DeliveryChallan;

  const { data, error } = await supabase
    .from(TABLE)
    .update(toRow(sanitized))
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  const record = fromRow(data);
  void emitNotificationEvent({
    ruleKey: "dc.updated",
    title: `Delivery Challan updated for ${record.lrNumber}`,
    href: "/delivery-challans",
    payload: { id: record.id, lrNumber: record.lrNumber },
  });
  return record;
}

/* ==========================================================
   SYNC LR-DERIVED SNAPSHOT FIELDS
   Delivery Challan stores snapshots of selected LR fields (see
   migration 023 + applyLrSnapshot). On LR save, every challan linked
   by `lr_number` gets `qty` + `po_number` updated in one write.
   `po_date`, `by_name`, `hsn`, and all other DC columns are left alone.
========================================================== */

export async function syncDeliveryChallanFromLr(
  lrNumber: string,
  loadingWeight: number,
  poNumber: string
): Promise<void> {
  const trimmed = lrNumber.trim();
  if (!trimmed) return;

  const { error } = await supabase
    .from(TABLE)
    .update({
      qty: loadingWeight,
      po_number: poNumber.trim(),
    })
    .eq("lr_number", trimmed);

  if (error) throw error;
}
