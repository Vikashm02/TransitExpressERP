import type { Pod } from "./pod.schema";
import type { PodChangedField, PodRecord } from "@/components/services/pod.service";

const POD_EDITABLE_FIELDS: Array<{
  key: keyof Pod;
  label: string;
  focusKey: string;
  type: "string" | "date" | "number" | "url";
}> = [
  { key: "podDate", label: "POD Date", focusKey: "pod-date", type: "date" },
  { key: "unloadingWeight", label: "Unloading Weight", focusKey: "unloading-weight", type: "number" },
  { key: "unloadingDate", label: "Unloading Date", focusKey: "unloading-date", type: "date" },
  { key: "proofUrl", label: "Proof of POD", focusKey: "proof-upload", type: "url" },
];

function normalizeString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeDate(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function valuesEqual(
  original: unknown,
  submitted: unknown,
  type: "string" | "date" | "number" | "url"
): boolean {
  switch (type) {
    case "string":
      return normalizeString(original) === normalizeString(submitted);
    case "date":
      return normalizeDate(original) === normalizeDate(submitted);
    case "number":
      return normalizeNumber(original) === normalizeNumber(submitted);
    case "url":
      return normalizeString(original) === normalizeString(submitted);
  }
}

/**
 * Returns notification-facing POD changes in the form's displayed order.
 * This is pure so every POD edit entry point compares the persisted record
 * against the submitted form values identically.
 */
export function computePodNotificationChanges(
  original: PodRecord,
  submitted: Pod
): PodChangedField[] {
  const changedFields: PodChangedField[] = [];

  for (const field of POD_EDITABLE_FIELDS) {
    if (!valuesEqual(original[field.key], submitted[field.key], field.type)) {
      changedFields.push({ key: field.key, label: field.label, focusKey: field.focusKey });
    }
  }

  return changedFields;
}
