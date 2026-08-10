import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields } from "@/lib/caseMapping";
import type { BillingPartyMaster } from "@/components/billingParty/billingParty.schema";

/** A persisted billing party row, as returned by Supabase (adds server-owned columns). */
export interface BillingPartyRecord extends BillingPartyMaster {
  id: number;
  created_at?: string;
}

const TABLE = "billing_parties";

/** Supabase returns raw snake_case columns; `id`/`created_at` pass through unchanged. */
function fromRow(row: Record<string, unknown>): BillingPartyRecord {
  const { id, created_at, ...rest } = row;

  return {
    id: id as number,
    created_at: created_at as string | undefined,
    ...objectToCamelCase<BillingPartyMaster>(rest),
  };
}

/**
 * Business codes follow the same "BP001", "BP002", ... convention used by
 * the Customer Master's "C001" codes. Sequenced off the current row count,
 * which is adequate for a low-concurrency master data table.
 */
async function generateBillingPartyCode(): Promise<string> {
  const { count, error } = await supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true });

  if (error) throw error;

  const next = (count ?? 0) + 1;
  return `BP${String(next).padStart(3, "0")}`;
}

/* ==========================================================
   GET ALL BILLING PARTIES
========================================================== */

export async function getBillingParties(): Promise<BillingPartyRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

/* ==========================================================
   GET ONE BILLING PARTY
========================================================== */

export async function getBillingParty(id: number): Promise<BillingPartyRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   CREATE BILLING PARTY
========================================================== */

export async function createBillingParty(
  values: BillingPartyMaster
): Promise<BillingPartyRecord> {
  const code = values.code.trim() || (await generateBillingPartyCode());

  const { data, error } = await supabase
    .from(TABLE)
    .insert(objectToSnakeCase({ ...values, code }))
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   UPDATE BILLING PARTY
========================================================== */

export async function updateBillingParty(
  id: number,
  values: BillingPartyMaster
): Promise<BillingPartyRecord> {
  // `code` is immutable after creation, and `id`/`created_at` are
  // server-owned — none of the three may ever reach the update payload.
  const { code: _code, ...updatable } = omitServerFields(
    values as unknown as Record<string, unknown>
  );

  const { data, error } = await supabase
    .from(TABLE)
    .update(objectToSnakeCase(updatable))
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   DELETE BILLING PARTY
========================================================== */

export async function deleteBillingParty(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}
