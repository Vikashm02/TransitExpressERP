import type { LR } from "@/components/lr/lr.schema";

/** YYYY-MM-DD for Postgres `date` columns (local calendar day). */
export function todayIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Sentinel values written only so NOT NULL LR columns can persist a draft.
 * These are NOT user data — strip them before showing the form.
 */
export const LR_DRAFT_TEXT_PLACEHOLDER = "Draft";
export const LR_DRAFT_VEHICLE_PLACEHOLDER = "DRAFT";

function emptyIfPlaceholder(value: string | undefined, placeholder: string): string {
  return (value?.trim() ?? "") === placeholder ? "" : (value ?? "");
}

/**
 * Normalize LR values for a database draft insert/update.
 *
 * Placeholders fill NOT NULL columns; final Save still runs full Zod validation.
 *
 * Real LR numbers are reserved once on first meaningful draft persist via
 * create_numbered_lr_draft() / allocate_next_lr_number(). Subsequent autosaves
 * keep the same number — never allocate again.
 */
export function normalizeLrForDraftPersist(values: LR): LR {
  return {
    ...values,
    entryStatus: "draft",
    lrNumber:
      values.lrNumber?.trim() && !values.lrNumber.trim().startsWith("DRAFT-")
        ? values.lrNumber.trim()
        : values.lrNumber?.trim() ?? "",
    lrDate: values.lrDate?.trim() || todayIsoDate(),
    bookingBranch: values.bookingBranch?.trim() || LR_DRAFT_TEXT_PLACEHOLDER,
    consignor: values.consignor?.trim() || LR_DRAFT_TEXT_PLACEHOLDER,
    consignee: values.consignee?.trim() || LR_DRAFT_TEXT_PLACEHOLDER,
    vehicleNumber: values.vehicleNumber?.trim() || LR_DRAFT_VEHICLE_PLACEHOLDER,
    from: values.from?.trim() || LR_DRAFT_TEXT_PLACEHOLDER,
    to: values.to?.trim() || LR_DRAFT_TEXT_PLACEHOLDER,
    material: values.material?.trim() || LR_DRAFT_TEXT_PLACEHOLDER,
    status: values.status || "Open",
  };
}

/**
 * Convert a persisted draft (or any LR) into form-ready values.
 * Removes DB-only "Draft"/"DRAFT" placeholders so empty fields stay blank.
 * Real user-entered values are left unchanged.
 */
export function prepareLrForDraftForm(values: LR): LR {
  if (values.entryStatus !== "draft") return values;

  return {
    ...values,
    bookingBranch: emptyIfPlaceholder(values.bookingBranch, LR_DRAFT_TEXT_PLACEHOLDER),
    consignor: emptyIfPlaceholder(values.consignor, LR_DRAFT_TEXT_PLACEHOLDER),
    consignee: emptyIfPlaceholder(values.consignee, LR_DRAFT_TEXT_PLACEHOLDER),
    vehicleNumber: emptyIfPlaceholder(values.vehicleNumber, LR_DRAFT_VEHICLE_PLACEHOLDER),
    from: emptyIfPlaceholder(values.from, LR_DRAFT_TEXT_PLACEHOLDER),
    to: emptyIfPlaceholder(values.to, LR_DRAFT_TEXT_PLACEHOLDER),
    material: emptyIfPlaceholder(values.material, LR_DRAFT_TEXT_PLACEHOLDER),
  };
}
