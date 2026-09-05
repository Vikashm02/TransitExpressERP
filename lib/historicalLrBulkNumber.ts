/**
 * Shared helpers for Transport bulk-upload LR Number cells.
 * Users enter the numeric portion (e.g. 19305); we normalize to the
 * company-formatted document number (e.g. LR19305) using company_settings.
 *
 * Does not allocate or advance lr_running_number.
 */

export type LrBulkNumberFormatConfig = {
  /** Document prefix from company_settings (e.g. "LR"). */
  prefix: string;
  /** Zero-pad width from company_settings.lr_prefix_length. */
  prefixLength: number;
  /**
   * Authoritative current/latest LR sequence value:
   * company_settings.lr_running_number — last number reserved by
   * allocate_next_lr_number (next allocate yields running + 1).
   */
  runningNumber: number;
};

export type NormalizeLrBulkNumberSuccess = {
  ok: true;
  numeric: number;
  formatted: string;
};

export type NormalizeLrBulkNumberFailure = {
  ok: false;
  message: string;
};

export type NormalizeLrBulkNumberResult =
  | NormalizeLrBulkNumberSuccess
  | NormalizeLrBulkNumberFailure;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Format a positive integer into the company LR document number without
 * advancing the running counter (mirrors allocate_next_lr_number padding).
 */
export function formatLrDocumentNumber(
  numeric: number,
  config: Pick<LrBulkNumberFormatConfig, "prefix" | "prefixLength">,
): string {
  const digits = String(numeric);
  const pad = Math.max(config.prefixLength, digits.length);
  return `${config.prefix}${digits.padStart(pad, "0")}`;
}

/**
 * Normalize an Excel LR Number cell for Transport bulk upload.
 * Accepts: 19305, "19305", " LR19305 " (optional matching company prefix).
 * Rejects: blank, decimals, non-numeric junk, mismatched prefixes.
 */
export function normalizeLrBulkNumberInput(
  raw: string,
  config: Pick<LrBulkNumberFormatConfig, "prefix" | "prefixLength">,
): NormalizeLrBulkNumberResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "LR Number is required." };
  }

  const prefix = config.prefix ?? "";
  let digitPart = trimmed;

  if (prefix) {
    const prefixed = new RegExp(`^${escapeRegExp(prefix)}\\s*(\\d+)$`, "i");
    const match = prefixed.exec(trimmed);
    if (match) {
      digitPart = match[1]!;
    }
  }

  // Reject decimals / scientific / mixed junk — digits only after optional prefix strip.
  if (!/^\d+$/.test(digitPart)) {
    return {
      ok: false,
      message:
        "LR Number must be a whole number (e.g. 19305). Do not enter decimals or letters.",
    };
  }

  // Leading zeros are fine; interpret as integer sequence.
  const numeric = Number.parseInt(digitPart, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return {
      ok: false,
      message: "LR Number must be a positive whole number.",
    };
  }

  return {
    ok: true,
    numeric,
    formatted: formatLrDocumentNumber(numeric, config),
  };
}

/**
 * Historical LR create rule for LR Entry bulk upload only:
 * must not already exist, and must be strictly older than the current
 * running/latest sequence (company_settings.lr_running_number).
 */
export function validateHistoricalLrCreateNumber(input: {
  numeric: number;
  formatted: string;
  runningNumber: number;
  existingLrNumbersLower: Set<string>;
}): string | null {
  if (input.existingLrNumbersLower.has(input.formatted.toLowerCase())) {
    return `${input.formatted} already exists in the system.`;
  }

  if (input.numeric >= input.runningNumber) {
    return `${input.formatted} is not allowed in historical bulk upload. LR Number must be older than the current running LR number.`;
  }

  return null;
}
