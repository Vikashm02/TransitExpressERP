import { z } from "zod";

export const purchaseOrderSchema = z.object({
  billingPartyId: z.number().int().positive("Select a billing party."),
  materialId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  consignor: z.string().trim().min(1, "Select a consignor."),
  consigneeId: z.number().int().positive("Select a consignee."),
  poNumber: z.string().trim().min(1, "PO number is required.").max(100).transform((s) => s.toUpperCase()),
  issueDate: z.iso.date("Select a valid issue date."),
  allottedWeight: z.number().finite().nonnegative("Allotted weight cannot be negative."),
  status: z.enum(["Active", "Inactive"]),
  /** Temporary PO: number will be replaced by the permanent one later (Make Permanent). */
  isTemporary: z.boolean().optional(),
});

export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
