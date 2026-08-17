import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields, toSnakeCase } from "@/lib/caseMapping";
import { calculateLR } from "@/lib/calculations/lrCalculations";
import type { LR } from "@/components/lr/lr.schema";
import { syncDeliveryChallanFromLr } from "@/components/services/deliveryChallan.service";
import { emitNotificationEvent } from "@/components/services/notification.service";

/** A persisted LR row. `billAmount`/`lorryHireAmount`/`profitAmount` are
 * intentionally NOT part of the editable `LR` schema — they are always
 * (re)computed from `calculateLR()` at save time so the persisted values
 * can never drift from the source formulas (see lrCalculations.ts).
 *
 * `createdBy`/`assignedTo` are likewise NOT part of the editable `LR`
 * schema — they are entirely controlled server-side by the
 * `lrs_enforce_ownership()` trigger (migration 017), never sent by the
 * client on create/update. `null` on either means "created before the
 * ownership migration" (visible to admins only — see the matching RLS
 * policy) rather than an invented owner. Reassigning `assignedTo` for
 * an existing LR goes through the dedicated `reassignLR()` below, not
 * `updateLR()`. */
export interface LRRecord extends LR {
  id: number;
  billAmount: number;
  lorryHireAmount: number;
  profitAmount: number;
  createdBy: string | null;
  updatedBy: string | null;
  assignedTo: string | null;
  /** Draft vs finalized entry (migration 034). Defaults to final. */
  entryStatus: "draft" | "final";
  created_at?: string;
  updated_at?: string;
}

const TABLE = "lrs";

/** `dcDate`/`invoiceDate` are nullable in the database; `lrDate` is always
 * required by `lrSchema`, so it never needs null-coalescing here. */
const OPTIONAL_DATE_FIELDS = ["dcDate", "invoiceDate"] as const;

/** Fields whose DB column name the generic `toSnakeCase()`/`toCamelCase()`
 * in `caseMapping.ts` cannot derive correctly, so they're remapped
 * explicitly here instead:
 *   - `from`/`to` have no camelCase boundary, so `toSnakeCase` leaves them
 *     as `from`/`to` — but the column names are `from_station`/`to_station`.
 *   - `consignorGST`/`consigneeGST` contain a multi-letter acronym, so
 *     `toSnakeCase` inserts an underscore before every capital
 *     (`consignor_g_s_t`) instead of treating `GST` as one unit — but the
 *     column names are `consignor_gst`/`consignee_gst`.
 * Keyed by the (incorrect) key `objectToSnakeCase` actually produces, so
 * `toRow` can look each one up and rename it in place. */
const COLUMN_RENAMES: Record<string, string> = {
  from: "from_station",
  to: "to_station",
  consignor_g_s_t: "consignor_gst",
  consignee_g_s_t: "consignee_gst",
};

/** Inverse of `COLUMN_RENAMES`, keyed by the real DB column name, so
 * `fromRow` can rename each one back to the key `objectToCamelCase` needs
 * to see in order to reconstruct `from`/`to`/`consignorGST`/`consigneeGST`. */
const REVERSE_COLUMN_RENAMES: Record<string, string> = Object.fromEntries(
  Object.entries(COLUMN_RENAMES).map(([alias, dbColumn]) => [dbColumn, alias])
);

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toRow(values: LR) {
  const row = objectToSnakeCase(values);

  for (const [wrongKey, dbColumn] of Object.entries(COLUMN_RENAMES)) {
    if (wrongKey in row) {
      row[dbColumn] = row[wrongKey];
      delete row[wrongKey];
    }
  }

  for (const field of OPTIONAL_DATE_FIELDS) {
    row[toSnakeCase(field)] = emptyToNull(values[field]);
  }

  const calc = calculateLR(values);
  row.bill_amount = calc.billAmount;
  row.lorry_hire_amount = calc.lorryHireAmount;
  row.profit_amount = calc.profit;

  return row;
}

/** Supabase returns raw snake_case columns; `id`/`created_at` and the three
 * computed commercial columns pass through explicitly since they live
 * outside the `LR` domain type. */
