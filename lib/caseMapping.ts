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
