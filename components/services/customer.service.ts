import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields } from "@/lib/caseMapping";
import type { Customer } from "@/components/customer/customer.schema";

/** A persisted customer row, as returned by Supabase (adds server-owned columns). */
export interface CustomerRecord extends Customer {
  id: number;
  created_at?: string;
}

const TABLE = "customers";

/** Matches auto-generated codes only: C + digits (e.g. C001, C026, C1000). */
const CUSTOMER_CODE_PATTERN = /^C(\d+)$/;

const CODE_ALLOCATION_ATTEMPTS = 5;

/** Supabase returns raw snake_case columns; `id`/`created_at` pass through unchanged. */
function fromRow(row: Record<string, unknown>): CustomerRecord {
  const { id, created_at, ...rest } = row;
  const mapped = objectToCamelCase<Customer>(rest);

  return {
    id: id as number,
    created_at: created_at as string | undefined,
    ...mapped,
    entryStatus: mapped.entryStatus === "draft" ? "draft" : "final",
  };
}

function formatCustomerCode(n: number): string {
  return `C${String(n).padStart(3, "0")}`;
}

/**
 * Next auto code from existing values: max numeric suffix among `C###`
 * patterns + 1. Non-matching codes are ignored so historical outliers
 * cannot break allocation. Pure helper — safe to unit-test without DB.
 */
export function nextCustomerCodeFromExisting(codes: readonly string[]): string {
  let max = 0;

  for (const raw of codes) {
    const match = CUSTOMER_CODE_PATTERN.exec(raw.trim());
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }

  return formatCustomerCode(max + 1);
}

/**
 * Allocates the next unused C### by scanning existing codes (max + 1),
 * not by row count — so gaps from deletes do not collide.
 */
async function generateCustomerCode(): Promise<string> {
  const { data, error } = await supabase.from(TABLE).select("code");

  if (error) throw error;

  const codes = (data ?? []).map((row) => String((row as { code: string }).code ?? ""));
  return nextCustomerCodeFromExisting(codes);
}

/** True only for unique violations on customers.code (not other 23505s). */
function isCustomerCodeUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const e = error as { code?: string; message?: string; details?: string };
  if (e.code !== "23505") return false;

  const haystack = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();
  return (
    haystack.includes("customers_code_key") ||
    haystack.includes("customers_code") ||
    /\(code\)=/.test(haystack)
  );
}

/* ==========================================================
   GET ALL CUSTOMERS
========================================================== */

export async function getCustomers(): Promise<CustomerRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

/**
 * Restricted Customer Master lookup for LR Consignor / Consignee only.
 * Uses get_lr_customer_lookup (migration 051) — requires lr create/edit,
 * NOT customers:view. Does not replace getCustomers() / Customer Master.
 */
export type LrCustomerLookupRow = Pick<
  CustomerRecord,
  "id" | "name" | "code" | "gst" | "city" | "address" | "entryStatus"
>;

export async function getLrCustomerLookup(): Promise<LrCustomerLookupRow[]> {
  const { data, error } = await supabase.rpc("get_lr_customer_lookup");

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
      address: String(row.address ?? ""),
      entryStatus,
    };
  });
}

/* ==========================================================
   GET ONE CUSTOMER
========================================================== */

export async function getCustomer(id: number): Promise<CustomerRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   CREATE CUSTOMER
========================================================== */

export async function createCustomer(values: Customer): Promise<CustomerRecord> {
  const providedCode = values.code.trim();

  // Explicit codes (e.g. bulk upload): single attempt — do not invent a
  // different code on conflict.
  if (providedCode) {
    const { data, error } = await supabase
      .from(TABLE)
      .insert(objectToSnakeCase({ ...values, code: providedCode }))
      .select()
      .single();

    if (error) throw error;
    return fromRow(data);
  }

  // Auto-allocated codes: re-read max on each attempt so a concurrent
  // insert that won the race is reflected before we retry.
  let lastError: unknown;

  for (let attempt = 0; attempt < CODE_ALLOCATION_ATTEMPTS; attempt++) {
    const code = await generateCustomerCode();

    const { data, error } = await supabase
      .from(TABLE)
      .insert(objectToSnakeCase({ ...values, code }))
      .select()
      .single();

    if (!error) return fromRow(data);

    if (!isCustomerCodeUniqueViolation(error)) throw error;

    lastError = error;
  }

  throw lastError;
}

/* ==========================================================
   UPDATE CUSTOMER
========================================================== */

export async function updateCustomer(
  id: number,
  values: Customer
): Promise<CustomerRecord> {
  // `code` is immutable after creation, and `id`/`created_at` are
  // server-owned — none of the three may ever reach the update payload.
  // (Edit dialogs seed their state from the full DB record, so callers
  // can't be trusted to have already excluded the server-owned fields.)
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
   DELETE CUSTOMER
========================================================== */

export async function deleteCustomer(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}
