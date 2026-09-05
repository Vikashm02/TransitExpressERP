/**
 * Pure organization-relationship-type + Ask scope helpers for Supplier AI.
 * No DB access. No server-only import (safe for Node unit tests).
 *
 * Slugs are resolved against public.supplier_organization_types at retrieval time.
 * Clients must never supply arbitrary organization type UUIDs for filtering.
 *
 * When Ask `scope` is set, it is authoritative over conflicting client fields.
 * When `scope` is omitted, Phase 1A field-based behavior is preserved.
 */

export const SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUGS = 5;
export const SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUG_LENGTH = 50;

export type SupplierAiAskScope =
  | "organization"
  | "organization_type"
  | "all";

export const SUPPLIER_AI_ASK_SCOPES: readonly SupplierAiAskScope[] = [
  "organization",
  "organization_type",
  "all",
] as const;

export function isSupplierAiAskScope(value: unknown): value is SupplierAiAskScope {
  return (
    value === "organization" ||
    value === "organization_type" ||
    value === "all"
  );
}

export type OrganizationTypeSlugsNormalizeSuccess = {
  ok: true;
  /** null = no type filter (omit / null input). */
  slugs: string[] | null;
};

export type OrganizationTypeSlugsNormalizeFailure = {
  ok: false;
  message: string;
};

export type OrganizationTypeSlugsNormalizeResult =
  | OrganizationTypeSlugsNormalizeSuccess
  | OrganizationTypeSlugsNormalizeFailure;

/**
 * Normalize optional organizationTypeSlugs from the ask/retrieval query.
 * - omitted / null → no filter
 * - empty array, empty entries, >5, >50 chars → validation failure
 * - trim + lowercase for matching; dedupe while preserving first-seen order
 */
export function normalizeOrganizationTypeSlugs(
  input: string[] | null | undefined,
): OrganizationTypeSlugsNormalizeResult {
  if (input == null) {
    return { ok: true, slugs: null };
  }

  if (!Array.isArray(input)) {
    return {
      ok: false,
      message: "organizationTypeSlugs must be an array of relationship type slugs.",
    };
  }

  if (input.length === 0) {
    return {
      ok: false,
      message: "organizationTypeSlugs must not be empty when provided.",
    };
  }

  if (input.length > SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUGS) {
    return {
      ok: false,
      message: `At most ${SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUGS} organization relationship types are allowed.`,
    };
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    if (typeof raw !== "string") {
      return {
        ok: false,
        message: "organizationTypeSlugs entries must be strings.",
      };
    }

    const slug = raw.trim().toLowerCase();
    if (!slug) {
      return {
        ok: false,
        message: "organizationTypeSlugs entries must not be empty.",
      };
    }

    if (slug.length > SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUG_LENGTH) {
      return {
        ok: false,
        message: `Each organization relationship type slug must be at most ${SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUG_LENGTH} characters.`,
      };
    }

    if (seen.has(slug)) continue;
    seen.add(slug);
    normalized.push(slug);
  }

  if (normalized.length === 0) {
    return {
      ok: false,
      message: "organizationTypeSlugs must not be empty when provided.",
    };
  }

  return { ok: true, slugs: normalized };
}

export type ResolvedAskScopeFilters = {
  scope: SupplierAiAskScope | null;
  organizationId: string | null;
  personId: string | null;
  organizationTypeSlugs: string[] | null;
};

export type ResolveAskScopeResult =
  | { ok: true; filters: ResolvedAskScopeFilters }
  | { ok: false; message: string };

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Resolve ask filters from scope + raw request fields.
 * Scope (when present) is authoritative.
 */
export function resolveAskScopeFilters(input: {
  scope?: SupplierAiAskScope | null;
  organizationId?: string | null;
  personId?: string | null;
  organizationTypeSlug?: string | null;
  organizationTypeSlugs?: string[] | null;
}): ResolveAskScopeResult {
  const scope = input.scope ?? null;
  const organizationId = emptyToNull(input.organizationId ?? null);
  const personId = emptyToNull(input.personId ?? null);
  const organizationTypeSlug = emptyToNull(input.organizationTypeSlug ?? null);

  // --- Phase 1A compatibility: no scope → trust explicit fields as before ---
  if (scope == null) {
    const typeResult = normalizeOrganizationTypeSlugs(
      input.organizationTypeSlugs,
    );
    if (!typeResult.ok) {
      return { ok: false, message: typeResult.message };
    }
    return {
      ok: true,
      filters: {
        scope: null,
        organizationId,
        personId,
        organizationTypeSlugs: typeResult.slugs,
      },
    };
  }

  if (scope === "organization") {
    if (!organizationId) {
      return {
        ok: false,
        message: "organization scope requires a valid organizationId.",
      };
    }
    return {
      ok: true,
      filters: {
        scope,
        organizationId,
        personId,
        organizationTypeSlugs: null,
      },
    };
  }

  if (scope === "organization_type") {
    const slugSource =
      organizationTypeSlug != null
        ? [organizationTypeSlug]
        : input.organizationTypeSlugs ?? null;
    const typeResult = normalizeOrganizationTypeSlugs(slugSource);
    if (!typeResult.ok) {
      return {
        ok: false,
        message:
          typeResult.message ===
          "organizationTypeSlugs must not be empty when provided."
            ? "organization_type scope requires a valid organizationTypeSlug."
            : typeResult.message,
      };
    }
    if (!typeResult.slugs || typeResult.slugs.length !== 1) {
      return {
        ok: false,
        message:
          "organization_type scope requires exactly one organizationTypeSlug.",
      };
    }
    // Authoritative: clear org/person so type scope cannot shrink to one person.
    return {
      ok: true,
      filters: {
        scope,
        organizationId: null,
        personId: null,
        organizationTypeSlugs: typeResult.slugs,
      },
    };
  }

  // scope === "all"
  return {
    ok: true,
    filters: {
      scope: "all",
      organizationId: null,
      personId: null,
      organizationTypeSlugs: null,
    },
  };
}

/** Human-readable scope label for prompts / UI hints (not user-facing copy). */
export function describeAskScopeForPrompt(
  scope: SupplierAiAskScope | null,
  organizationTypeSlugs: string[] | null,
): string {
  if (scope === "organization" || scope == null) {
    return "organization-scoped retrieval (single organization and optional person)";
  }
  if (scope === "organization_type") {
    const slug = organizationTypeSlugs?.[0] ?? "unknown";
    return `relationship-type retrieval (organizations with type "${slug}")`;
  }
  return "cross-organization retrieval (no organization or type filter)";
}
