/**
 * Shared snake_case <-> camelCase mapping layer for every Supabase service.
 *
 * Supabase/Postgres columns are snake_case; the app's domain types
 * (Customer, Vehicle, Company, ...) are camelCase. Every service maps
 * through these two generic helpers instead of hand-writing a field-by-field
 * `toRow`/`fromRow` per module — that hand-written approach is what let
 * `vehicle.service.ts` silently skip its read-side mapping entirely.
 *
 * Callers remain responsible for value-level concerns (null coalescing,
 * business-rule defaults, fields excluded from updates, etc) — these
 * helpers only ever rename keys, they never touch values.
 */

export function toSnakeCase(key: string): string {
  return key.replace(/([A-Z])/g, (letter) => `_${letter.toLowerCase()}`);
}

export function toCamelCase(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/** Converts every top-level key of `input` from camelCase to snake_case. */
export function objectToSnakeCase<T extends Record<string, unknown>>(
  input: T
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    result[toSnakeCase(key)] = value;
  }

  return result;
}

/** Converts every top-level key of `input` from snake_case to camelCase. */
export function objectToCamelCase<T = Record<string, unknown>>(
  input: Record<string, unknown>
): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    result[toCamelCase(key)] = value;
  }

  return result as T;
}

/**
 * Server-owned columns that must never appear in an UPDATE payload. `id` is
 * a Postgres `GENERATED ALWAYS AS IDENTITY` column on every table in this
 * app — Supabase rejects (HTTP 400, code 428C9) *any* update payload that
 * includes it, regardless of value. `created_at`/`updated_at` and the
 * Operations audit columns (`created_by`/`updated_by`/`draft_created_by`) are
 * likewise set by the database / triggers, never the client.
 *
 * Edit dialogs across the app seed their form state from the full DB
 * record (`{ ...emptyX, ...record }`), which means `id`/`created_at`
 * silently ride along into `onSubmit`. Services must strip them here,
 * at the last mile before hitting Supabase, rather than trust every
 * caller to have already excluded them.
 */
const SERVER_OWNED_FIELDS = [
  "id",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "draft_created_by",
  "createdBy",
  "updatedBy",
  "draftCreatedBy",
] as const;

export function omitServerFields<T extends Record<string, unknown>>(
  input: T
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...input };

  for (const field of SERVER_OWNED_FIELDS) {
    delete result[field];
  }

  return result;
}
