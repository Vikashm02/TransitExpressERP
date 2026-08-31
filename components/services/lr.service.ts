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
 * `createdBy`/`assignedTo`/`draftCreatedBy` are likewise NOT part of the
 * editable `LR` schema — they are entirely controlled server-side by
 * ownership/audit triggers (017 / 034 / 064), never sent by the client on
 * create/update. After migration 064, finalized `createdBy` is the first
 * finalizer; `draftCreatedBy` is who reserved the numbered draft (null for
 * direct final / bulk). `null` createdBy means "created before the
 * ownership migration" rather than an invented owner. Reassigning
 * `assignedTo` for an existing LR goes through the dedicated `reassignLR()`
 * below, not `updateLR()`. */
export interface LRRecord extends LR {
  id: number;
  billAmount: number;
  lorryHireAmount: number;
  profitAmount: number;
  createdBy: string | null;
  updatedBy: string | null;
  /** Immutable draft starter (migration 064). Null for direct-final LRs. */
  draftCreatedBy: string | null;
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

/** Form/schema expect `number`; DB may return null (or numeric-as-string). */
function asLrNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Form/schema expect `string`; DB may return null for nullable text columns. */
function asLrString(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : String(value);
}

/** Numeric LR domain fields (matches `lr.schema` / `emptyLR`). */
const LR_NUMBER_FIELDS = [
  "packages",
  "loadingWeight",
  "unloadingWeight",
  "chargedWeight",
  "invoiceValue",
  "billRate",
  "guaranteedWeight",
  "lorryHireRate",
  "lorryHireGuaranteedWeight",
  "driverAdvance",
  "dieselAdvance",
  "stChallan",
  "loadingCharges",
  "unloadingCharges",
  "hamali",
  "commission",
  "otherExpense",
] as const;

/** String LR domain fields (excludes dates — those use OPTIONAL_DATE_FIELDS). */
const LR_STRING_FIELDS = [
  "lrNumber",
  "lrDate",
  "bookingBranch",
  "customer",
  "consignor",
  "consignorGST",
  "consignorAddress",
  "consignee",
  "consigneeGST",
  "consigneeAddress",
  "vehicleNumber",
  "vehicleType",
  "transporter",
  "driverName",
  "driverMobile",
  "from",
  "to",
  "material",
  "materialDescription",
  "packageType",
  "poNumber",
  "vendorCode",
  "dcNumber",
  "invoiceNumber",
  "ewayBillNumber",
  "remarks",
  "internalRemarks",
] as const;

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

