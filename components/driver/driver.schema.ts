import { z } from "zod";
import { differenceInCalendarDays, differenceInYears, isValid, parseISO } from "date-fns";

import { getFieldErrors } from "@/lib/validation";

export const DRIVER_TYPE_OPTIONS = ["Own", "Attached", "Market"] as const;

/**
 * Temporary, application-controlled list — same "swappable source" pattern
 * used for Vehicle Type. When a dedicated License Type Master exists, swap
 * this constant for a value sourced from that master; `DriverForm`, this
 * schema, and `DriverTable` do not need to change beyond this list's source.
 */
export const LICENSE_TYPE_OPTIONS = ["LMV", "LMV-TR", "HMV", "HMV-TR", "MCWG"] as const;

export const DRIVER_STATUS_OPTIONS = ["Active", "Inactive"] as const;

/** Derived only — never persisted. See `getLicenseStatus`. */
export const LICENSE_STATUS_OPTIONS = ["Valid", "Expiring", "Expired", "Missing"] as const;

const MOBILE_PATTERN = /^\d{10}$/;
const AADHAAR_PATTERN = /^\d{12}$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;

function optionalPattern(pattern: RegExp, message: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || pattern.test(value), { message });
}

function optionalDate(message: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || isValid(parseISO(value)), { message });
}

export const driverSchema = z.object({
  // Identity
  driverName: z.string().trim().min(1, "Driver name is required."),
  driverType: z.enum(DRIVER_TYPE_OPTIONS),
  dateOfBirth: optionalDate("Enter a valid date of birth.").refine(
    (value) => value === "" || differenceInYears(new Date(), parseISO(value)) >= 18,
    { message: "Driver must be at least 18 years old." }
  ),
  bloodGroup: z.string().trim(),
  experienceYears: z.number().min(0, "Experience cannot be negative."),

  // Contact
  mobile: optionalPattern(MOBILE_PATTERN, "Enter a valid 10-digit mobile number."),
  alternateMobile: optionalPattern(MOBILE_PATTERN, "Enter a valid 10-digit mobile number."),
  address: z.string().trim(),
  emergencyContactName: z.string().trim(),
  emergencyContactNumber: optionalPattern(MOBILE_PATTERN, "Enter a valid 10-digit mobile number."),

  // License & Compliance
  licenseNumber: z.string().trim().min(1, "License number is required."),
  licenseType: z
    .string()
    .trim()
    .min(1, "License type is required.")
    .refine((value) => (LICENSE_TYPE_OPTIONS as readonly string[]).includes(value), {
      message: "Select a valid license type.",
    }),
  licenseIssuingState: z.string().trim(),
  licenseExpiry: optionalDate("Enter a valid license expiry date."),

  // Identity Documents
  aadhaarNumber: optionalPattern(AADHAAR_PATTERN, "Enter a valid 12-digit Aadhaar number."),
  pan: optionalPattern(PAN_PATTERN, "Enter a valid PAN (e.g. ABCDE1234F)."),

  // Employment
  dateOfJoining: optionalDate("Enter a valid date of joining.").refine(
    (value) => value === "" || differenceInCalendarDays(new Date(), parseISO(value)) >= 0,
    { message: "Date of joining cannot be in the future." }
  ),
  preferredVehicle: z.string().trim(),

  // Banking
  bankName: z.string().trim(),
  accountNumber: optionalPattern(ACCOUNT_NUMBER_PATTERN, "Enter a valid account number."),
  ifsc: optionalPattern(IFSC_PATTERN, "Enter a valid IFSC code."),

  // Driver Photo — populated via Supabase Storage upload, not typed directly.
  photoUrl: z.string().trim(),

  // Additional
  remarks: z.string().trim(),
  status: z.enum(DRIVER_STATUS_OPTIONS),
});

export type Driver = z.infer<typeof driverSchema>;
export type DriverType = Driver["driverType"];
export type DriverStatus = Driver["status"];
export type LicenseStatus = (typeof LICENSE_STATUS_OPTIONS)[number];

export function validateDriver(values: Driver) {
  return getFieldErrors(driverSchema, values);
}

const EXPIRING_SOON_DAYS = 30;

/**
 * License Status is always derived from `licenseExpiry` at render time — it
 * is intentionally never stored in the database. Mirrors the exact helper
 * pattern established for Vehicle Compliance Status.
 */
export function getLicenseStatus(driver: Pick<Driver, "licenseExpiry">): LicenseStatus {
  if (!driver.licenseExpiry || driver.licenseExpiry.trim() === "") return "Missing";

  const expiry = parseISO(driver.licenseExpiry);
  if (!isValid(expiry)) return "Missing";

  const daysToExpiry = differenceInCalendarDays(expiry, new Date());

  if (daysToExpiry < 0) return "Expired";
  if (daysToExpiry <= EXPIRING_SOON_DAYS) return "Expiring";

  return "Valid";
}
