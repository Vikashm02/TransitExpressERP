import { z } from "zod";

import { getFieldErrors } from "@/lib/validation";

/** TDS is always a flat 1% of the LR's calculated Lorry Hire Amount,
 * never a free-form percentage or a different base (approved
 * decision) — so this is a closed 0/1 choice, not a general number. */
export const TDS_PERCENTAGE_OPTIONS = [0, 1] as const;

export const podSchema = z.object({
  // Locked to an existing LR via the LR lookup dialog — see LRLookup /
  // PodForm. Never free-typed, so "existing LR only" is guaranteed by
  // construction rather than a separate cross-table validation rule.
  lrNumber: z.string().trim().min(1, "LR number is required."),
  podDate: z.string().trim().min(1, "POD date is required."),
  unloadingWeight: z.number().gt(0, "Unloading weight is required."),
  unloadingDate: z.string().trim().min(1, "Unloading date is required."),
  // Optional: the spec does not mark "Proof of POD" mandatory like the
  // other four fields.
  proofUrl: z.string().trim(),

  // Historical settlement columns — kept for DB compatibility and so
  // edit/save of old PODs does not wipe stored values. Entry UI lives
  // exclusively in Financials; these are not shown on the POD form.
  stChalan: z.number().min(0, "Cannot be negative."),
  tdsPercentage: z.number().refine((value) => TDS_PERCENTAGE_OPTIONS.includes(value as 0 | 1), {
    message: "TDS must be NIL or 1%.",
  }),
  otherDeduction: z.number().min(0, "Cannot be negative."),
  balancePaidOn: z.string().trim(),
});

export type Pod = z.infer<typeof podSchema>;

export function validatePod(values: Pod) {
  return getFieldErrors(podSchema, values);
}