  // Never persist blank lr_number as "" (UNIQUE). Callers must supply a real
  // number for inserts; empty → omit/null only for defensive updates of drafts
  // that somehow lack a number (should not happen after migration 062 RPC).
  if (!values.lrNumber?.trim()) {
    delete row.lr_number;
  } else {
    row.lr_number = values.lrNumber.trim();
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
    draft_created_by,
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
  const normalized = lr as Record<string, unknown>;

  for (const field of OPTIONAL_DATE_FIELDS) {
    if (normalized[field] == null) {
      normalized[field] = "";
    }
  }

  for (const field of LR_NUMBER_FIELDS) {
    normalized[field] = asLrNumber(normalized[field]);
  }

  for (const field of LR_STRING_FIELDS) {
    normalized[field] = asLrString(normalized[field]);
  }

  // Enum-like strings: null → same defaults as emptyLR / normal drafts.
  if (normalized.billingParty == null || normalized.billingParty === "") {
    normalized.billingParty = "Consignor";
  }
  if (normalized.billRateType == null || normalized.billRateType === "") {
    normalized.billRateType = "Fixed";
  }
  if (normalized.lorryHireType == null || normalized.lorryHireType === "") {
    normalized.lorryHireType = "Fixed";
  }
  if (normalized.freightType == null || normalized.freightType === "") {
    normalized.freightType = "To Be Billed";
  }
  if (normalized.status == null || normalized.status === "") {
    normalized.status = "Open";
  }

  normalized.lrNumber = asLrString(normalized.lrNumber);

  return {
    ...(normalized as LR),
    id: id as number,
    billAmount: asLrNumber(bill_amount),
    lorryHireAmount: asLrNumber(lorry_hire_amount),
    profitAmount: asLrNumber(profit_amount),
    createdBy: (created_by as string | null) ?? null,
    updatedBy: (updated_by as string | null) ?? null,
    draftCreatedBy: (draft_created_by as string | null) ?? null,
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

/** Targeted DC duplicate lookup — only id + lr_number for matching rows. */
export type LrDcDuplicateMatch = {
  id: LRRecord["id"];
  lrNumber: string;
};

/**
 * Find other LRs with the same DC number + DC date (informational duplicate warning).
 * Respects RLS. Does not load full LR rows.
 */
export async function findLrsByDcNumberAndDate(options: {
  dcNumber: string;
  dcDate: string;
  excludeId?: LRRecord["id"] | null;
}): Promise<LrDcDuplicateMatch[]> {
  const dcNumber = options.dcNumber.trim();
  const dcDate = options.dcDate.trim();
  if (!dcNumber || !dcDate) return [];

  let query = supabase
    .from(TABLE)
    .select("id, lr_number, dc_number, dc_date")
    .eq("dc_number", dcNumber)
    .eq("dc_date", dcDate);

  if (options.excludeId != null) {
    query = query.neq("id", options.excludeId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const seen = new Set<string>();
  const matches: LrDcDuplicateMatch[] = [];
  for (const row of data ?? []) {
    const lrNumber = String((row as { lr_number?: unknown }).lr_number ?? "").trim();
    const id = (row as { id: LRRecord["id"] }).id;
    if (!lrNumber || seen.has(lrNumber)) continue;
    seen.add(lrNumber);
    matches.push({ id, lrNumber });
  }
  return matches;
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

/**
 * First meaningful draft persist: atomically allocates the next LR number
 * and inserts entry_status=draft in one DB transaction (migration 062).
 * Do not call for updates — use updateLR and keep the existing number.
 */
export async function createNumberedLrDraft(values: LR): Promise<LRRecord> {
  const draftValues = {
    ...values,
    entryStatus: "draft" as const,
  };
  const payload = toRow(draftValues);
  // Server assigns lr_number via allocate_next_lr_number().
  delete payload.lr_number;
  delete payload.id;
  delete payload.created_at;
  delete payload.updated_at;
  delete payload.created_by;
  delete payload.updated_by;
  delete payload.draft_created_by;

  const { data, error } = await supabase.rpc("create_numbered_lr_draft", {
    p_payload: payload,
  });

  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("create_numbered_lr_draft returned no row.");
  }

  return fromRow(data as Record<string, unknown>);
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

/** Commercial fields owned by Financials — patched via update_lr_financials RPC
 * (migration 046). Does not require lr.edit and never writes non-financial LR columns. */
export type LRFinancialsCommercialPatch = {
  billRate: number;
  billRateType: string;
  guaranteedWeight: number;
  lorryHireRate: number;
  lorryHireType: string;
  lorryHireGuaranteedWeight: number;
};

/**
 * Financials-only commercial update. Calls SECURITY DEFINER
 * `update_lr_financials` which checks lorry_expenses create/edit + lr view.
 * Does not use general `updateLR()` / lr.edit RLS.
 */
export async function updateLRFinancials(
  lrId: string,
  commercial: LRFinancialsCommercialPatch
): Promise<LRRecord> {
  const { data, error } = await supabase
    .rpc("update_lr_financials", {
      p_lr_id: lrId,
      p_bill_rate: commercial.billRate,
      p_bill_rate_type: commercial.billRateType,
      p_guaranteed_weight: commercial.guaranteedWeight,
      p_lorry_hire_rate: commercial.lorryHireRate,
      p_lorry_hire_type: commercial.lorryHireType,
      p_lorry_hire_guaranteed_weight: commercial.lorryHireGuaranteedWeight,
    })
    .single();

  if (error) throw error;
  if (!data) throw new Error("Financials LR update returned no row.");

  return fromRow(data as Record<string, unknown>);
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
   OWN DRAFT LRs (read-only reminder before Create LR)
   Scoped to auth.uid() via supabase.auth.getUser() — caller
   cannot pass another user id. Does not allocate LR numbers.
   Ownership: draft_created_by (064+). Pre-064 drafts have null
   draft_created_by → fall back to created_by (still the inserter
   while the row remains draft).
========================================================== */

export async function getOwnDraftLRs(): Promise<LRRecord[]> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;

  const userId = authData.user?.id;
  if (!userId) {
    throw new Error("Not authenticated");
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("entry_status", "draft")
    .or(
      `draft_created_by.eq.${userId},and(draft_created_by.is.null,created_by.eq.${userId})`
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
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
