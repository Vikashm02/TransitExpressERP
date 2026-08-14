import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";
import { DEFAULT_BRANCH_OPTIONS, DEFAULT_FREIGHT_TYPE_OPTIONS } from "@/components/company/company.schema";

export const BILLING_PARTY_OPTIONS = ["Consignor", "Consignee"] as const;

export const BILL_RATE_TYPE_OPTIONS = [
  "Fixed",
  "Per Ton (Loading)",
  "Per Ton (Unloading)",
  "Guaranteed Weight",
] as const;

/** UI options for new/edited Lorry Hire Type selection. */
export const LORRY_HIRE_TYPE_OPTIONS = [
  "Fixed",
  "Per Ton (Loading)",
  "Per Ton (Unloading)",
  "Guaranteed Weight",
] as const;

/** Older LRs may still store the generic "Per Ton" value — accepted on
 * load/edit/validate, but not offered in the Hire Type dropdown. */
export const LEGACY_LORRY_HIRE_TYPE_OPTIONS = ["Per Ton"] as const;

const LORRY_HIRE_TYPE_SCHEMA_OPTIONS = [
  ...LORRY_HIRE_TYPE_OPTIONS,
  ...LEGACY_LORRY_HIRE_TYPE_OPTIONS,
] as const;

/** Re-exported for convenience so `LRForm`/sections don't need a second import
 * from `company.schema.ts` — the values themselves remain owned by Company Master. */
export const FREIGHT_TYPE_OPTIONS = DEFAULT_FREIGHT_TYPE_OPTIONS;
export const BOOKING_BRANCH_OPTIONS = DEFAULT_BRANCH_OPTIONS;

export const LR_STATUS_OPTIONS = ["Open", "In Transit", "Delivered", "Billed", "Cancelled"] as const;

const GST_PATTERN = /^[0-9A-Z]{15}$/;
const MOBILE_PATTERN = /^\d{10}$/;

function optionalPattern(pattern: RegExp, message: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || pattern.test(value), { message });
}

function nonNegativeNumber(message: string) {
  return z.number().min(0, message);
}

function requiredPositiveNumber(message: string) {
  return z.number().gt(0, message);
}

