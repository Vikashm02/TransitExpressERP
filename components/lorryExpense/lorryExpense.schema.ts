import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

function nonNegativeNumber(message: string) {
  return z.number().min(0, message);
}

/** Same closed NIL/1% choice as pods.tds_percentage (migration 017/026). */
export const LORRY_EXPENSE_TDS_PERCENTAGE_OPTIONS = [0, 1] as const;

/**
 * Lorry Expenses: LR-side expense/settlement tracking (one record per LR).
 * `driverAdvance` is Driver Advance 1 in the UI; dates and Advance 2 /
 * Detention / Broker / POD-moved settlement fields are additive (026).
 */
export const lorryExpenseSchema = z.object({
  lrId: z.number().int().positive("Select an LR."),
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
  stChalan: nonNegativeNumber("Cannot be negative."),
  tdsPercentage: z.number().refine(
    (value) => LORRY_EXPENSE_TDS_PERCENTAGE_OPTIONS.includes(value as 0 | 1),
    { message: "TDS must be NIL or 1%." }
  ),
  otherDeduction: nonNegativeNumber("Cannot be negative."),
  balancePaidOn: z.string().trim(),
});

export type LorryExpense = z.infer<typeof lorryExpenseSchema>;

export function validateLorryExpense(values: LorryExpense) {
  return getFieldErrors(lorryExpenseSchema, values);
}
