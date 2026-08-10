import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

/**
 * A Bill (Tax Invoice) generated against a set of selected, unbilled LRs.
 * Per-LR weight/rate/freight are computed by `billingCalculations.ts` and
 * passed alongside this schema at save time — they are not user-entered
 * fields, so they live outside this Zod object (mirrors how `lr.schema.ts`
 * keeps `billAmount` out of the editable LR schema).
 */
export const billSchema = z.object({
  // Auto-generated from Company Master's Invoice numbering settings at
  // save time (see BillingListPage.tsx) — never typed by the user.
  billNumber: z.string().trim(),
  billDate: z.string().trim().min(1, "Bill date is required."),
  billingPartyId: z.number().int().positive("Billing party is required."),
  poNumber: z.string().trim(),
  // `lrs.id` is a `uuid` column live (not `bigint`), so each entry here is
  // an LR primary-key string, not a number — matching `LRLineInput.lrId`
  // in billing.service.ts and `selectedLrIds` in BillDialog.tsx.
  lrIds: z.array(z.string().min(1, "Invalid LR id.")).min(1, "Select at least one LR to bill."),
});

export type Bill = z.infer<typeof billSchema>;

export function validateBill(values: Bill) {
  return getFieldErrors(billSchema, values);
}