export const lrSchema = z
  .object({
    // ===========================
    // LR Information
    // ===========================
    // Auto-generated from Company Master Document Settings at save time
    // (see LRListPage.tsx) — never typed by the user, so it is not
    // required at the point form validation runs.
    lrNumber: z.string().trim(),
    lrDate: z.string().trim().min(1, "LR date is required."),
    bookingBranch: z.string().trim().min(1, "Booking branch is required."),
    // NOTE: this field holds the LR's Billing Party (labelled "Billing
    // Party" in the UI, selected from the separate Billing Party Master).
    // The name `customer` is kept as-is to avoid an unnecessary database
    // column rename — see BILLING_PARTY_OPTIONS below for the unrelated
    // "GST Payable By" field.
    customer: z.string().trim().min(1, "Billing party is required."),
    // "GST Payable By" on the printed LR (Consignor/Consignee) — a
    // pre-existing, unrelated concept from the new Billing Party Master.
    billingParty: z.enum(BILLING_PARTY_OPTIONS),

    // ===========================
    // Consignor
    // ===========================
    consignor: z.string().trim().min(1, "Consignor is required."),
    consignorGST: optionalPattern(GST_PATTERN, "Enter a valid 15-character GST number."),
    consignorAddress: z.string().trim(),

    // ===========================
    // Consignee
    // ===========================
    consignee: z.string().trim().min(1, "Consignee is required."),
    consigneeGST: optionalPattern(GST_PATTERN, "Enter a valid 15-character GST number."),
    consigneeAddress: z.string().trim(),

    // ===========================
    // Vehicle & Route
    // ===========================
    vehicleNumber: z
      .string()
      .trim()
      .min(1, "Vehicle number is required.")
      .transform((value) => value.toUpperCase()),
    vehicleType: z.string().trim(),
    transporter: z.string().trim(),
    driverName: z.string().trim().min(1, "Driver name is required."),
    driverMobile: z
      .string()
      .trim()
      .min(1, "Driver mobile is required.")
      .regex(MOBILE_PATTERN, "Enter a valid 10-digit mobile number."),
    from: z.string().trim().min(1, "'From' station is required."),
    to: z.string().trim().min(1, "'To' station is required."),

    // ===========================
    // Material
    // ===========================
    material: z.string().trim().min(1, "Material is required."),
    packageType: z.string().trim(),
    packages: nonNegativeNumber("Packages cannot be negative."),
    loadingWeight: requiredPositiveNumber("Loading weight is required."),
    unloadingWeight: nonNegativeNumber("Unloading weight cannot be negative."),
    chargedWeight: nonNegativeNumber("Charged weight cannot be negative."),

    // ===========================
    // Dispatch Documents
    // ===========================
    poNumber: z.string().trim(),
    vendorCode: z.string().trim(),
    dcNumber: z.string().trim(),
    dcDate: z.string().trim(),
    invoiceNumber: z.string().trim(),
    invoiceDate: z.string().trim(),
    invoiceValue: nonNegativeNumber("Invoice value cannot be negative."),
    ewayBillNumber: z.string().trim(),

    // ===========================
    // Commercial
    // ===========================
    billRate: requiredPositiveNumber("Bill rate is required."),
    billRateType: z.enum(BILL_RATE_TYPE_OPTIONS),
    guaranteedWeight: nonNegativeNumber("Guaranteed weight cannot be negative."),

    lorryHireRate: requiredPositiveNumber("Lorry hire rate is required."),
    lorryHireType: z.enum(LORRY_HIRE_TYPE_SCHEMA_OPTIONS),
    // Independent from Bill Rate's `guaranteedWeight` — Bill Rate and Lorry
    // Hire are separate commercial terms and may use different guaranteed
    // weights on the same LR.
    lorryHireGuaranteedWeight: nonNegativeNumber("Lorry hire guaranteed weight cannot be negative."),

    freightType: z.enum(FREIGHT_TYPE_OPTIONS),

    driverAdvance: nonNegativeNumber("Driver advance cannot be negative."),
    dieselAdvance: nonNegativeNumber("Diesel advance cannot be negative."),
    stChallan: nonNegativeNumber("ST challan cannot be negative."),
    loadingCharges: nonNegativeNumber("Loading charges cannot be negative."),
    unloadingCharges: nonNegativeNumber("Unloading charges cannot be negative."),
    hamali: nonNegativeNumber("Hamali cannot be negative."),
    commission: nonNegativeNumber("Commission cannot be negative."),
    otherExpense: nonNegativeNumber("Other expense cannot be negative."),

    // ===========================
    // Remarks
    // ===========================
    remarks: z.string().trim(),
    internalRemarks: z.string().trim(),

    // ===========================
    // Status
    // ===========================
    status: z.enum(LR_STATUS_OPTIONS),
  })
  .refine(
    (values) => values.billRateType !== "Guaranteed Weight" || values.guaranteedWeight > 0,
    {
      message: "Guaranteed weight is required when bill rate type is Guaranteed Weight.",
      path: ["guaranteedWeight"],
    }
  )
  .refine(
    (values) =>
      values.lorryHireType !== "Guaranteed Weight" || values.lorryHireGuaranteedWeight > 0,
    {
      message: "Guaranteed weight is required when lorry hire type is Guaranteed Weight.",
      path: ["lorryHireGuaranteedWeight"],
    }
  );

export type LR = z.infer<typeof lrSchema>;
export type BillingParty = LR["billingParty"];
export type BillRateType = LR["billRateType"];
export type LorryHireType = LR["lorryHireType"];
export type FreightType = LR["freightType"];
export type LRStatus = LR["status"];

export function validateLR(values: LR) {
  return getFieldErrors(lrSchema, values);
}
