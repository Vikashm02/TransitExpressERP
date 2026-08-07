import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

/**
 * Temporary, application-controlled list — same "swappable source" pattern
 * used for Vehicle Type / License Type. When a dedicated Transporter Type
 * Master exists, swap this constant for a value sourced from that master;
 * `TransporterForm`, this schema, and `TransporterTable` do not need to
 * change beyond this list's source.
 */
export const TRANSPORTER_TYPE_OPTIONS = ["Fleet Owner", "Broker", "Logistics Company"] as const;

/** A fixed business rule, not a swappable list — Credit Days behavior is tied to these two values. */
export const PAYMENT_TERMS_OPTIONS = ["Immediate", "Credit"] as const;

/** Informational only today; will later prefill Vendor Payments. */
export const PAYMENT_MODE_OPTIONS = ["Bank Transfer", "UPI", "Cash", "Cheque"] as const;

export const TRANSPORTER_STATUS_OPTIONS = ["Active", "Inactive"] as const;

const GSTIN_PATTERN = /^[0-9A-Z]{15}$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const MOBILE_PATTERN = /^\d{10}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEBSITE_PATTERN = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#].*)?$/i;
const PINCODE_PATTERN = /^\d{6}$/;
const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_PATTERN = /^[\w.-]+@[\w.-]+$/;

function optionalPattern(pattern: RegExp, message: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || pattern.test(value), { message });
}

export const transporterSchema = z
  .object({
    // Identity — `code` is generated server-side and immutable; never edited via the form.
    code: z.string(),
    transporterName: z.string().trim().min(1, "Transporter name is required."),
    transporterType: z.enum(TRANSPORTER_TYPE_OPTIONS),
    gstin: optionalPattern(GSTIN_PATTERN, "Enter a valid 15-character GSTIN."),
    pan: optionalPattern(PAN_PATTERN, "Enter a valid PAN (e.g. ABCDE1234F)."),

    // Contact
    contactPerson: z.string().trim(),
    mobile: optionalPattern(MOBILE_PATTERN, "Enter a valid 10-digit mobile number."),
    alternateMobile: optionalPattern(MOBILE_PATTERN, "Enter a valid 10-digit mobile number."),
    email: optionalPattern(EMAIL_PATTERN, "Enter a valid email address."),
    website: optionalPattern(WEBSITE_PATTERN, "Enter a valid website URL."),

    // Address
    address: z.string().trim(),
    city: z.string().trim(),
    state: z.string().trim(),
    pincode: optionalPattern(PINCODE_PATTERN, "Enter a valid 6-digit pincode."),

    // Banking
    accountHolderName: z.string().trim(),
    bankName: z.string().trim(),
    accountNumber: optionalPattern(ACCOUNT_NUMBER_PATTERN, "Enter a valid account number."),
    ifsc: optionalPattern(IFSC_PATTERN, "Enter a valid IFSC code."),
    upiId: optionalPattern(UPI_PATTERN, "Enter a valid UPI ID."),

    // Commercial
    paymentTerm: z.enum(PAYMENT_TERMS_OPTIONS),
    creditDays: z.number().int("Credit days must be a whole number.").min(0, "Credit days cannot be negative."),
    creditLimit: z.number().min(0, "Credit limit cannot be negative."),
    preferredPaymentMode: z.enum(PAYMENT_MODE_OPTIONS),

    // Additional
    remarks: z.string().trim(),
    status: z.enum(TRANSPORTER_STATUS_OPTIONS),
  })
  .refine(
    (values) => values.paymentTerm !== "Immediate" || values.creditDays === 0,
    {
      message: "Credit days must be 0 when payment term is Immediate.",
      path: ["creditDays"],
    }
  );

export type Transporter = z.infer<typeof transporterSchema>;
export type TransporterType = Transporter["transporterType"];
export type PaymentTerm = Transporter["paymentTerm"];
export type PaymentMode = Transporter["preferredPaymentMode"];
export type TransporterStatus = Transporter["status"];

export function validateTransporter(values: Transporter) {
  return getFieldErrors(transporterSchema, values);
}
