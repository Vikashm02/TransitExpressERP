import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

function nonNegativeNumber(message: string) {
  return z.number().min(0, message);
}

/** Same closed NIL/1% choice as pods.tds_percentage (migration 017/026). */
export const LORRY_EXPENSE_TDS_PERCENTAGE_OPTIONS = [0, 1] as const;

/** Expense entry workflow status (migration 032). */
export const LORRY_EXPENSE_STATUS_OPTIONS = ["pending", "completed"] as const;
export type LorryExpenseStatus = (typeof LORRY_EXPENSE_STATUS_OPTIONS)[number];

export const LORRY_EXPENSE_STATUS_SELECT_OPTIONS = [
  {
    value: "pending",
    label: "Pending",
  },
  {
    value: "completed",
    label: "Completed",
  },
] as const;

/**
 * Financials (lorry_expenses): expense/settlement per LR.
 * Billing/hire rates live on the linked LR and are edited via Financials UI
 * but saved back to `lrs`. `dieselAdvance` remains in the schema for
 * historical rows (hidden from new-entry UI).
 */
export const lorryExpenseSchema = z.object({
  lrId: z.number().int().positive("Select an LR."),
  expenseStatus: z.enum(LORRY_EXPENSE_STATUS_OPTIONS),
  /** Draft vs finalized Financials entry (migration 034). */
  entryStatus: z.enum(["draft", "final"]).default("final"),
  driverAdvance: nonNegativeNumber("Cannot be negative."),
  driverAdvance1Date: z.string().trim(),
  driverAdvance2: nonNegativeNumber("Cannot be negative."),
  driverAdvance2Date: z.string().trim(),
  dieselAdvance: nonNegativeNumber("Cannot be negative."),
  loadingCharges: nonNegativeNumber("Cannot be negative."),
  unloadingCharges: nonNegativeNumber("Cannot be negative."),
  detentionCharges: nonNegativeNumber("Cannot be negative."),
  hamali: nonNegativeNumber("Cannot be negative."),
  commission: nonNegativeNumber("Cannot be negative."),
  otherExpense: nonNegativeNumber("Cannot be negative."),
  brokerName: z.string().trim(),
  beneficiaryName: z.string().trim(),
  stChalan: nonNegativeNumber("Cannot be negative."),
  tdsPercentage: z.number().refine(
    (value) => LORRY_EXPENSE_TDS_PERCENTAGE_OPTIONS.includes(value as 0 | 1),
    { message: "TDS must be NIL or 1%." }
  ),
  otherDeduction: nonNegativeNumber("Cannot be negative."),
  finalAmountPaid: nonNegativeNumber("Cannot be negative."),
  balancePaidOn: z.string().trim(),
  remarks: z.string().trim(),
});

export type LorryExpense = z.infer<typeof lorryExpenseSchema>;

export function validateLorryExpense(values: LorryExpense) {
  return getFieldErrors(lorryExpenseSchema, values);
}

/** Commercial fields edited in Financials and persisted on the LR. */
export interface FinancialsLrCommercial {
  billRate: number;
  billRateType: string;
  guaranteedWeight: number;
  lorryHireRate: number;
  lorryHireType: string;
  lorryHireGuaranteedWeight: number;
}
