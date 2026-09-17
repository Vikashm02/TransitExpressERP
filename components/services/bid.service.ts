import { supabase } from "@/lib/supabase";
import {
  objectToCamelCase,
  omitServerFields,
  toCamelCase,
  toSnakeCase,
} from "@/lib/caseMapping";
import type { Bid } from "@/components/bid/bid.schema";

/** A persisted transport bid row, as returned by Supabase (adds server-owned columns). */
export interface BidRecord extends Bid {
  id: string;
  billingPartyName: string;
  consignorName: string;
  consigneeName: string;
  materialName: string;
  created_at?: string;
  updated_at?: string;
}

const TABLE = "transport_bids";

/**
 * The generic toSnakeCase() inserts "_" before EVERY capital letter, so
 * consecutive-capital acronyms mistranslate (expectedLoadMT becomes
 * expected_load_m_t, which PostgREST rejects with PGRST204). These two
 * keys are mapped explicitly in both directions; every other Bid key
 * has no consecutive capitals and uses the generic mapper safely.
 * (Do not "fix" the shared helper — the whole ERP depends on it.)
 */
const ACRONYM_KEYS = [
  ["totalQuantityMT", "total_quantity_mt"],
  ["expectedLoadMT", "expected_load_mt"],
] as const;

function toBidSnakeCase(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const fixed = ACRONYM_KEYS.find(([camel]) => camel === key);
    result[fixed ? fixed[1] : toSnakeCase(key)] = value;
  }
  return result;
}

/** Numeric columns arrive as number|string depending on the driver; coerce safely. */
function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const NUMERIC_KEYS = [
  "distanceKm",
  "totalQuantityMT",
  "expectedLoadMT",
  "marketVehicleQuote",
  "bidRate",
] as const;

/** Master-ID columns: DB NULL (unspecified) becomes form-state 0 (blank select). */
const ID_KEYS = ["billingPartyId", "consignorId", "consigneeId", "materialId"] as const;

/** Supabase returns raw snake_case columns; `id`/timestamps pass through unchanged. */
function fromRow(row: Record<string, unknown>): BidRecord {
  const { id, created_at, updated_at, ...rest } = row;
  const mapped = objectToCamelCase<Bid>(rest);
  const record = mapped as Record<string, unknown>;
  // Repair the same acronym mistranslation on read: total_quantity_mt
  // generically becomes totalQuantityMt, so copy the real value over.
  for (const [camel, snake] of ACRONYM_KEYS) {
    if (snake in rest) {
      record[camel] = (rest as Record<string, unknown>)[snake];
      delete record[toCamelCase(snake)];
    }
  }

  for (const key of NUMERIC_KEYS) {
    record[key] = toNumber(record[key]);
  }
  for (const key of ID_KEYS) {
    record[key] = toNumber(record[key]);
  }
  if (record.winningRate !== null && record.winningRate !== undefined) {
    record.winningRate = toNumber(record.winningRate);
  }
  for (const key of ["bidReference", "transitTime", "resultRemarks", "notes", "materialDescription", "vehicleType"] as const) {
    if (record[key] === null || record[key] === undefined) record[key] = "";
  }
  if (record.lossReason === null) record.lossReason = null;
  // Existing rows predate the explicit basis. Their persisted quote has
  // always meant the full trip amount, so missing/invalid values are Per Trip.
  if (record.marketVehicleCostBasis !== "Per MT") record.marketVehicleCostBasis = "Per Trip";

  const source = row as Record<string, unknown>;
  return {
    ...(record as Bid),
    id: String(id),
    billingPartyName: String(source.billing_party_name ?? ""),
    consignorName: String(source.consignor_name ?? ""),
    consigneeName: String(source.consignee_name ?? ""),
    materialName: String(source.material_name ?? ""),
    created_at: created_at as string | undefined,
    updated_at: updated_at as string | undefined,
  };
}

/* ==========================================================
   GET ALL BIDS
========================================================== */

export async function getBids(): Promise<BidRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
}

/* ==========================================================
   GET ONE BID
========================================================== */

export async function getBid(id: string): Promise<BidRecord> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).single();

  if (error) throw error;

  return fromRow(data as Record<string, unknown>);
}

/* ==========================================================
   CREATE BID
========================================================== */

/** Blank form values become NULL for nullable columns so "not provided"
 * is never stored as a real zero (or empty vehicle type). Blank postedAt
 * is omitted so the database now() default fills it. */
function toWritePayload(values: Bid): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...values };
  if (payload.consignorId === 0) payload.consignorId = null;
  if (payload.consigneeId === 0) payload.consigneeId = null;
  if (payload.materialId === 0) payload.materialId = null;
  if (payload.distanceKm === 0) payload.distanceKm = null;
  if (payload.vehicleType === "") payload.vehicleType = null;
  if (payload.totalQuantityMT === 0) payload.totalQuantityMT = null;
  if (payload.expectedLoadMT === 0) payload.expectedLoadMT = null;
  if (payload.marketVehicleQuote === 0) payload.marketVehicleQuote = null;
  if (payload.bidRate === 0) payload.bidRate = null;
  if (payload.bidRateBasis === "") payload.bidRateBasis = null;
  if (payload.postedAt === "") delete payload.postedAt;
  return payload;
}

export async function createBid(values: Bid): Promise<BidRecord> {
  // Snapshot names travel with the payload for immediate UI use; the
  // database trigger re-freezes them from the master rows at write time.
  const { data, error } = await supabase
    .from(TABLE)
    .insert(toBidSnakeCase(toWritePayload(values)))
    .select()
    .single();

  if (error) throw error;

  return fromRow(data as Record<string, unknown>);
}

/* ==========================================================
   UPDATE BID
========================================================== */

export async function updateBid(id: string, values: Bid): Promise<BidRecord> {
  // `id`/timestamps/snapshots are server-owned — none may ever reach the
  // update payload. Snapshot names are re-frozen by the trigger.
  const { ...updatable } = omitServerFields(toWritePayload(values));
  for (const key of ["billingPartyName", "consignorName", "consigneeName", "materialName"] as const) {
    delete (updatable as Record<string, unknown>)[key];
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update(toBidSnakeCase(updatable))
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return fromRow(data as Record<string, unknown>);
}
