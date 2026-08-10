/**
 * GST is future-ready functionality for Credit Note / Debit Note: the
 * default is always NIL (0%), and only a handful of standard Indian GST
 * slabs are offered — no GST accounting/reconciliation logic is built on
 * top of this. Shared by both modules so their GST dropdown stays
 * identical.
 */
export const GST_PERCENTAGE_OPTIONS = [0, 5, 12, 18, 28] as const;

export function formatGstOption(value: number): string {
  return value === 0 ? "NIL (0%)" : `${value}%`;
}

export function computeGstAmount(amount: number, gstPercentage: number): number {
  return Math.round(amount * gstPercentage) / 100;
}