function fromRow(row: Record<string, unknown>): LRRecord {
  const {
    id,
    created_at,
    updated_at,
    bill_amount,
    lorry_hire_amount,
    profit_amount,
    created_by,
    updated_by,
    assigned_to,
    entry_status,
    ...rest
  } = row;

  for (const [dbColumn, correctKey] of Object.entries(REVERSE_COLUMN_RENAMES)) {
    if (dbColumn in rest) {
      rest[correctKey] = rest[dbColumn];
      delete rest[dbColumn];
    }
  }

  const lr = objectToCamelCase<LR>(rest);

  for (const field of OPTIONAL_DATE_FIELDS) {
    if (lr[field] == null) {
      (lr as Record<string, unknown>)[field] = "";
    }
  }

  return {
    ...lr,
    id: id as number,
    billAmount: (bill_amount as number | null) ?? 0,
    lorryHireAmount: (lorry_hire_amount as number | null) ?? 0,
    profitAmount: (profit_amount as number | null) ?? 0,
    createdBy: (created_by as string | null) ?? null,
    updatedBy: (updated_by as string | null) ?? null,
    assignedTo: (assigned_to as string | null) ?? null,
    entryStatus: entry_status === "draft" ? "draft" : "final",
    created_at: created_at as string | undefined,
    updated_at: updated_at as string | undefined,
  };
}

/* ==========================================================
   GET ALL LRs
========================================================== */

export async function getLRs(): Promise<LRRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

/* ==========================================================
   GET ONE LR
========================================================== */

export async function getLR(id: number): Promise<LRRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   CREATE LR
========================================================== */

export async function createLR(values: LR): Promise<LRRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(toRow(values))
    .select()
    .single();

  if (error) throw error;

  const record = fromRow(data);
  if (record.entryStatus !== "draft") {
    void emitNotificationEvent({
      ruleKey: "lr.created",
      title: `LR ${record.lrNumber} created`,
      body: `${record.consignor} → ${record.consignee}`,
      href: "/lr",
      payload: { lrId: record.id, lrNumber: record.lrNumber },
    });
  }
  return record;
}

export async function updateLR(id: number, values: LR): Promise<LRRecord> {
  // `id`/`created_at` are server-owned and must never reach the update
  // payload. (The edit dialog seeds its state from the full DB record, so
  // the caller can't be trusted to have already excluded them.)
  const sanitized = omitServerFields(values as unknown as Record<string, unknown>) as LR;

  const { data, error } = await supabase
    .from(TABLE)
    .update(toRow(sanitized))
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  const record = fromRow(data);

  if (record.entryStatus === "draft") {
    return record;
  }

  // Keep linked Delivery Challans (matched by `lr_number`) in sync for
  // LR-derived snapshot fields only: qty ← loadingWeight, po_number ←
  // poNumber. po_date / by_name / hsn and other DC fields stay untouched.
  await syncDeliveryChallanFromLr(record.lrNumber, record.loadingWeight, record.poNumber);

  void emitNotificationEvent({
    ruleKey: "lr.updated",
    title: `LR ${record.lrNumber} updated`,
    body: `${record.consignor} → ${record.consignee}`,
    href: "/lr",
    payload: { lrId: record.id, lrNumber: record.lrNumber },
  });

  return record;
}

/* ==========================================================
   REASSIGN LR (admin-only)
   A dedicated, minimal update — touches ONLY `assigned_to`, never the
   rest of the LR — so it can't accidentally overwrite any other field.
   The `lrs_update_own_or_admin` RLS policy (migration 017) additionally
   guarantees a non-admin caller's request is rejected by the database
   itself, not just hidden in the UI.
========================================================== */

export async function reassignLR(id: number, assignedTo: string): Promise<LRRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ assigned_to: assignedTo })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   DELETE LR
========================================================== */

export async function deleteLR(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;

  void emitNotificationEvent({
    ruleKey: "lr.deleted",
    title: "LR deleted",
    body: `LR record #${id} was deleted.`,
    href: "/lr",
    payload: { lrId: id },
  });
}
