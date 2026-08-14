import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

/**
 * Delivery Challan: created from an existing LR. Most party / material /
 * vehicle / qty / poNumber fields are snapshotted from the LR (and kept
 * in sync on LR save for qty + poNumber). Manual entry fields are
 * `byName`, `poDate`, and `hsn`.
 *
 * `qty` is the LR's Actual Weight (`loadingWeight` on the LR form /
 * print — there is no separate `actualWeight` column).
 */
export const deliveryChallanSchema = z.object({
  lrNumber: z.string().trim().min(1, "LR number is required."),
  lrDate: z.string().trim().min(1, "LR date is required."),

  consignor: z.string().trim().min(1, "Consignor is required."),
  consignorAddress: z.string().trim().min(1, "Consignor address is required."),
  consignorGst: z.string().trim(),

  consignee: z.string().trim().min(1, "Consignee is required."),
  consigneeAddress: z.string().trim().min(1, "Consignee address is required."),
  consigneeGst: z.string().trim(),

  byName: z.string().trim().min(1, "By is required."),

  poNumber: z.string().trim().min(1, "PO Number is required."),
  poDate: z.string().trim().min(1, "PO Date is required."),

  description: z.string().trim().min(1, "Description is required."),
  qty: z.number().positive("Actual weight (QTY) must be greater than 0."),
  vehicleNumber: z.string().trim().min(1, "Vehicle number is required."),
  hsn: z.string().trim().min(1, "HSN is required."),
});

export type DeliveryChallan = z.infer<typeof deliveryChallanSchema>;

export function validateDeliveryChallan(values: DeliveryChallan) {
  return getFieldErrors(deliveryChallanSchema, values);
}
