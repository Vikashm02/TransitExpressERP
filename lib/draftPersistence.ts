import type { LR } from "@/components/lr/lr.schema";

/** YYYY-MM-DD for Postgres `date` columns (local calendar day). */
export function todayIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Normalize LR values for a database draft insert/update.
 *
 * Root cause of missing drafts: `lrs.lr_date` is NOT NULL. Autosave was
 * sending `lrDate: ""`, which Postgres rejects — the insert never
 * persisted, so nothing appeared after logout.
 *
 * Placeholders are only for DB NOT NULL columns; final Save still runs
 * full Zod validation. The real LR number is reserved atomically on
 * first draft persist (see allocate_next_lr_number / migration 036).
 */
export function normalizeLrForDraftPersist(values: LR): LR {
  return {
    ...values,
    entryStatus: "draft",
    lrDate: values.lrDate?.trim() || todayIsoDate(),
    bookingBranch: values.bookingBranch?.trim() || "Draft",
    consignor: values.consignor?.trim() || "Draft",
    consignee: values.consignee?.trim() || "Draft",
    vehicleNumber: values.vehicleNumber?.trim() || "DRAFT",
    from: values.from?.trim() || "Draft",
    to: values.to?.trim() || "Draft",
    material: values.material?.trim() || "Draft",
    status: values.status || "Open",
  };
}
