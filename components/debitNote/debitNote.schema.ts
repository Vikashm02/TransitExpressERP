import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

/**
 * Debit Note: a simple amount debited against a Billing Party, optionally
 * subject to GST. Simpler than Credit Note — no discount/deduction field.
 */
export const debitNoteSchema = z.object({
  // Auto-generated as {Billing Party Short Code}-DN-{seq} at save time
  // (see DebitNoteListPage.tsx) — never typed by the user, mirrors
  // creditNote.schema.ts leaving `creditNoteNumber` blank until generation.
  debitNoteNumber: z.string().trim(),
  noteDate: z.string().trim().min(1, "Date is required."),
  billingPartyId: z.number().int().positive("Billing party is required."),
  amount: z.number().positive("Amount must be greater than 0."),
  gstPercentage: z.number().min(0, "Cannot be negative.").max(100, "Cannot exceed 100."),
  remarks: z.string().trim(),
});

export type DebitNote = z.infer<typeof debitNoteSchema>;

export function validateDebitNote(values: DebitNote) {
  return getFieldErrors(debitNoteSchema, values);
}
