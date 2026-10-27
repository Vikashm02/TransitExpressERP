import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Supabase (PostgREST) returns at most `max_rows` rows per request
 * (1000 by default) and silently drops the rest. List reads that must
 * see the whole table go through this helper, which requests
 * consecutive `.range()` pages until an empty page comes back.
 *
 * - Read-only: it only issues SELECTs built by the caller.
 * - Advances by the number of rows actually returned, so a server cap
 *   lower than PAGE_SIZE still yields every row.
 * - Callers must order by a unique column last (e.g. `id`) so pages are
 *   stable; rows are also de-duplicated by `id` in case a row inserted
 *   mid-read shifts a page boundary.
 */
export const SUPABASE_PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: PostgrestError | null };

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = SUPABASE_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  const seenIds = new Set<unknown>();
  let from = 0;

  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;

    const page = data ?? [];
    if (page.length === 0) break;

    for (const row of page) {
      const id = (row as { id?: unknown } | null)?.id;
      if (id !== undefined && id !== null) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      rows.push(row);
    }
    from += page.length;
  }

  return rows;
}
