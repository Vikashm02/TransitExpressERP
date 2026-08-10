import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

function nonNegativeNumber(message: string) {
  return z.number().min(0, message);
}

/**
 * Lorry Expenses: the LR-side expense/settlement tracking that used to
 * live directly on the LR Entry form (Driver Advance, Diesel Advance,
 * Loading/Unloading Charges, Hamali, Commission, Other Expense). Now a
 * standalone module — exactly one record per LR (enforced by a unique
 * DB constraint, see migration 017) — and its total is intentionally
 * NEVER subtracted from LR profit again (see lrCalculations.ts).
 */
export const lorryExpenseSchema = z.object({
  lrId: z.number().int().positive("Select an LR."),
  driverAdvance: nonNegativeNumber("Cannot be negative."),
  dieselAdvance: nonNegativeNumber("Cannot be negative."),
  loadingCharges: nonNegativeNumber("Cannot be negative."),
  unloadingCharges: nonNegativeNumber("Cannot be negative."),
  hamali: nonNegativeNumber("Cannot be negative."),
  commission: nonNegativeNumber("Cannot be negative."),
  otherExpense: nonNegativeNumber("Cannot be negative."),
});

export type LorryExpense = z.infer<typeof lorryExpenseSchema>;

export function validateLorryExpense(values: LorryExpense) {
  return getFieldErrors(lorryExpenseSchema, values);
}
