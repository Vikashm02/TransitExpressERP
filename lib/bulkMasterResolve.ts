/**
 * Deterministic master-name resolution for Transport bulk upload.
 * Trim + case-insensitive equality only — no fuzzy matching, no suffix stripping.
 * 0 matches → missing; 1 → ok; 2+ → ambiguous (never guess).
 */

export type MasterNameResolveSuccess<T> = {
  ok: true;
  match: T;
};

export type MasterNameResolveFailure = {
  ok: false;
  reason: "missing" | "ambiguous";
  matchCount: number;
};

export type MasterNameResolveResult<T> =
  | MasterNameResolveSuccess<T>
  | MasterNameResolveFailure;

export function normalizeMasterLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve `raw` against `records` by exact normalized name.
 * Empty `raw` is treated as missing (caller should skip when the field is optional).
 */
export function resolveUniqueMasterByName<T>(
  raw: string,
  records: readonly T[],
  getName: (record: T) => string,
): MasterNameResolveResult<T> {
  const key = normalizeMasterLookupKey(raw);
  if (!key) {
    return { ok: false, reason: "missing", matchCount: 0 };
  }

  const matches = records.filter(
    (record) => normalizeMasterLookupKey(getName(record)) === key,
  );

  if (matches.length === 0) {
    return { ok: false, reason: "missing", matchCount: 0 };
  }

  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous", matchCount: matches.length };
  }

  return { ok: true, match: matches[0]! };
}

export function masterNotFoundMessage(
  fieldLabel: string,
  uploadedValue: string,
  masterLabel: string,
): string {
  return `${fieldLabel} "${uploadedValue.trim()}" was not found in ${masterLabel}. Please add it to ${masterLabel} before uploading.`;
}

export function masterAmbiguousMessage(
  fieldLabel: string,
  uploadedValue: string,
  masterLabel: string,
): string {
  return `${fieldLabel} "${uploadedValue.trim()}" matches multiple records in ${masterLabel}. Please use the exact master name, or resolve duplicates in the master first.`;
}
