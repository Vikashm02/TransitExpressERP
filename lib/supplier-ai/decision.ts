/**
 * Architecture helpers for database-only vs synthesis routing.
 * Conservative rule-based heuristics — no OpenAI / classifier.
 *
 * Pure logic lives in decision-heuristics.ts (testable without server-only).
 */

import "server-only";

import {
  decideSupplierAiPath as decideSupplierAiPathPure,
  decisionKindToAskMode as decisionKindToAskModePure,
} from "./decision-heuristics";
import type { SupplierAiAskMode, SupplierAiAskScope, SupplierAiDecision } from "./types";

/**
 * Cheap heuristic only. Prefer database_only when unsure until a real
 * classifier exists — avoids accidental OpenAI spend.
 *
 * Phase 1B: broader scopes (relationship type / all orgs) default to synthesis
 * for open questions, while clear listing/lookup questions stay DB_ONLY.
 */
export function decideSupplierAiPath(
  question: string,
  context?: { scope?: SupplierAiAskScope | null },
): SupplierAiDecision {
  return decideSupplierAiPathPure(question, context);
}

export function decisionKindToAskMode(
  kind: SupplierAiDecision["kind"],
): SupplierAiAskMode {
  return decisionKindToAskModePure(kind);
}
