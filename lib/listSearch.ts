/**
 * Shared search for list (landing) pages.
 *
 * A row matches when every word typed in the search box appears somewhere in
 * the values the page shows for that row (case-insensitive), so "acc chanda"
 * finds a row whose billing party is "M/S ACC LIMITED - CHANDA".
 *
 * To match what people see and type:
 * - dates stored as YYYY-MM-DD also match DD-MM-YYYY and DD/MM/YYYY
 * - numbers also match their Indian-formatted form (1,23,456.5)
 * - spaces, hyphens, dots and slashes are ignored inside a word, so
 *   "MH12AB1234" finds "MH 12 AB 1234"
 *
 * Pure function: filtering only, never changes data.
 */

const FIELD_SEPARATOR = "\u0000";
const IGNORED_INSIDE_WORD = /[\s\-./]/g;

function expandValue(value: unknown): string[] {
  if (value === null || value === undefined || typeof value === "boolean") return [];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return [];
    return [String(value), value.toLocaleString("en-IN", { maximumFractionDigits: 3 })];
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? [] : expandValue(value.toISOString().slice(0, 10));
  }
  const text = String(value).trim();
  if (!text) return [];
  const date = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (date) {
    const [, y, m, d] = date;
    return [text, `${d}-${m}-${y}`, `${d}/${m}/${y}`];
  }
  return [text];
}

/** Lower-cased searchable text for a row's displayed values. */
export function buildSearchText(values: unknown[]): string {
  return values.flatMap(expandValue).join(FIELD_SEPARATOR).toLowerCase();
}

export function matchesListSearch(query: string, values: unknown[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const text = buildSearchText(values);
  const compact = text.replace(IGNORED_INSIDE_WORD, "");
  return words.every((word) => {
    if (text.includes(word)) return true;
    const compactWord = word.replace(IGNORED_INSIDE_WORD, "");
    return compactWord.length > 0 && compact.includes(compactWord);
  });
}
