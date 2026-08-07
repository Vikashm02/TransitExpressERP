import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

/**
 * Temporary, application-controlled list — same "swappable source" pattern
 * used for Vehicle Type. Mirrors the branch options currently hardcoded in
 * `LRHeader.tsx`; replace with a real Branch Master later without touching
 * this schema's shape.
 */
export const DEFAULT_BRANCH_OPTIONS = ["Visakhapatnam", "Shahabad"] as const;

/** Extensible — add more currencies here as multi-currency support is needed. */
export const DEFAULT_CURRENCY_OPTIONS = ["INR"] as const;

/** Mirrors LR's existing `freightType` union exactly. */
export const DEFAULT_FREIGHT_TYPE_OPTIONS = ["Paid", "To Pay", "To Be Billed"] as const;

const GSTIN_PATTERN = /^[0-9A-Z]{15}$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const CIN_PATTERN = /^[A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const MOBILE_PATTERN = /^\d{10}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEBSITE_PATTERN = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#].*)?$/i;
const PINCODE_PATTERN = /^\d{6}$/;
const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_PATTERN = /^[\w.-]+@[\w.-]+$/;
const FINANCIAL_YEAR_PATTERN = /^(\d{4})-(\d{2})$/;

function optionalPattern(pattern: RegExp, message: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || pattern.test(value), { message });
}

export const companySchema = z.object({
  // Company Identity
  companyName: z.string().trim().min(1, "Company name is required."),
  companyShortName: z.string().trim().min(1, "Company short name is required."),
  gstin: optionalPattern(GSTIN_PATTERN, "Enter a valid 15-character GSTIN."),
  pan: optionalPattern(PAN_PATTERN, "Enter a valid PAN (e.g. ABCDE1234F)."),
  cin: optionalPattern(CIN_PATTERN, "Enter a valid 21-character CIN."),

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
  bankBranch: z.string().trim(),
  accountNumber: optionalPattern(ACCOUNT_NUMBER_PATTERN, "Enter a valid account number."),
  ifsc: optionalPattern(IFSC_PATTERN, "Enter a valid IFSC code."),
  upiId: optionalPattern(UPI_PATTERN, "Enter a valid UPI ID."),

  // Branding — populated via Supabase Storage uploads, not typed directly.
  logoUrl: z.string().trim(),
  signatureUrl: z.string().trim(),
  stampUrl: z.string().trim(),

  // Document Settings
  financialYear: z
    .string()
    .trim()
    .min(1, "Financial year is required.")
    .refine(
      (value) => {
        const match = FINANCIAL_YEAR_PATTERN.exec(value);
        if (!match) return false;
        const startYear = Number(match[1]);
        const expectedSuffix = String((startYear + 1) % 100).padStart(2, "0");
        return match[2] === expectedSuffix;
      },
      { message: "Enter a valid financial year in YYYY-YY format, e.g. 2025-26." }
    ),
  lrPrefix: z.string().trim().max(10, "Prefix must be 10 characters or fewer."),
  invoicePrefix: z.string().trim().max(10, "Prefix must be 10 characters or fewer."),
  voucherPrefix: z.string().trim().max(10, "Prefix must be 10 characters or fewer."),
  lrPrefixLength: z.number().int().min(1).max(10),
  invoicePrefixLength: z.number().int().min(1).max(10),
  voucherPrefixLength: z.number().int().min(1).max(10),

  // System Defaults
  defaultBranch: z.string().trim(),
  defaultCurrency: z.enum(DEFAULT_CURRENCY_OPTIONS),
  defaultFreightType: z.enum(DEFAULT_FREIGHT_TYPE_OPTIONS),
  defaultGstPercentage: z.number().min(0, "Cannot be negative.").max(100, "Cannot exceed 100."),
});

export type Company = z.infer<typeof companySchema>;

export function validateCompany(values: Company) {
  return getFieldErrors(companySchema, values);
}

/** India's standard financial year (April–March), as a `YYYY-YY` string. */
export function getCurrentFinancialYear(date: Date = new Date()): string {
  const year = date.getFullYear();
  const isBeforeApril = date.getMonth() < 3;
  const startYear = isBeforeApril ? year - 1 : year;
  const endSuffix = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endSuffix}`;
}
