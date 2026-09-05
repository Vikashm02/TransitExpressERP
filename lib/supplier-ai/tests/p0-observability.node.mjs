/**
 * P0 observability — static safety checks.
 * Does NOT import server-only modules. Does NOT call OpenAI/Supabase.
 *
 * Run: node lib/supplier-ai/tests/p0-observability.node.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function main() {
  const diagSrc = read("lib/supplier-ai/diagnostics.ts");
  const gatewaySrc = read("lib/supplier-ai/gateway.ts");
  const retrievalSrc = read("lib/supplier-ai/retrieval.ts");
  const budgetSrc = read("lib/supplier-ai/budget.ts");
  const openaiSrc = read("lib/supplier-ai/openai-provider.ts");

  // Diagnostics module exists and is server-only
  assert.match(diagSrc, /import "server-only"/);
  assert.match(diagSrc, /supplier-ai retrieval:/);
  assert.match(diagSrc, /supplier-ai synthesis:/);
  assert.match(diagSrc, /supplier-ai response:/);
  assert.match(diagSrc, /createSupplierAiDiagnosticId/);
  assert.match(diagSrc, /characterCount/);
  assert.match(diagSrc, /conversationId/);

  // Must NOT log full conversation bodies / prompts / secrets
  // characterCount may read .originalText.length — must not put body text in logs.
  assert.doesNotMatch(diagSrc, /originalText\s*:/);
  assert.doesNotMatch(diagSrc, /original_text/);
  assert.doesNotMatch(
    diagSrc,
    /JSON\.stringify\([^\)]*originalText/,
  );
  assert.doesNotMatch(diagSrc, /userInput|systemInstructions|buildSynthesisUserInput/);
  assert.doesNotMatch(diagSrc, /OPENAI_API_KEY|SERVICE_ROLE|Authorization|Bearer/);
  assert.match(diagSrc, /questionLength/);
  assert.doesNotMatch(diagSrc, /question:\s*input/);

  // Gateway wires diagnostics without changing retrieval client
  assert.match(gatewaySrc, /logSupplierAiRetrievalDiagnostics/);
  assert.match(gatewaySrc, /logSupplierAiSynthesisDiagnostics/);
  assert.match(gatewaySrc, /logSupplierAiResponseDiagnostics/);
  assert.match(gatewaySrc, /createSupplierAiDiagnosticId/);
  assert.match(
    gatewaySrc,
    /fetchSupplierConversationsForUser\(input\.client/,
  );
  assert.doesNotMatch(gatewaySrc, /createServiceRoleSupabaseClient/);

  // Retrieval / budget / provider behavior surface unchanged by P0
  assert.doesNotMatch(retrievalSrc, /logSupplierAi|diagnostics/);
  assert.doesNotMatch(budgetSrc, /logSupplierAi|diagnostics/);
  assert.match(gatewaySrc, /tryReserveSupplierAiBudget/);
  assert.match(gatewaySrc, /provider\.complete/);
  assert.match(gatewaySrc, /mode === "DB_ONLY"/);
  assert.match(openaiSrc, /api\.openai\.com/);

  // No DB persistence of diagnostics
  assert.doesNotMatch(diagSrc, /\.from\(|insert\(|supabase/i);
  assert.doesNotMatch(gatewaySrc, /supplier_ai_diagnostic|diagnostic_logs/);

  console.log("p0-observability: PASS");
}

main();
