import { z } from "zod";
import { differenceInCalendarDays, isValid, parseISO } from "date-fns";

import { getFieldErrors } from "@/lib/validation";

/**
 * Temporary, application-controlled list — intentionally NOT enforced by the
 * database. When a dedicated Vehicle Type Master exists, swap this constant
 * for a value sourced from that master; `VehicleForm`, this schema, and
 * `VehicleTable` do not need to change beyond this list's source.
 */
export const VEHICLE_TYPE_OPTIONS = [
  "Truck",
  "Trailer",
  "Container",
  "Tempo",
  "Pickup",
  "Tanker",
  "Mini Truck",
] as const;

export const OWNER_TYPE_OPTIONS = ["Own Fleet", "Attached", "Market"] as const;
export const CAPACITY_UNIT_OPTIONS = ["TON", "KG"] as const;
export const HIRE_TYPE_OPTIONS = ["Fixed", "Per Ton"] as const;
export const VEHICLE_STATUS_OPTIONS = [
  "Active",
  "Inactive",
  "Under Maintenance",
  "Sold",
] as const;

/** Derived only — never persisted. See `getComplianceStatus`. */
export const COMPLIANCE_STATUS_OPTIONS = ["Valid", "Expiring", "Expired", "Missing"] as const;

const MOBILE_PATTERN = /^\d{10}$/;

export const vehicleSchema = z.object({
  vehicleNumber: z
    .string()
    .trim()
    .min(1, "Vehicle number is required.")
    .transform((value) => value.toUpperCase()),
  rcNumber: z.string().trim(),
  vehicleType: z
    .string()
    .trim()
    .min(1, "Vehicle type is required.")
    .refine((value) => (VEHICLE_TYPE_OPTIONS as readonly string[]).includes(value), {
      message: "Select a valid vehicle type.",
    }),
  ownerName: z.string().trim().min(1, "Owner name is required."),
  ownerType: z.enum(OWNER_TYPE_OPTIONS),
  mobile: z
    .string()
    .trim()
    .refine((value) => value === "" || MOBILE_PATTERN.test(value), {
      message: "Enter a valid 10-digit mobile number.",
    }),

  capacity: z.number().min(0, "Capacity cannot be negative."),
  capacityUnit: z.enum(CAPACITY_UNIT_OPTIONS),

  hireRate: z.number().min(0, "Hire rate cannot be negative."),
  hireType: z.enum(HIRE_TYPE_OPTIONS),

  chassisNumber: z.string().trim(),
  engineNumber: z.string().trim(),

  insuranceNumber: z.string().trim(),
  insuranceExpiry: z.string().trim(),
  permitNumber: z.string().trim(),
  permitExpiry: z.string().trim(),
  fitnessNumber: z.string().trim(),
  fitnessExpiry: z.string().trim(),
  pucNumber: z.string().trim(),
  pucExpiry: z.string().trim(),

  remarks: z.string().trim(),

  status: z.enum(VEHICLE_STATUS_OPTIONS),
});

export type Vehicle = z.infer<typeof vehicleSchema>;
export type VehicleStatus = Vehicle["status"];
export type ComplianceStatus = (typeof COMPLIANCE_STATUS_OPTIONS)[number];

export function validateVehicle(values: Vehicle) {
  return getFieldErrors(vehicleSchema, values);
}

const EXPIRING_SOON_DAYS = 30;

/**
 * Compliance Status is always derived from the four expiry dates at render
 * time — it is intentionally never stored in the database.
 */
export function getComplianceStatus(
  vehicle: Pick<Vehicle, "insuranceExpiry" | "permitExpiry" | "fitnessExpiry" | "pucExpiry">
): ComplianceStatus {
  const dates = [
    vehicle.insuranceExpiry,
    vehicle.permitExpiry,
    vehicle.fitnessExpiry,
    vehicle.pucExpiry,
  ]
    .filter((value): value is string => Boolean(value && value.trim() !== ""))
    .map((value) => parseISO(value))
    .filter((date) => isValid(date));

  if (dates.length === 0) return "Missing";

  const today = new Date();
  const daysToExpiry = dates.map((date) => differenceInCalendarDays(date, today));

  if (daysToExpiry.some((days) => days < 0)) return "Expired";
  if (daysToExpiry.some((days) => days <= EXPIRING_SOON_DAYS)) return "Expiring";

  return "Valid";
}
