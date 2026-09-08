/**
 * Pure helpers for Transport report email recipient lists (V1).
 * Mirrors update_report_settings validation in migration 072.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;

export type NormalizeReportEmailsResult =
  | { ok: true; emails: string[] }
  | { ok: false; error: string };

/**
 * Trim, validate format, reject empties/duplicates (case-insensitive), require ≥1.
 * Preserves trimmed original casing for storage/display.
 */
export function normalizeReportEmails(raw: unknown): NormalizeReportEmailsResult {
  let items: unknown[];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "string") {
    items = raw.trim() ? [raw] : [];
  } else if (raw == null) {
    items = [];
  } else {
    return { ok: false, error: "report_email_to must be an array of email addresses" };
  }

  const emails: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const trimmed = String(item ?? "").trim();
    if (!trimmed) {
      return { ok: false, error: "Report email recipient cannot be empty" };
    }
    if (!EMAIL_RE.test(trimmed)) {
      return { ok: false, error: `Invalid report email address: ${trimmed}` };
    }
    const norm = trimmed.toLowerCase();
    if (seen.has(norm)) {
      return { ok: false, error: `Duplicate report email address: ${trimmed}` };
    }
    seen.add(norm);
    emails.push(trimmed);
  }

  if (emails.length < 1) {
    return { ok: false, error: "At least one report email recipient is required" };
  }

  return { ok: true, emails };
}

/** Comma-separated string for report_deliveries.recipient (no schema change). */
export function formatReportRecipientsForAudit(emails: string[]): string {
  return emails.join(", ");
}

/** Resend `to` field — full recipient array. */
export function buildResendToPayload(emails: string[]): string[] {
  return [...emails];
}

/** Coerce DB/RPC value to string[] without requiring ≥1 (for load paths). */
export function coerceReportEmailList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0);
  }
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  return [];
}
