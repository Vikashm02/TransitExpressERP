/**
 * Read-only helpers for detecting gaps in the LR number series.
 * Does not allocate, reserve, create, or modify any LR.
 */

const LR_NUMBER_PATTERN = /^LR(\d+)$/i;

/** Official series start for missing-number detection (inclusive). */
const LR_SERIES_START = 19280;

/** Parse `LR19312` → 19312. Returns null for non-standard values (ignored safely). */
export function parseLrSequenceNumber(lrNumber: string | null | undefined): number | null {
  if (!lrNumber) return null;
  const match = LR_NUMBER_PATTERN.exec(lrNumber.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Gaps from `LR_SERIES_START` through the highest existing LR number
 * (at or above the series start). Numbers below the series start are
 * ignored. Numbers after the current highest LR are never reported.
 * Invalid / non-`LR###` values are ignored.
 */
export function findMissingLrNumbers(lrNumbers: Iterable<string>): string[] {
  const digitWidths: number[] = [];
  const present = new Set<number>();

  for (const raw of lrNumbers) {
    const match = LR_NUMBER_PATTERN.exec(String(raw).trim());
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (!Number.isFinite(n)) continue;
    if (n < LR_SERIES_START) continue;
    present.add(n);
    digitWidths.push(match[1].length);
  }

  if (present.size === 0) return [];

  const max = Math.max(...present);
  const padLen = Math.max(...digitWidths, String(LR_SERIES_START).length);

  const missing: string[] = [];
  for (let n = LR_SERIES_START; n <= max; n += 1) {
    if (!present.has(n)) {
      missing.push(`LR${String(n).padStart(padLen, "0")}`);
    }
  }
  return missing;
}
