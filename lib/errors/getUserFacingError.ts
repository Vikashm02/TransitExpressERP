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
