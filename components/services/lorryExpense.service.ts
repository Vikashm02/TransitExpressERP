import { supabase } from "@/lib/supabase";
import { objectToCamelCase, objectToSnakeCase, omitServerFields } from "@/lib/caseMapping";
import type {
  LorryExpense,
  LorryExpenseStatus,
} from "@/components/lorryExpense/lorryExpense.schema";
import { emitNotificationEvent } from "@/components/services/notification.service";

/** A persisted Financials / Lorry Expense row — one per LR (`lr_id` UNIQUE). */
export interface LorryExpenseRecord extends LorryExpense {
  id: number;
  /** Draft vs finalized entry (migration 034). Defaults to final. */
  entryStatus: "draft" | "final";
  created_at?: string;
}

function normalizeExpenseStatus(value: unknown): LorryExpenseStatus {
  return value === "pending" ? "pending" : "completed";
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
  const { id, created_at, updated_at: _updated_at, entry_status, ...rest } = row;

  const expense = objectToCamelCase<LorryExpense>(rest);
  const record = expense as Record<string, unknown>;

  for (const key of DATE_KEYS) {
    if (record[key] == null) record[key] = "";
  }

  if (record.driverAdvance2 == null) record.driverAdvance2 = 0;
  if (record.detentionCharges == null) record.detentionCharges = 0;
  if (record.brokerName == null) record.brokerName = "";
  if (record.beneficiaryName == null) record.beneficiaryName = "";
  if (record.stChalan == null) record.stChalan = 0;
  if (record.tdsPercentage == null) record.tdsPercentage = 0;
  if (record.otherDeduction == null) record.otherDeduction = 0;
  if (record.finalAmountPaid == null) record.finalAmountPaid = 0;
  if (record.remarks == null) record.remarks = "";
  record.expenseStatus = normalizeExpenseStatus(record.expenseStatus);

  return {
    ...(record as LorryExpense),
    id: id as number,
    entryStatus: entry_status === "draft" ? "draft" : "final",
    created_at: created_at as string | undefined,
  };
}

export async function getLorryExpenses(): Promise<LorryExpenseRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map(fromRow);
}

export async function getLorryExpenseByLrId(lrId: number): Promise<LorryExpenseRecord | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("lr_id", lrId)
    .maybeSingle();

  if (error) throw error;

  return data ? fromRow(data) : null;
}

/** Distinct non-empty broker names from saved Financials rows (DB-backed suggestions). */
export async function getBrokerNameSuggestions(): Promise<string[]> {
  const { data, error } = await supabase.from(TABLE).select("broker_name");
  if (error) throw error;
  return uniqueNonEmpty((data ?? []).map((row) => String(row.broker_name ?? "")));
}

/** Distinct non-empty beneficiary names from saved Financials rows. */
export async function getBeneficiaryNameSuggestions(): Promise<string[]> {
  const { data, error } = await supabase.from(TABLE).select("beneficiary_name");
  if (error) throw error;
  return uniqueNonEmpty((data ?? []).map((row) => String(row.beneficiary_name ?? "")));
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
}

export async function createLorryExpense(values: LorryExpense): Promise<LorryExpenseRecord> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(toRow(values))
    .select()
    .single();

  if (error) throw error;

  const record = fromRow(data);
  if (record.entryStatus !== "draft") {
    void emitNotificationEvent({
      ruleKey: "financials.created",
      title: "Financials created",
      body: `Financial entry for LR #${record.lrId}`,
      href: "/lorry-expenses",
      payload: { id: record.id, lrId: record.lrId },
    });
  }
  return record;
}

export async function updateLorryExpense(id: number, values: LorryExpense): Promise<LorryExpenseRecord> {
  const sanitized = omitServerFields(values as unknown as Record<string, unknown>) as LorryExpense;

  const { data, error } = await supabase
    .from(TABLE)
    .update(toRow(sanitized))
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  const record = fromRow(data);
  if (record.entryStatus !== "draft") {
    void emitNotificationEvent({
      ruleKey: "financials.updated",
      title: "Financials updated",
      body: `Financial entry for LR #${record.lrId}`,
      href: "/lorry-expenses",
      payload: { id: record.id, lrId: record.lrId },
    });

    if (
      values.finalAmountPaid != null ||
      values.stChalan != null ||
      values.otherDeduction != null ||
      values.tdsPercentage != null ||
      values.balancePaidOn != null
    ) {
      void emitNotificationEvent({
        ruleKey: "financials.settlement_updated",
        title: "Settlement updated",
        body: `Settlement fields changed for LR #${record.lrId}`,
        href: "/lorry-expenses",
        payload: { id: record.id, lrId: record.lrId },
      });
    }
  }

  return record;
}

export async function deleteLorryExpense(id: number): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) throw error;
}
