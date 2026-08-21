import type { LR } from "./lr.schema";

/**
 * Free-text LR Entry fields that must be stored UPPERCASE.
 * Excludes enums, dates, numerics, lrNumber, driverMobile, GST, and
 * vehicleNumber (handled by canonicalizeVehicleNumber).
 */
export const LR_UPPERCASE_TEXT_FIELDS = [
  "transporter",
  "driverName",
  "from",
  "to",
  "materialDescription",
  "packageType",
  "poNumber",
  "vendorCode",
  "dcNumber",
  "invoiceNumber",
  "ewayBillNumber",
  "remarks",
  "internalRemarks",
  // Master-selected names applied into LR state
  "customer",
  "consignor",
  "consignee",
  "material",
] as const satisfies readonly (keyof LR)[];

type LrUppercaseField = (typeof LR_UPPERCASE_TEXT_FIELDS)[number];

const UPPERCASE_FIELD_SET = new Set<string>(LR_UPPERCASE_TEXT_FIELDS);

function toUpperText(value: unknown): string {
  if (value == null) return "";
  return String(value).toUpperCase();
}

/**
 * Idempotent: uppercases whitelisted string fields on an LR form object.
 * Safe for typing, paste, lookup selection, autosave, and final save.
 * Does not touch vehicleNumber, enums, dates, numerics, or GST.
 */
export function normalizeLrTextFields(lr: LR): LR {
  let changed = false;
  const next = { ...lr };

  for (const key of LR_UPPERCASE_TEXT_FIELDS) {
    const current = next[key];
    if (typeof current !== "string") continue;
    const upper = toUpperText(current);
    if (upper !== current) {
      (next as Record<LrUppercaseField, string>)[key] = upper;
      changed = true;
    }
  }

  return changed ? next : lr;
}

/** True when `key` is a whitelisted uppercase text field. */
export function isLrUppercaseTextField(key: string): key is LrUppercaseField {
  return UPPERCASE_FIELD_SET.has(key);
}
