import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

/**
 * ASN Creation — limited-use operational record that references an
 * existing LR. LR-derived fields are snapshotted at save time.
 *
 * Manual: asnDate, supplierTareWeight, expectedTimeOfArrival, roadPermit,
 * and the three slip file URLs.
 *
 * Calculated: supplierGrossWeight = supplierTareWeight + supplierNetWeight.
 */
export const asnSchema = z.object({
  asnNumber: z.string().trim(),
  asnDate: z.string().trim().min(1, "ASN date is required."),

  lrNumber: z.string().trim().min(1, "LR number is required."),
  lrDate: z.string().trim(),

  vehicleNumber: z.string().trim(),
  driverName: z.string().trim(),
  driverContact: z.string().trim(),

  challanInvoiceNumber: z.string().trim(),
  challanInvoiceDate: z.string().trim(),

  supplierTareWeight: z
    .number()
    .min(0, "Supplier tare weight must be 0 or greater."),
  supplierNetWeight: z.number().min(0),
  supplierGrossWeight: z.number().min(0),
  challanQty: z.number().min(0),

  expectedTimeOfArrival: z
    .string()
    .trim()
    .min(1, "Expected time of arrival is required."),
  roadPermit: z.string().trim().min(1, "Road permit is required."),

  weightmentSlipUrl: z.string().trim(),
  challanCopySlipUrl: z.string().trim(),
  lrCopySlipUrl: z.string().trim(),
});

export type Asn = z.infer<typeof asnSchema>;

export function validateAsn(values: Asn) {
  return getFieldErrors(asnSchema, values);
}

/** Gross = tare + net (MT). Never negative. */
export function calcSupplierGrossWeight(tare: number, net: number): number {
  const gross = (Number(tare) || 0) + (Number(net) || 0);
  return gross < 0 ? 0 : Math.round(gross * 1000) / 1000;
}
