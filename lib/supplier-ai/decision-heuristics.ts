/**
 * Pure Ask intent heuristics (no server-only).
 * Used by decision.ts and Node unit tests.
 *
 * Names / org labels are NOT used — only question phrasing.
 */

export type SupplierAiDecisionKind = "database_only" | "synthesis";

export type SupplierAiAskScope =
  | "organization"
  | "organization_type"
  | "all";

export interface SupplierAiDecision {
  kind: SupplierAiDecisionKind;
  reason: string;
}

/**
 * Clear listing / lookup phrasing → DB_ONLY when interpretation does not also apply.
 * Keep adjacent/phrase-oriented to avoid catching interpretive "what … say" questions.
 */
const DATABASE_HINTS =
  /\b(?:show(?:\s+me)?(?:\s+the)?\s+conversations?|show\s+conversations?(?:\s+mentioning)?|list(?:\s+my)?\s+(?:meetings?|conversations?|orgs|organizations|people|contacts)|what\s+conversations?|conversations?\s+(?:do|did)\s+we\s+have|which\s+organizations|my\s+meetings\s+with|last\s+meeting|when\s+(?:was|were|is|are)\s+(?:my\s+)?last\s+meeting|who\s+(?:did|have|was)\s+i\s+speak|who\s+did\s+i\s+speak|spoke\s+to|speak\s+to|talked\s+to|contact(?:s)?\s+(?:at|with)|have\s+we\s+(?:logged|recorded))\b/i;

/**
 * Interpretive / synthesis phrasing — content meaning, not record listing.
 * Tolerates common what did/does/has/have and say/mention/suggest variants.
 */
const SYNTHESIS_HINTS =
  /\b(?:summar(?:y|ise|ize|ised|ized)|explain|interprete?|analy[sz]e|insights?|themes?|recurring|overall|across|major|based\s+on\s+our\s+conversations|tell\s+me\s+about|important\s+points?|what\s+(?:did|does|has|have)\b|what\s+(?:was|were)\s+(?:the\s+)?important|did\s+\w[\w'-]{0,40}\s+(?:say|said|tell|told|mention|mentioned|suggest|suggested|recommend|recommended|discuss|discussed|raise|raised)|(?:say|said|tell|told|mention|mentioned|suggest|suggested|recommend|recommended|discuss|discussed|raise|raised)\s+(?:anything\s+)?about|what\s+\w[\w'-]{0,40}\s+(?:say|said|tell|told|mention|mentioned|suggest|suggested|recommend|recommended|discuss|discussed|raise|raised)|concerns?|risks?|hurdles?|opportunit(?:y|ies)|commitments?|expectations?|challenges?|solutions?|problems?|learn(?:ed|ing)?)\b/i;

/**
 * Cheap deterministic intent routing.
 * Priority:
 * 1) empty
 * 2) clear interpretation → synthesis (wins over listing phrases like "my meetings with")
 * 3) clear listing → database_only
 * 4) broad scope default → synthesis
 * 5) conservative database_only fallback (does NOT auto-spend AI)
 */
export function decideSupplierAiPath(
  question: string,
  context?: { scope?: SupplierAiAskScope | null },
): SupplierAiDecision {
  const q = question.trim().replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  if (!q) {
    return { kind: "database_only", reason: "empty_question" };
  }

  // Interpretive intent first so "Summarize my meetings…" is SYNTHESIS, not listing.
  if (SYNTHESIS_HINTS.test(q)) {
    return { kind: "synthesis", reason: "synthesis_heuristic" };
  }

  if (DATABASE_HINTS.test(q)) {
    return { kind: "database_only", reason: "lookup_heuristic" };
  }

  const scope = context?.scope ?? null;
  if (scope === "organization_type" || scope === "all") {
    return { kind: "synthesis", reason: "broad_scope_default_synthesis" };
  }

  return { kind: "database_only", reason: "default_retrieval_first" };
}

export function decisionKindToAskMode(
  kind: SupplierAiDecisionKind,
): "DB_ONLY" | "SYNTHESIS" {
  return kind === "synthesis" ? "SYNTHESIS" : "DB_ONLY";
}
