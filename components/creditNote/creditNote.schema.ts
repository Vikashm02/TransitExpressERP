import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

/**
 * Credit Note: records money expected/credited against a Billing Party
 * where the actual amount received may be lower due to a
 * discount/deduction. `amount`, `deduction`, and the derived
 * `netAmount` (computed in creditNote.service.ts, not here) are all
 * preserved — never collapsed into a single value.
 */
export const creditNoteSchema = z
  .object({
    // Auto-generated as {Billing Party Short Code}-CN-{seq} at save time
    // (see CreditNoteListPage.tsx) — never typed by the user, mirrors
    // how billing.schema.ts leaves `billNumber` blank until generation.
    creditNoteNumber: z.string().trim(),
    noteDate: z.string().trim().min(1, "Date is required."),
    billingPartyId: z.number().int().positive("Billing party is required."),
    amount: z.number().positive("Amount must be greater than 0."),
    deduction: z.number().min(0, "Cannot be negative."),
    gstPercentage: z.number().min(0, "Cannot be negative.").max(100, "Cannot exceed 100."),
    remarks: z.string().trim(),
  })
  .refine((values) => values.deduction <= values.amount, {
    message: "Discount/Deduction cannot exceed the Amount.",
    path: ["deduction"],
  });

export type CreditNote = z.infer<typeof creditNoteSchema>;

export function validateCreditNote(values: CreditNote) {
  return getFieldErrors(creditNoteSchema, values);
}
