import type { z } from "zod";

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

/**
 * Runs a zod schema against `values` and returns a flat field -> message
 * error map compatible with FormField / FormSelect's `error` prop.
 *
 * Returns an empty object when `values` is valid.
 *
 * Usage (per-module `<module>.schema.ts`):
 *
 * ```ts
 * export const customerSchema = z.object({ ... });
 * export type Customer = z.infer<typeof customerSchema>;
 *
 * export function validateCustomer(values: Customer) {
 *   return getFieldErrors(customerSchema, values);
 * }
 * ```
 */
export function getFieldErrors<Schema extends z.ZodTypeAny>(
  schema: Schema,
  values: unknown
): FieldErrors<z.infer<Schema>> {
  const result = schema.safeParse(values);

  if (result.success) {
    return {};
  }

  const errors: Record<string, string> = {};

  for (const issue of result.error.issues) {
    const key = issue.path[0];

    if (typeof key === "string" && !(key in errors)) {
      errors[key] = issue.message;
    }
  }

  return errors as FieldErrors<z.infer<Schema>>;
}
