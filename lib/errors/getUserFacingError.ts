/**
 * Centralized safe error extractor for mutation toasts.
 *
 * Shows the meaningful backend/API message when one exists, otherwise
 * falls back to the supplied human fallback. Never exposes stack traces,
 * raw SQL dumps, tokens, credentials, or raw objects.
 */

const MAX_LENGTH = 400;

// Only block *clear* infrastructure/secret patterns — keep legitimate
// business English like "Select a PO ..." or "Please update ...".
const SENSITIVE_PATTERNS: RegExp[] = [
  // Stack traces
  /stack\s*trace/i,
  /at\s+[\w$.<>()]+\s+\(.+:\d+:\d+\)/,
  // Raw SQL dumps — require SQL keywords with typical dump markers
  /\bselect\s+.*\bfrom\s+\w+/i,
  /\binsert\s+into\s+\w+/i,
  /\bdelete\s+from\s+\w+/i,
  /\bupdate\s+\w+\s+set\s+/i,
  /pg_\w+/i,
  // Tokens / credentials — require token-like length/format, not plain words
  /bearer\s+[A-Za-z0-9\-_]{20,}/i,
  /eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/, // JWT header.payload
  /x-api-key\s*:/i,
  /\bapi[_-]?key\s*[:=]\s*\S+/i,
  /authorization\s*:\s*bearer/i,
  // Credentials in URLs
  /[^\/\s]+:[^\/\s]+@/i, // user:pass@host
  // HTML content
  /<[a-z][\s\S]*>/i,
  // Raw object dumps that would be JSON noise
  /^\s*\{[\s\S]*"code"\s*:\s*".*"\s*,\s*"details"\s*:/,
];

function containsSensitiveMaterial(text: string): boolean {
  for (const re of SENSITIVE_PATTERNS) {
    if (re.test(text)) return true;
  }
  // Extremely long single-line dumps that look like internal JSON
  if (text.length > MAX_LENGTH * 3 && text.includes("{") && text.includes("}")) {
    return true;
  }
  return false;
}

function extractRawMessage(error: unknown): string {
  if (error == null) return "";

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;

    // Direct message on the error object (Error, PostgrestError, RPC error)
    if (typeof obj.message === "string" && obj.message.trim().length > 0) {
      return obj.message;
    }

    // API JSON: { error: "..." } or { error: { message: "..." } }
    if (obj.error != null) {
      if (typeof obj.error === "string" && obj.error.trim().length > 0) {
        return obj.error;
      }
      if (typeof obj.error === "object") {
        const nested = obj.error as Record<string, unknown>;
        if (typeof nested.message === "string" && nested.message.trim().length > 0) {
          return nested.message;
        }
        if (typeof nested.msg === "string" && nested.msg.trim().length > 0) {
          return nested.msg;
        }
      }
    }

    // API variants: { msg: "..." } / { detail: "..." } / { details: "..." } is NOT shown
    // but { msg, detail } as the top-level message key should be supported per spec
    if (typeof obj.msg === "string" && obj.msg.trim().length > 0) {
      return obj.msg;
    }
    if (typeof obj.detail === "string" && obj.detail.trim().length > 0) {
      return obj.detail;
    }

    // Some fetch wrappers nest under `data` then repeat, but we prefer message above
    if (typeof obj.message === "string") return obj.message;
  }

  // Error subclass fallback — instanceof check after object checks so Supabase
  // PostgrestError (which is an Error with message) is handled above already
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }

  return "";
}

/* ==========================================================
   Plain-language translation of technical errors.
   Business messages raised by our own database rules (code P0001,
   e.g. "Select a PO for ...") are already written for staff and
   pass through unchanged. Only raw Postgres / PostgREST / network
   errors are translated here so staff see what went wrong and what
   to do next, never codes like 23505 or constraint names.
========================================================== */

const NOT_SAVED = "Nothing was saved.";

function humanizeColumn(column: string): string {
  const words = column
    .replace(/_id$/i, "")
    .split("_")
    .filter(Boolean)
    .map((word) => (/^(lr|po|dc|pod|asn|gst|gstin|pan|ifsc|mt|id)$/i.test(word) ? word.toUpperCase() : word.toLowerCase()));
  if (words.length === 0) return "This value";
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Pulls `col` and `value` from PostgreSQL's `Key (col)=(value) already exists.` */
const SQL_WORDS = new Set(["upper", "lower", "trim", "both", "from", "leading", "trailing", "coalesce", "text"]);

function parseDuplicateKey(details: string): { label: string; value: string } | null {
  const start = details.indexOf("Key (");
  const split = details.indexOf(")=(", start);
  const end = details.lastIndexOf(") already exists");
  if (start < 0 || split < 0 || end < split) return null;
  // Expression keys look like `billing_party_id, upper(TRIM(BOTH FROM po_number))`;
  // report the last real column — usually the number/name, while earlier
  // columns are the parent such as the billing party.
  const columns = (details.slice(start + 5, split).match(/[a-z_][a-z0-9_]*/gi) ?? [])
    .filter((word) => !SQL_WORDS.has(word.toLowerCase()));
  const label = humanizeColumn(columns[columns.length - 1] ?? "");
  const values = details.slice(split + 3, end).split(",");
  const value = (values[values.length - 1] ?? "").trim();
  if (!value || value.length > 80) return { label, value: "" };
  return { label, value };
}

function columnFromNotNull(message: string): string | null {
  const match = message.match(/null value in column "([^"]+)"/i);
  return match ? humanizeColumn(match[1]) : null;
}

