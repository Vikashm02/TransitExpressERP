import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields } from "@/lib/caseMapping";
import type { DeliveryChallan } from "@/components/deliveryChallan/deliveryChallan.schema";

export interface DeliveryChallanRecord extends DeliveryChallan {
  id: number;
  createdBy: string | null;
  created_at?: string;
}

const TABLE = "delivery_challans";

function toRow(values: DeliveryChallan) {
  return objectToSnakeCase(values);
}

function fromRow(row: Record<string, unknown>): DeliveryChallanRecord {
  const { id, created_at, created_by, ...rest } = row;
  const challan = objectToCamelCase<DeliveryChallan>(rest);

  return {
    ...challan,
    // Postgres `numeric` often arrives as a string over PostgREST.
    qty: Number(challan.qty) || 0,
    id: id as number,
    createdBy: (created_by as string | null) ?? null,
    created_at: created_at as string | undefined,
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

  return fromRow(data);
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

  return fromRow(data);
}
