import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields } from "@/lib/caseMapping";
import type { LorryExpense } from "@/components/lorryExpense/lorryExpense.schema";

/** A persisted Lorry Expense row — one per LR (`lr_id` is UNIQUE, see
 * migration 017). Visibility/writes are additionally enforced by RLS
 * (via the linked LR's `assigned_to`), so `getLorryExpenses()` already
 * returns only the current user's own records (or all, for admin). */
export interface LorryExpenseRecord extends LorryExpense {
  id: number;
  created_at?: string;
}

const TABLE = "lorry_expenses";

const DATE_KEYS = [
  "driverAdvance1Date",
  "driverAdvance2Date",
  "balancePaidOn",
] as const;

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toRow(values: LorryExpense) {
  const row = objectToSnakeCase(values);
  row.driver_advance_1_date = emptyToNull(values.driverAdvance1Date);
  row.driver_advance_2_date = emptyToNull(values.driverAdvance2Date);
  row.balance_paid_on = emptyToNull(values.balancePaidOn);
  return row;
}

function fromRow(row: Record<string, unknown>): LorryExpenseRecord {
  const { id, created_at, updated_at: _updated_at, ...rest } = row;

  const expense = objectToCamelCase<LorryExpense>(rest);
  const record = expense as Record<string, unknown>;

  for (const key of DATE_KEYS) {
    if (record[key] == null) record[key] = "";
  }

  // Safe defaults if a row is read before migration 026 is applied.
  if (record.driverAdvance2 == null) record.driverAdvance2 = 0;
  if (record.detentionCharges == null) record.detentionCharges = 0;
  if (record.brokerName == null) record.brokerName = "";
  if (record.stChalan == null) record.stChalan = 0;
  if (record.tdsPercentage == null) record.tdsPercentage = 0;
  if (record.otherDeduction == null) record.otherDeduction = 0;

  return {
    ...(record as LorryExpense),
    id: id as number,
    created_at: created_at as string | undefined,
  };
}

/* ==========================================================
   GET ALL LORRY EXPENSES
========================================================== */

export async function getLorryExpenses(): Promise<LorryExpenseRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

/* ==========================================================
   GET ONE LORRY EXPENSE BY LR
========================================================== */

export async function getLorryExpenseByLrId(lrId: number): Promise<LorryExpenseRecord | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("lr_id", lrId)
    .maybeSingle();

  if (error) throw error;

  return data ? fromRow(data) : null;
}

/* ==========================================================
   CREATE LORRY EXPENSE
========================================================== */

export async function createLorryExpense(values: LorryExpense): Promise<LorryExpenseRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(toRow(values))
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   UPDATE LORRY EXPENSE
========================================================== */

export async function updateLorryExpense(id: number, values: LorryExpense): Promise<LorryExpenseRecord> {
  const sanitized = omitServerFields(values as unknown as Record<string, unknown>) as LorryExpense;

  const { data, error } = await supabase
    .from(TABLE)
    .update(toRow(sanitized))
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return fromRow(data);
}

/* ==========================================================
   DELETE LORRY EXPENSE (bulk-upload rollback only)
   The Lorry Expenses module has no Delete action anywhere in its UI
   (LorryExpenseListPage only ever Adds/Edits) — this exists solely so
   LorryExpenseBulkUploadDialog can perform a compensating rollback if an
   all-or-nothing bulk import fails partway through. It is intentionally
   not exported from/used by any other Lorry Expenses screen.
========================================================== */

export async function deleteLorryExpense(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}
