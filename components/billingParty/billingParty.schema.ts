import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

/**
 * Billing Party Master — deliberately separate from the Customer Master
 * (mirrors its shape/conventions exactly) so an admin can maintain an
 * approved, verified list of financial billing entities without staff
 * accidentally picking a consignor/consignee record instead.
 */
export const BILLING_PARTY_STATUS_OPTIONS = ["Active", "Inactive"] as const;

const GST_PATTERN = /^[0-9A-Z]{15}$/;
const MOBILE_PATTERN = /^\d{10}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const billingPartySchema = z.object({
  code: z.string(),
  name: z.string().trim().min(1, "Billing party name is required."),
  gst: z
    .string()
    .trim()
    .refine((value) => value === "" || GST_PATTERN.test(value), {
      message: "Enter a valid 15-character GST number.",
    }),
  mobile: z
    .string()
    .trim()
    .refine((value) => value === "" || MOBILE_PATTERN.test(value), {
      message: "Enter a valid 10-digit mobile number.",
    }),
  email: z
    .string()
    .trim()
    .refine((value) => value === "" || EMAIL_PATTERN.test(value), {
      message: "Enter a valid email address.",
    }),
  city: z.string().trim(),
  address: z.string().trim(),
  status: z.enum(BILLING_PARTY_STATUS_OPTIONS),
  // Used by the Billing module: auto-filled onto a new Bill when this
  // Billing Party is selected (see components/billing).
  poNumber: z.string().trim(),
  concernPerson: z.string().trim(),
  // Manually-entered prefix (e.g. "ACC", "ZIGMA") used to build Credit
  // Note / Debit Note numbers ({shortCode}-CN-001, {shortCode}-DN-001).
  // Deliberately never auto-derived from `name` — kept separate from the
  // existing sequential `code` (e.g. "BP001").
  shortCode: z.string().trim(),
  // Agreed/default number of days this party normally takes to pay
  // after a Bill is submitted (e.g. 15, 30) — used by the Outstanding
  // Payment report's Overdue calculation. Distinct from Bill Date,
  // Credit Note Date, LR Date, and POD Date.
  paymentCycleDays: z.number().int().min(0, "Payment cycle cannot be negative."),
});

export type BillingPartyMaster = z.infer<typeof billingPartySchema>;
export type BillingPartyMasterStatus = BillingPartyMaster["status"];

export function validateBillingParty(values: BillingPartyMaster) {
  return getFieldErrors(billingPartySchema, values);
}
