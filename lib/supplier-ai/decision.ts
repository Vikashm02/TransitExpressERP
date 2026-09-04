/**
 * Architecture helpers for database-only vs synthesis routing.
 * Conservative rule-based heuristics — no OpenAI / classifier.
 */

import "server-only";

import type { SupplierAiAskMode, SupplierAiDecision } from "./types";

const SYNTHESIS_HINTS =
  /\b(summar(y|ise|ize)|recommend|opportunit(y|ies)|challenge|concerns?|risks?|learn(ed|ing)?|tell me about|what did|insights?|overall|across|major|interpret|analy[sz]e|themes?|based on our conversations)\b/i;

const DATABASE_HINTS =
  /\b(who (did|have|was)|spoke to|speak to|talked to|last meeting|show conversations?|list (orgs|organizations|people|contacts)|which organizations|my meetings with|what conversations|conversations? (do|did) we have|contact(s)? (at|with)|have we (logged|recorded)|who did i speak)\b/i;

/**
 * Cheap heuristic only. Prefer database_only when unsure until a real
 * classifier exists — avoids accidental OpenAI spend.
 */
export function decideSupplierAiPath(question: string): SupplierAiDecision {
  const q = question.trim();
  if (!q) {
    return { kind: "database_only", reason: "empty_question" };
  }
  if (DATABASE_HINTS.test(q) && !SYNTHESIS_HINTS.test(q)) {
    return { kind: "database_only", reason: "lookup_heuristic" };
  }
  if (SYNTHESIS_HINTS.test(q)) {
    return { kind: "synthesis", reason: "synthesis_heuristic" };
  }
  // Default conservative: retrieval first; gateway may still answer from DB hits.
  return { kind: "database_only", reason: "default_retrieval_first" };
}

export function decisionKindToAskMode(kind: SupplierAiDecision["kind"]): SupplierAiAskMode {
  return kind === "synthesis" ? "SYNTHESIS" : "DB_ONLY";
}
