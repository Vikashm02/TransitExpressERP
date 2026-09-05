/**
 * Decision-router correction tests (interpretive vs listing).
 * Does NOT import server-only. Does NOT call OpenAI/Supabase.
 *
 * Run: node --experimental-strip-types lib/supplier-ai/tests/decision-router.node.mjs
 */

import assert from "node:assert/strict";
import {
  decideSupplierAiPath,
  decisionKindToAskMode,
} from "../decision-heuristics.ts";

function assertSynthesis(question, scope = "organization") {
  const d = decideSupplierAiPath(question, { scope });
  assert.equal(
    d.kind,
    "synthesis",
    `expected SYNTHESIS for ${JSON.stringify(question)} (scope=${scope}), got ${d.kind}/${d.reason}`,
  );
  assert.equal(d.reason, "synthesis_heuristic");
  assert.equal(decisionKindToAskMode(d.kind), "SYNTHESIS");
}

function assertLookup(question, scope = "organization") {
  const d = decideSupplierAiPath(question, { scope });
  assert.equal(
    d.kind,
    "database_only",
    `expected DB_ONLY for ${JSON.stringify(question)} (scope=${scope}), got ${d.kind}/${d.reason}`,
  );
  assert.equal(d.reason, "lookup_heuristic");
  assert.equal(decisionKindToAskMode(d.kind), "DB_ONLY");
}

function main() {
  // --- SYNTHESIS matrix ---
  const synthesisQuestions = [
    "What did Niranjan say about biomass?",
    "What does Niranjan say about biomass?",
    "What has Niranjan said about biomass?",
    "Did Niranjan say anything about biomass?",
    "What did Niranjan tell me about delivery?",
    "What solution did he suggest?",
    "What concerns did Niranjan raise?",
    "What hurdles were discussed?",
    "Summarize my meetings with Niranjan.",
    "What were the important points?",
    "What opportunities were discussed?",
    "What commitments were made?",
  ];

  for (const q of synthesisQuestions) {
    assertSynthesis(q, "organization");
    assertSynthesis(q, "organization_type");
    assertSynthesis(q, "all");
  }

  // NBSP-normalized "What did …"
  assertSynthesis("What\u00a0did Niranjan say about biomass?", "organization");

  // --- DB_ONLY matrix ---
  const lookupQuestions = [
    "Show me the conversations with Niranjan.",
    "List my meetings with Niranjan.",
    "What conversations do we have with Niranjan?",
    "When was my last meeting with Niranjan?",
    "Who did I speak to last?",
    "Show conversations mentioning RDF.",
  ];

  for (const q of lookupQuestions) {
    assertLookup(q, "organization");
    // Clear listing must not be overridden by broad-scope default.
    assertLookup(q, "organization_type");
    assertLookup(q, "all");
  }

  // Ambiguous / unknown → conservative fallback (org scope)
  {
    const d = decideSupplierAiPath("Hello", { scope: "organization" });
    assert.equal(d.kind, "database_only");
    assert.equal(d.reason, "default_retrieval_first");
  }

  // Ambiguous under broad scope → synthesis default (Phase 1B)
  {
    const d = decideSupplierAiPath("Hello", { scope: "all" });
    assert.equal(d.kind, "synthesis");
    assert.equal(d.reason, "broad_scope_default_synthesis");
  }

  // Intent must not depend on names alone
  {
    const d = decideSupplierAiPath("Niranjan Dalmia", {
      scope: "organization",
    });
    assert.equal(d.kind, "database_only");
    assert.equal(d.reason, "default_retrieval_first");
  }

  // Empty
  {
    const d = decideSupplierAiPath("   ");
    assert.equal(d.kind, "database_only");
    assert.equal(d.reason, "empty_question");
  }

  console.log("decision-router: PASS");
}

main();
