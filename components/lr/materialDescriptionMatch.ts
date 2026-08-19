/**
 * Deterministic Material Master suggestion from staff-entered LR description.
 * No AI / external APIs. Prefer "no match" over a wrong guess.
 *
 * Rule: WRONG MATERIAL is worse than NO MATCH.
 * Exact (normalized) description equality may be "exact".
 * Loose/substring matches are never "exact" — only "possible" / "multiple" / "none".
 */

export type MaterialMatchCandidate = {
  materialName: string;
  unit: string;
};

export type MaterialMatchResult =
  | { tier: "exact"; candidates: MaterialMatchCandidate[] }
  | { tier: "multiple"; candidates: MaterialMatchCandidate[] }
  | { tier: "possible"; candidates: MaterialMatchCandidate[] }
  | { tier: "none"; candidates: [] };

type MatchableMaterial = {
  materialName: string;
  description: string;
  unit: string;
  status?: string;
};

/** Minimum length for any matching attempt. */
const MIN_QUERY_LEN = 2;
/**
 * Loose/substring matching requires a longer query so short tokens like
 * "RDF" do not produce confident or noisy suggestions across many masters.
 */
const MIN_LOOSE_QUERY_LEN = 6;
/** Master description must also be long enough for a meaningful loose match. */
const MIN_LOOSE_DESC_LEN = 6;
/** Cap how many distinct names we surface for multi-match; above → none. */
const MAX_MULTIPLE_NAMES = 6;

/** Trim, lower-case, collapse spaces, strip simple punctuation. */
export function normalizeMatchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueByName(
  rows: MatchableMaterial[],
): MaterialMatchCandidate[] {
  const seen = new Set<string>();
  const out: MaterialMatchCandidate[] = [];
  for (const row of rows) {
    const key = row.materialName.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      materialName: row.materialName.trim(),
      unit: row.unit ?? "",
    });
  }
  return out;
}

/**
 * Match staff description against Material Master `description` values.
 * Active materials only (missing status treated as active).
 */
export function matchMaterialsByDescription(
  staffDescription: string,
  materials: MatchableMaterial[],
): MaterialMatchResult {
  const query = normalizeMatchText(staffDescription);
  if (query.length < MIN_QUERY_LEN) {
    return { tier: "none", candidates: [] };
  }

  const pool = materials.filter((m) => {
    const status = (m.status ?? "Active").trim();
    return status === "" || status === "Active";
  });

  const exactHits = pool.filter((m) => {
    const desc = normalizeMatchText(m.description ?? "");
    return desc.length > 0 && desc === query;
  });

  if (exactHits.length > 0) {
    const names = uniqueByName(exactHits);
    if (names.length === 1) {
      return { tier: "exact", candidates: names };
    }
    return { tier: "multiple", candidates: names };
  }

  // Short / generic non-exact input → refuse (e.g. "RDF" alone).
  if (query.length < MIN_LOOSE_QUERY_LEN) {
    return { tier: "none", candidates: [] };
  }

  // Loose substring — never promoted to "exact".
  const looseHits = pool.filter((m) => {
    const desc = normalizeMatchText(m.description ?? "");
    if (desc.length < MIN_LOOSE_DESC_LEN) return false;
    return desc.includes(query) || query.includes(desc);
  });

  if (looseHits.length === 0) {
    return { tier: "none", candidates: [] };
  }

  const names = uniqueByName(looseHits);
  if (names.length === 1) {
    return { tier: "possible", candidates: names };
  }
  if (names.length <= MAX_MULTIPLE_NAMES) {
    return { tier: "multiple", candidates: names };
  }
  return { tier: "none", candidates: [] };
}
