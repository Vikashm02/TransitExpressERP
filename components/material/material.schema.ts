import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

/**
 * Temporary, application-controlled list — same "swappable source" pattern
 * used for Vehicle Type / License Type / Transporter Type. When a dedicated
 * Material Category Master exists, swap this constant for a value sourced
 * from that master; `MaterialForm`, this schema, and `MaterialTable` do not
 * need to change beyond this list's source.
 */
export const MATERIAL_CATEGORY_OPTIONS = [
  "Steel",
  "Cement",
  "Construction",
  "Chemicals",
  "Agriculture",
  "Textile",
  "Machinery",
  "Electrical",
  "FMCG",
  "Miscellaneous",
] as const;

/** Same swappable-source pattern as Category — not a fixed business rule. */
export const MATERIAL_UNIT_OPTIONS = [
  "TON",
  "KG",
  "NOS",
  "BAG",
  "BOX",
  "BUNDLE",
  "ROLL",
  "LTR",
  "MTR",
] as const;

export const MATERIAL_STATUS_OPTIONS = ["Active", "Inactive"] as const;

const HSN_CODE_PATTERN = /^\d{4,8}$/;

function optionalPattern(pattern: RegExp, message: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || pattern.test(value), { message });
}

function optionalControlledValue(options: readonly string[], message: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || (options as readonly string[]).includes(value), {
      message,
    });
}

export const materialSchema = z.object({
  // `code` is generated server-side and immutable; never edited via the form.
  code: z.string(),
  materialName: z.string().trim().min(1, "Material name is required."),
  category: optionalControlledValue(MATERIAL_CATEGORY_OPTIONS, "Select a valid category."),
  hsnCode: optionalPattern(HSN_CODE_PATTERN, "Enter a valid HSN code (4-8 digits)."),
  unit: optionalControlledValue(MATERIAL_UNIT_OPTIONS, "Select a valid unit."),
  gstPercentage: z
    .number()
    .min(0, "GST percentage cannot be negative.")
    .max(100, "GST percentage cannot exceed 100."),
  description: z.string().trim(),
  status: z.enum(MATERIAL_STATUS_OPTIONS),
});

export type Material = z.infer<typeof materialSchema>;
export type MaterialStatus = Material["status"];

export function validateMaterial(values: Material) {
  return getFieldErrors(materialSchema, values);
}
