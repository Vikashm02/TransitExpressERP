/**
 * WhatsApp-specific safe error mapper.
 *
 * Never surface arbitrary Supabase/PostgREST error strings, SQLSTATE codes,
 * details, hints, or JSON payloads to the user, and never log raw RPC error
 * objects in production client code. Only known M114 failure messages are
 * translated to safe categories; anything unexpected collapses to the
 * caller-supplied fixed fallback.
 */

const KNOWN_SAFE_MESSAGES: Array<{ match: RegExp; message: string }> = [
  {
    match: /invalid indian mobile number/i,
    message:
      "Invalid Indian mobile number. Enter a 10-digit Indian mobile number, optionally with +91.",
  },
  {
    match: /phone unavailable/i,
    message: "That WhatsApp number is unavailable — it may already be linked to another account.",
  },
  {
    match: /invalid target/i,
    message: "This account can no longer be managed.",
  },
  {
    match: /not permitted/i,
    message: "You do not have permission to manage this account.",
  },
];

/** Extracts only the top-level message string; details/hints/code are ignored. */
function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return "";
}

export function getWhatsappAccessErrorMessage(error: unknown, fallback: string): string {
  const message = extractMessage(error);
  for (const known of KNOWN_SAFE_MESSAGES) {
    if (known.match.test(message)) return known.message;
  }
  return fallback;
}
