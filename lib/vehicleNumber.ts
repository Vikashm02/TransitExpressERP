/**
 * Indian vehicle registration helpers.
 *
 * Canonical display for the common 10-character pattern:
 *   XX-00XX-0000  (e.g. TN-34MA-8373)
 *
 * Non-matching / legacy values are left usable (uppercased, hyphens collapsed)
 * so Vehicle Master history is not broken.
 */

/** Alphanumeric-only uppercase key for comparison / last-4 matching. */
export function normalizeVehicleNumberKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** True when the value is (or is being typed toward) XX00XX0000. */
export function isStandardIndianVehicleKey(cleaned: string): boolean {
  if (!cleaned) return true;
  if (cleaned.length <= 2) return /^[A-Z]{1,2}$/.test(cleaned);
  if (cleaned.length <= 4) return /^[A-Z]{2}\d{0,2}$/.test(cleaned);
  if (cleaned.length <= 6) return /^[A-Z]{2}\d{2}[A-Z]{0,2}$/.test(cleaned);
  if (cleaned.length <= 10) return /^[A-Z]{2}\d{2}[A-Z]{2}\d{0,4}$/.test(cleaned);
  return /^[A-Z]{2}\d{2}[A-Z]{2}\d{4}/.test(cleaned);
}

/**
 * Progressive / paste-safe formatting for the vehicle-number input.
 * Collapses duplicate hyphens. Does not invent hyphens for non-standard keys.
 */
export function formatIndianVehicleNumber(
  input: string,
  options?: { trailingHyphen?: boolean }
): string {
  const allowTrail = options?.trailingHyphen !== false;
  const cleaned = normalizeVehicleNumberKey(input);

  if (!cleaned) return "";

  if (!isStandardIndianVehicleKey(cleaned)) {
    // Preserve free-form / legacy plates: uppercase, single hyphens only.
    return input
      .toUpperCase()
      .replace(/[^A-Z0-9-]+/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  const a = cleaned.slice(0, 2);
  if (cleaned.length <= 2) {
    return cleaned.length === 2 && allowTrail ? `${a}-` : a;
  }

  const b = cleaned.slice(2, 4);
  if (cleaned.length <= 4) {
    return `${a}-${b}`;
  }

  const c = cleaned.slice(4, 6);
  if (cleaned.length <= 6) {
    return cleaned.length === 6 && allowTrail ? `${a}-${b}${c}-` : `${a}-${b}${c}`;
  }

  const d = cleaned.slice(6, 10);
  const rest = cleaned.slice(10);
  return rest ? `${a}-${b}${c}-${d}${rest}` : `${a}-${b}${c}-${d}`;
}

/** Normalize for persistence when the value fits the standard pattern. */
export function canonicalizeVehicleNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const cleaned = normalizeVehicleNumberKey(trimmed);
  if (/^[A-Z]{2}\d{2}[A-Z]{2}\d{4}$/.test(cleaned)) {
    return formatIndianVehicleNumber(cleaned, { trailingHyphen: false });
  }
  return trimmed.toUpperCase().replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Format while typing and map the caret so it does not jump to the end.
 *
 * Caret is derived from how many alphanumeric characters sit before the
 * pre-format selection, then projected into the formatted string (skipping
 * auto-inserted hyphens). When a trailing hyphen is inserted at the typing
 * frontier, the caret sits after that hyphen.
 */
export function formatVehicleNumberInputChange(
  raw: string,
  cursor: number,
  previousFormatted: string
): { value: string; cursor: number } {
  const prevCleaned = normalizeVehicleNumberKey(previousFormatted);
  let nextCleaned = normalizeVehicleNumberKey(raw);
  let source = raw;
  let sourceCursor = Math.max(0, Math.min(cursor, raw.length));

  // Backspace deleted only an auto-inserted "-" (cleaned length unchanged).
  // Drop the preceding alphanumeric so the user is not stuck on the hyphen.
  if (
    nextCleaned.length === prevCleaned.length &&
    raw.length < previousFormatted.length &&
    prevCleaned.length > 0
  ) {
    nextCleaned = prevCleaned.slice(0, -1);
    source = nextCleaned;
    sourceCursor = nextCleaned.length;
  }

  const deleting =
    nextCleaned.length < prevCleaned.length || raw.length < previousFormatted.length;

  const value = formatIndianVehicleNumber(source, { trailingHyphen: !deleting });

  const alnumBeforeCursor = normalizeVehicleNumberKey(source.slice(0, sourceCursor)).length;

  if (alnumBeforeCursor === 0) {
    return { value, cursor: 0 };
  }

  let seen = 0;
  let nextCursor = value.length;

  for (let i = 0; i < value.length; i++) {
    if (/[A-Z0-9]/i.test(value[i]!)) {
      seen += 1;
      if (seen === alnumBeforeCursor) {
        nextCursor = i + 1;
        // Typing at the end of the alphanumeric content: sit after a
        // just-inserted trailing hyphen (e.g. "TN" → "TN-|").
        if (
          !deleting &&
          alnumBeforeCursor === nextCleaned.length &&
          value[i + 1] === "-"
        ) {
          nextCursor = i + 2;
        }
        break;
      }
    }
  }

  return { value, cursor: Math.min(nextCursor, value.length) };
}

/**
 * Search match: substring on display or normalized key, plus last-N digit
 * suffix match (e.g. query "8373" finds "TN-34MA-8373" and "TN34MA8373").
 */
export function vehicleNumberMatchesQuery(
  vehicleNumber: string,
  query: string
): boolean {
  const q = query.trim();
  if (!q) return true;

  const qUpper = q.toUpperCase();
  const qKey = normalizeVehicleNumberKey(q);
  const vUpper = vehicleNumber.toUpperCase();
  const vKey = normalizeVehicleNumberKey(vehicleNumber);

  if (vUpper.includes(qUpper) || vKey.includes(qKey)) return true;
  if (/^\d+$/.test(qKey) && vKey.endsWith(qKey)) return true;

  return false;
}
