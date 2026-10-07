/**
 * Pure, client-side rules for Creator-managed WhatsApp Assistant access.
 *
 * M114 (the whatsapp_internal_access_* RPCs) remains authoritative. These
 * helpers only decide which actions the Staff Master UI offers and preview
 * the canonical number before the Creator confirms. They never persist data
 * and must never replace a server call.
 */

export const WHATSAPP_ACCESS_STATUSES = [
  "security_override_denied",
  "account_ineligible",
  "not_configured",
  "disabled",
  "enabled_no_lr_permission",
  "enabled_lr_only",
  "enabled_lr_and_pod",
] as const;

export type WhatsappAccessStatus = (typeof WHATSAPP_ACCESS_STATUSES)[number];

/**
 * Fixed, non-revealing labels. Never surface exclusion/reservation/provider
 * internals — "security_override_denied" must only ever read "Unavailable".
 */
export const WHATSAPP_ACCESS_STATUS_LABELS: Record<WhatsappAccessStatus, string> = {
  security_override_denied: "Unavailable",
  account_ineligible: "Account ineligible",
  not_configured: "Not set",
  disabled: "Disabled",
  enabled_no_lr_permission: "Enabled — no LR access",
  enabled_lr_only: "Enabled — LR only",
  enabled_lr_and_pod: "Enabled — LR + POD",
};

export function isWhatsappAccessStatus(value: unknown): value is WhatsappAccessStatus {
  return (
    typeof value === "string" &&
    (WHATSAPP_ACCESS_STATUSES as readonly string[]).includes(value)
  );
}

/** M114's persisted WhatsApp number form: exactly "+91" + Indian mobile. */
export const WHATSAPP_CANONICAL_PHONE_REGEX = /^\+91[6-9][0-9]{9}$/;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UI-side eligibility predicate for Creator-managed WhatsApp access. M114's
 * require_creator helper is deliberately stricter than the normal
 * Creator-or-admin hierarchy: the acting profile must be a Creator who is
 * approved and not locked. A locked/unapproved Creator must never see — or
 * trigger — whatsapp_internal_access_list.
 */
export function canManageWhatsappAccessAsCreator(actor: {
  role: string;
  approvalStatus: string;
  isLocked: boolean;
} | null | undefined): boolean {
  if (!actor) return false;
  return actor.role === "creator" && actor.approvalStatus === "approved" && actor.isLocked === false;
}

/** One row of the M114 whatsapp_internal_access_list contract. */
export interface WhatsappAccessRow {
  targetUserId: string;
  displayName: string;
  email: string;
  role: string;
  approvalStatus: string;
  isLocked: boolean;
  whatsappPhoneE164: string | null;
  effectiveAccessStatus: WhatsappAccessStatus;
  effectiveLrAccess: boolean;
  effectivePodAccess: boolean;
  mappingUpdatedAt: string | null;
  mappingUpdatedByDisplayName: string | null;
}

const WHATSAPP_MANAGED_ROLES = ["admin", "staff"] as const;
const APP_APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Strict validator for the timestamp serialization M114 produces via
 * PostgREST for a PostgreSQL timestamptz column: ISO-8601
 * `YYYY-MM-DD[T ]HH:MM:SS[.ffffff](Z|±HH[:]MM)`.
 *
 * Rejects arbitrary strings even when `Date.parse` would normalize them
 * (e.g. "2026-02-31T00:00:00Z" parses to March 3rd) by round-tripping the
 * calendar components, and rejects out-of-range fields the JS Date
 * constructor would silently roll over. Non-matching input throws the
 * existing safe local error via the callers.
 */
export function isStrictWhatsappTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:?\d{2})$/.exec(
    value
  );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[8] !== "Z") {
    const offsetHours = Number(match[8].slice(1, 3));
    const offsetMinutes = match[8].includes(":")
      ? Number(match[8].slice(-2))
      : match[8].length === 5
        ? Number(match[8].slice(-2))
        : 0;
    if (offsetHours > 14 || offsetMinutes > 59) return false;
  }
  // Calendar existence check: Date.UTC normalizes impossible dates (Feb 31),
  // so a component mismatch means the input was not a real date.
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute ||
    probe.getUTCSeconds() !== second
  ) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

/**
 * Strict parse of one M114 list row. Fail closed: any malformed or missing
 * security/UI-relevant field rejects the row (the loader treats one bad row
 * as a malformed response) instead of coercing or defaulting.
 */
