import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Picks `keys` off `obj` into a new object. Used by edit dialogs to seed
 * form state from a DB record while dropping server-owned columns (`id`,
 * `created_at`, computed totals, etc.) that must never round-trip into an
 * update payload.
 *
 * A plain `for (const key of keys) result[key] = obj[key]` fails to
 * type-check when `T`'s properties have heterogeneous types, because
 * `keyof T` is a union and TS won't narrow `obj[key]`/`result[key]` to the
 * same member across iterations. Scoping the key type to a single generic
 * `K` (rather than the `keyof T` union) sidesteps that — TS treats `K` as
 * one opaque type for the whole function body.
 */
export function pickFields<T, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;

  for (const key of keys) {
    result[key] = obj[key];
  }

  return result;
}
