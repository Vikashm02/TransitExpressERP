import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";
import type { BidRateBasis, MarketVehicleCostBasis } from "@/lib/calculations/bidCalculations";

export const BID_SOURCE_OPTIONS = ["Cargo Exchange", "Email", "Manual", "Other"] as const;

export const BID_STATUS_OPTIONS = [
  "Draft",
  "Live",
  "Won",
  "Lost",
  "Cancelled",
  "Not Submitted",
] as const;

/** Live tab shows open pipeline; everything else is history. */
export const BID_LIVE_STATUSES: readonly string[] = ["Draft", "Live"];
export const BID_HISTORY_STATUSES: readonly string[] = ["Won", "Lost", "Cancelled", "Not Submitted"];

export const BID_RATE_BASIS_OPTIONS: readonly BidRateBasis[] = ["Per MT", "Per Vehicle"];
export const MARKET_VEHICLE_COST_BASIS_OPTIONS: readonly MarketVehicleCostBasis[] = ["Per MT", "Per Trip"];

export const BID_LOSS_REASON_OPTIONS = [
  "Rate Too High",
  "Vehicle Availability",
  "Commercial Decision",
  "Customer Cancelled",
  "Capacity Issue",
  "Unknown",
  "Other",
] as const;

function nonNegativeNumber(message: string) {
  return z.number({ message }).min(0, message);
}

function requiredText(max: number, message: string) {
  return z
    .string({ message })
    .trim()
    .min(1, message)
    .max(max, message);
}

export const bidSchema = z.object({
  // External reference is optional; blank normalizes to NULL server-side.
  bidReference: z.string().trim().max(60, "Bid reference must be 60 characters or less."),
  // Only billing party, source, status, pickup and drop-off are generally
  // mandatory. Everything else is optional unless a status-specific rule
  // below requires it. Blank numerics arrive as 0 and mean "not provided".
  billingPartyId: z.number().int().positive("Choose a billing party from Billing Party Master."),
  consignorId: z.number().int().min(0),
  consigneeId: z.number().int().min(0),
  source: z.enum(BID_SOURCE_OPTIONS, { message: "Choose a valid source." }),
  status: z.enum(BID_STATUS_OPTIONS, { message: "Choose a valid status." }),
  pickupLocation: requiredText(120, "Pickup location is required."),
  dropoffLocation: requiredText(120, "Drop-off location is required."),
  distanceKm: z.number({ message: "Distance must be a number." }).min(0, "Distance cannot be negative."),
  transitTime: z.string().trim().max(60, "Transit time must be 60 characters or less."),
  // Tender-verbatim free text; never validated against Material Master.
  materialDescription: z.string().trim().max(500, "Material description must be 500 characters or less."),
  // Material must be selected from Material Master when provided; the
  // snapshot name is frozen server-side from the master row at write time.
  materialId: z.number().int().min(0),
  vehicleType: z.string().trim().max(60, "Vehicle type must be 60 characters or less."),
  totalQuantityMT: z.number({ message: "Total quantity must be a number." }).min(0, "Total quantity cannot be negative."),
  expectedLoadMT: z.number({ message: "Expected load must be a number." }).min(0, "Expected load cannot be negative."),
  marketVehicleQuote: nonNegativeNumber("Market cost cannot be negative."),
  marketVehicleCostBasis: z.enum(["Per MT", "Per Trip"] as const, { message: "Choose a market cost basis." }),
  bidRateBasis: z.enum(["Per MT", "Per Vehicle"] as const, { message: "Choose a rate basis." }).nullable(),
  bidRate: nonNegativeNumber("Bid rate cannot be negative."),
  // Winning rate is meaningful only with an explicit basis.
  winningRate: z.number().min(0, "Winning rate cannot be negative.").nullable().optional(),
  winningRateBasis: z.enum(["Per MT", "Per Vehicle"] as const).nullable().optional(),
  postedAt: z.string().trim(),
  closesAt: z.string().trim(),
  lossReason: z.enum(BID_LOSS_REASON_OPTIONS).nullable().optional(),
  resultRemarks: z.string().trim().max(2000, "Result remarks must be 2000 characters or less."),
  notes: z.string().trim().max(2000, "Notes must be 2000 characters or less."),
});

export type Bid = z.infer<typeof bidSchema>;

export function validateBid(values: Bid) {
  const errors = getFieldErrors(bidSchema, values) as Record<string, string>;

  // NOTE: Live bids deliberately do NOT require closes_at (a Live tender
  // may have an unknown closing time). Reminder shortcuts stay unavailable
  // while it is empty; exact custom reminder times are unaffected.
  if (values.winningRate !== null && values.winningRate !== undefined && !values.winningRateBasis) {
    errors.winningRateBasis = "Winning rate requires a rate basis.";
  }
  if (values.bidRate > 0 && !values.bidRateBasis) {
    errors.bidRateBasis = "Choose a rate basis for the entered bid rate.";
  }
  if (
    values.postedAt &&
    values.closesAt &&
    new Date(values.closesAt).getTime() < new Date(values.postedAt).getTime()
  ) {
    errors.closesAt = "Closing time cannot be before the posted time.";
  }

  return errors;
}