export function parseWhatsappAccessRow(raw: unknown): WhatsappAccessRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.target_user_id !== "string" || !UUID_REGEX.test(row.target_user_id)) {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  if (typeof row.display_name !== "string" && row.display_name !== null) {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  if (typeof row.email !== "string" && row.email !== null) {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  if (typeof row.role !== "string" || !(WHATSAPP_MANAGED_ROLES as readonly string[]).includes(row.role)) {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  if (
    typeof row.approval_status !== "string" ||
    !(APP_APPROVAL_STATUSES as readonly string[]).includes(row.approval_status)
  ) {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  if (typeof row.is_locked !== "boolean") {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  if (row.whatsapp_phone_e164 !== null && typeof row.whatsapp_phone_e164 !== "string") {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  if (typeof row.whatsapp_phone_e164 === "string" && !WHATSAPP_CANONICAL_PHONE_REGEX.test(row.whatsapp_phone_e164)) {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  if (!isWhatsappAccessStatus(row.effective_access_status)) {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  if (typeof row.effective_lr_access !== "boolean" || typeof row.effective_pod_access !== "boolean") {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  if (!isNullableString(row.mapping_updated_by_display_name)) {
    throw new Error("WhatsApp access list returned an unexpected response.");
  }
  // M114 list: both values come from the active link. An active canonical
  // phone therefore requires its non-null updated_at; no active phone must
  // carry neither an active-link timestamp nor a coerced substitute.
  const hasActivePhone = typeof row.whatsapp_phone_e164 === "string" && row.whatsapp_phone_e164.length > 0;
  let mappingUpdatedAt: string | null;
  if (hasActivePhone) {
    if (!isStrictWhatsappTimestamp(row.mapping_updated_at)) {
      throw new Error("WhatsApp access list returned an unexpected response.");
    }
    mappingUpdatedAt = row.mapping_updated_at;
  } else {
    if (row.mapping_updated_at !== null) {
      throw new Error("WhatsApp access list returned an unexpected response.");
    }
    mappingUpdatedAt = null;
  }
  return {
    targetUserId: row.target_user_id,
    displayName: (row.display_name as string | null) || (row.email as string | null) || "Unnamed",
    email: (row.email as string | null) ?? "",
    role: row.role,
    approvalStatus: row.approval_status,
    isLocked: row.is_locked,
    whatsappPhoneE164: row.whatsapp_phone_e164 as string | null,
    effectiveAccessStatus: row.effective_access_status,
    effectiveLrAccess: row.effective_lr_access,
    effectivePodAccess: row.effective_pod_access,
    mappingUpdatedAt,
    mappingUpdatedByDisplayName: row.mapping_updated_by_display_name,
  };
}

export interface WhatsappSetPhoneResult {
  status: "enabled" | "unchanged";
  whatsappPhoneE164: string;
  mappingUpdatedAt: string | null;
}

/** Strict parse of the set_phone jsonb result. */
export function parseWhatsappSetPhoneResponse(raw: unknown): WhatsappSetPhoneResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("WhatsApp access update returned an unexpected response.");
  }
  const body = raw as Record<string, unknown>;
  if (body.status !== "enabled" && body.status !== "unchanged") {
    throw new Error("WhatsApp access update returned an unexpected response.");
  }
  if (typeof body.whatsapp_phone_e164 !== "string" || !WHATSAPP_CANONICAL_PHONE_REGEX.test(body.whatsapp_phone_e164)) {
    throw new Error("WhatsApp access update returned an unexpected response.");
  }
  // Actual M114 shapes:
  //   enabled:   {status, whatsapp_phone_e164, mapping_updated_at}
  //              — mapping_updated_at is a NOT NULL updated_at, always present.
  //   unchanged: {status, whatsapp_phone_e164}
  //              — M114 never includes mapping_updated_at.
  if (body.status === "enabled") {
    if (!isStrictWhatsappTimestamp(body.mapping_updated_at)) {
      throw new Error("WhatsApp access update returned an unexpected response.");
    }
    return {
      status: body.status,
      whatsappPhoneE164: body.whatsapp_phone_e164,
      mappingUpdatedAt: body.mapping_updated_at,
    };
  }
  if ("mapping_updated_at" in body) {
    throw new Error("WhatsApp access update returned an unexpected response.");
  }
  return {
    status: body.status,
    whatsappPhoneE164: body.whatsapp_phone_e164,
    mappingUpdatedAt: null,
  };
}

/** Strict parse of the disable jsonb result. */
export function parseWhatsappDisableResponse(raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("WhatsApp access disable returned an unexpected response.");
  }
  const body = raw as Record<string, unknown>;
  // Actual M114 shape: exactly {status: 'disabled'} — no timestamp, no
  // extra keys.
  if (body.status !== "disabled" || Object.keys(body).length !== 1) {
    throw new Error("WhatsApp access disable returned an unexpected response.");
  }
}

/** Minimal shape of an M114 list row required by the enablement rules. */
export interface WhatsappAccessRuleInput {
  effectiveAccessStatus: WhatsappAccessStatus;
  whatsappPhoneE164: string | null;
  approvalStatus?: string;
  isLocked?: boolean;
}

function isManageableAccount(row: WhatsappAccessRuleInput): boolean {
  if (row.approvalStatus !== undefined && row.approvalStatus !== "approved") return false;
  if (row.isLocked === true) return false;
  return true;
}

/**
 * Strongest available signal for an ACTIVE mapping: M114 only returns
 * `whatsapp_phone_e164` from the active link, so a non-empty value implies
 * an active mapping exists. Enabled statuses always carry a phone; disabled
 * / not_configured / ineligible rows have none.
 */
export function hasActiveWhatsappMapping(row: { whatsappPhoneE164: string | null }): boolean {
  return typeof row.whatsappPhoneE164 === "string" && row.whatsappPhoneE164.length > 0;
}

/**
 * Enable is offered only for a fixable, eligible target. M114 rejects
 * set_phone for locked/unapproved targets, so `account_ineligible` (or a
 * security override) never enables Enable/Change — the account must be
 * fixed in Staff Master first.
 */
export function canEnableWhatsappAccess(row: WhatsappAccessRuleInput): boolean {
  if (row.effectiveAccessStatus === "security_override_denied") return false;
  if (row.effectiveAccessStatus === "account_ineligible") return false;
  if (!isManageableAccount(row)) return false;
  return row.effectiveAccessStatus === "not_configured" || row.effectiveAccessStatus === "disabled";
}

export function canChangeWhatsappAccess(row: WhatsappAccessRuleInput): boolean {
  if (row.effectiveAccessStatus === "security_override_denied") return false;
  if (row.effectiveAccessStatus === "account_ineligible") return false;
  if (!isManageableAccount(row)) return false;
  return (
    row.effectiveAccessStatus === "enabled_no_lr_permission" ||
    row.effectiveAccessStatus === "enabled_lr_only" ||
    row.effectiveAccessStatus === "enabled_lr_and_pod"
  );
}

/**
 * Disable remains possible for cleanup of an ACTIVE mapping even when the
 * target has since become locked/unapproved (`account_ineligible`). M114's
 * disable() intentionally does not require LR/POD permissions or access
 * eligibility. No exclusion details are ever checked or shown client-side.
 */
export function canDisableWhatsappAccess(row: WhatsappAccessRuleInput): boolean {
  return hasActiveWhatsappMapping(row);
}

/**
 * Pure preview normalizer mirroring M114's whatsapp_internal_access_normalize_phone
 * rules exactly (accepted forms/limits). The server remains authoritative —
 * the typed input is always submitted to the RPC, never this preview.
 *
 * Returns the canonical "+91XXXXXXXXXX" form or null when invalid.
 */
export function previewIndiaWhatsappPhone(input: string): string | null {
  if (typeof input !== "string") return null;
  // M114 trims with PostgreSQL btrim(), whose default character set is an
  // ASCII space only — NOT JavaScript trim(), which also strips tabs,
  // newlines, NBSP and other Unicode whitespace. Match the server contract
  // exactly: strip U+0020 from both edges, then let the ASCII regex decide.
  const value = input.replace(/^ +| +$/g, "");
  if (value.length < 10 || value.length > 32 || !/^\+?[0-9 ()-]+$/.test(value)) {
    return null;
  }
  const digits = value.replace(/[^0-9]/g, "");
  const national = /^[6-9][0-9]{9}$/.test(digits)
    ? digits
    : /^91[6-9][0-9]{9}$/.test(digits)
      ? digits.slice(2)
      : null;
  return national ? `+91${national}` : null;
}

/**
 * Submit is enabled only when the typed input previews to a canonical number
 * AND the Creator has explicitly confirmed that exact canonical number.
 * Any input change invalidates the confirmation (the dialog resets state;
 * this predicate also returns false for a mismatched/stale confirmation).
 */
export function canSubmitWhatsappPhone(
  phoneInput: string,
  confirmedCanonical: string | null
): boolean {
  const preview = previewIndiaWhatsappPhone(phoneInput);
  return preview !== null && confirmedCanonical === preview;
}
