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
  const mapped = objectToCamelCase<BillingPartyMaster>(rest);

  return {
    id: id as number,
    created_at: created_at as string | undefined,
    ...mapped,
    entryStatus: mapped.entryStatus === "draft" ? "draft" : "final",
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

/**
 * Restricted Billing Party lookup for LR Create/Edit only.
 * Uses get_lr_billing_party_lookup (migration 052) — requires lr create/edit,
 * NOT billing_parties:view. Does not replace getBillingParties() / Master.
 */
export type LrBillingPartyLookupRow = Pick<
  BillingPartyRecord,
  "id" | "name" | "code" | "gst" | "city" | "entryStatus"
>;

export async function getLrBillingPartyLookup(): Promise<LrBillingPartyLookupRow[]> {
  const { data, error } = await supabase.rpc("get_lr_billing_party_lookup");

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  return rows.map((item) => {
    const row = item as Record<string, unknown>;
    const entryStatus = row.entry_status === "draft" ? "draft" : "final";
    return {
      id: Number(row.id),
      name: String(row.name ?? ""),
      code: String(row.code ?? ""),
      gst: String(row.gst ?? ""),
      city: String(row.city ?? ""),
      entryStatus,
    };
  });
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
