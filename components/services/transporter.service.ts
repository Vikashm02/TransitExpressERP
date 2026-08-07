import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase } from "@/lib/caseMapping";
import { PAYMENT_MODE_OPTIONS, type Transporter } from "@/components/transporter/transporter.schema";

/** A persisted transporter row, as returned by Supabase (adds server-owned columns). */
export interface TransporterRecord extends Transporter {
  id: number;
  created_at?: string;
}

const TABLE = "transporters";

/** Supabase returns raw snake_case columns; `id`/`created_at` pass through unchanged. */
function fromRow(row: Record<string, unknown>): TransporterRecord {
  const { id, created_at, ...rest } = row;

  return {
    id: id as number,
    created_at: created_at as string | undefined,
    ...objectToCamelCase<Transporter>(rest),
  };
}

/**
 * Business codes follow the same "TR001", "TR002", ... convention already
 * established for Customer's "C001" codes. Sequenced off the current row
 * count, which is adequate for a low-concurrency master data table.
 */
async function generateTransporterCode(): Promise<string> {
  const { count, error } = await supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true });

  if (error) throw error;

  const next = (count ?? 0) + 1;
  return `TR${String(next).padStart(3, "0")}`;
}

/**
 * Enforces the Payment Term <-> Credit Days business rule at the persistence
 * boundary too (the form/schema already guard this, but the service should
 * never trust that every caller went through the form).
 */
function normalizeCreditDays(values: Transporter): number {
  return values.paymentTerm === "Immediate" ? 0 : values.creditDays;
}

function toRow(values: Transporter) {
  return objectToSnakeCase({
    ...values,
    creditDays: normalizeCreditDays(values),
    preferredPaymentMode: values.preferredPaymentMode || PAYMENT_MODE_OPTIONS[0],
  });
}

/* ==========================================================
   GET ALL TRANSPORTERS
========================================================== */

export async function getTransporters(): Promise<TransporterRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

/* ==========================================================
   GET ONE TRANSPORTER
========================================================== */

export async function getTransporter(id: number): Promise<TransporterRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   CREATE TRANSPORTER
========================================================== */

export async function createTransporter(values: Transporter): Promise<TransporterRecord> {
  const code = values.code.trim() || (await generateTransporterCode());

  const { data, error } = await supabase
    .from(TABLE)
    .insert(toRow({ ...values, code }))
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   UPDATE TRANSPORTER
========================================================== */

export async function updateTransporter(
  id: number,
  values: Transporter
): Promise<TransporterRecord> {
  // `code` is immutable after creation — never part of the update payload.
  const { code: _code, ...updatable } = toRow(values) as Record<string, unknown> & {
    code?: string;
  };

  const { data, error } = await supabase
    .from(TABLE)
    .update(updatable)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   DELETE TRANSPORTER
========================================================== */

export async function deleteTransporter(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}