export function translateTechnicalError(error: unknown): string | null {
  if (error == null || (typeof error !== "object" && typeof error !== "string")) return null;
  const obj = (typeof error === "object" ? error : {}) as Record<string, unknown>;
  const code = typeof obj.code === "string" ? obj.code : "";
  const status = typeof obj.status === "number" ? obj.status : 0;
  const message = normalizeMessage(extractRawMessage(error));
  const details = typeof obj.details === "string" ? obj.details : "";

  if (code === "P0001") return null;

  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet_disconnected|err_network/i.test(message)) {
    return `Could not connect to the server. Please check your internet connection and try again. ${NOT_SAVED}`;
  }

  if (code === "PGRST301" || code === "PGRST303" || /jwt expired|invalid jwt|refresh token|session (has )?expired|auth session missing/i.test(message)) {
    return "Your login session has expired. Please sign out, sign in again, and then retry.";
  }

  if (code === "42501" || /row-level security|permission denied/i.test(message)) {
    return `You do not have permission to do this. Please ask your administrator to give you access. ${NOT_SAVED}`;
  }

  if (code === "23505" || /duplicate key value violates unique constraint/i.test(message)) {
    const key = parseDuplicateKey(details || message);
    if (key?.value) {
      return `${key.label} "${key.value}" already exists. Please use a different ${key.label.toLowerCase()} or open the existing record. ${NOT_SAVED}`;
    }
    return `This entry already exists (same number or name as an existing record). Please check for a duplicate. ${NOT_SAVED}`;
  }

  if (code === "23503" || /violates foreign key constraint/i.test(message)) {
    if (/update or delete on table/i.test(message)) {
      return "This record is being used by other records (for example LRs, bills or POs), so it cannot be deleted or changed. Remove those links first.";
    }
    return `A selected item (such as a party, vehicle, material or PO) no longer exists. Please select it again and retry. ${NOT_SAVED}`;
  }

  if (code === "23502" || /null value in column/i.test(message)) {
    const column = columnFromNotNull(message);
    return column
      ? `"${column}" is required. Please fill it in and try again. ${NOT_SAVED}`
      : `A required field is empty. Please fill in all required fields and try again. ${NOT_SAVED}`;
  }

  if (code === "23514" || /violates check constraint/i.test(message)) {
    return `One of the values entered is not allowed (for example a negative amount, zero weight, or an invalid option). Please check the form and try again. ${NOT_SAVED}`;
  }

  if (code === "22001" || /value too long/i.test(message)) {
    return `One of the entries is too long. Please shorten it and try again. ${NOT_SAVED}`;
  }

  if (code === "22P02" || code === "22007" || code === "22008" || code === "22003" || /invalid input syntax|date\/time field value out of range|out of range for type/i.test(message)) {
    return `One of the values is in the wrong format (for example text in a number field or an invalid date). Please correct it and try again. ${NOT_SAVED}`;
  }

  if (code === "57014" || /statement timeout|canceling statement due to/i.test(message)) {
    return `The server took too long to respond. Please wait a moment and try again. ${NOT_SAVED}`;
  }

  if (code === "40001" || code === "40P01" || code === "55P03" || /deadlock detected|could not serialize|could not obtain lock/i.test(message)) {
    return `Someone else was saving the same record at the same moment. Please try again. ${NOT_SAVED}`;
  }

  if (code === "PGRST116" || /JSON object requested, multiple \(or no\) rows returned/i.test(message)) {
    return "This record could not be found. It may have been deleted, or you may not have access to it. Please refresh the page and try again.";
  }

  if (
    code === "PGRST202" || code === "PGRST204" || code === "PGRST205" || code === "42703" || code === "42883" || code === "42P01" ||
    /could not find the .* (column|function|table)|schema cache/i.test(message)
  ) {
    return "The app and the database are out of sync for this action. Please contact your administrator.";
  }

  if (status === 429 || /too many requests|rate limit/i.test(message)) {
    return "Too many requests were sent in a short time. Please wait a minute and try again.";
  }

  if (status >= 500 || /internal server error|bad gateway|service unavailable|gateway timeout/i.test(message)) {
    return `The server had a temporary problem. Please try again in a few minutes. ${NOT_SAVED}`;
  }

  return null;
}

function normalizeMessage(raw: string): string {
  // Collapse whitespace/newlines into single spaces, trim
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Returns a safe user-facing error message.
 * - Extracts the most specific message string from known error shapes
 * - Normalizes whitespace, caps length
 * - Falls back when message is empty or appears to contain sensitive dump material
 */
export function getUserFacingError(error: unknown, fallback: string): string {
  const translated = translateTechnicalError(error);
  if (translated) return translated;

  const raw = extractRawMessage(error);
  const normalized = normalizeMessage(raw);

  if (!normalized) return fallback;

  if (containsSensitiveMaterial(normalized)) return fallback;

  // Bound length — if slightly over, truncate with ellipsis; if massively over,
  // treat as dump and fallback (but keep legitimate ~1-2 sentence business errors)
  if (normalized.length > MAX_LENGTH) {
    // If it's 400-800 chars and looks like a normal sentence, truncate rather than hide
    if (normalized.length <= MAX_LENGTH * 2) {
      return normalized.slice(0, MAX_LENGTH - 1).trimEnd() + "…";
    }
    return fallback;
  }

  return normalized;
}

export default getUserFacingError;
