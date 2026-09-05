/**
 * Static safety checks for Phase 10D Step 2.
 * Does NOT import server-only modules (avoids Node/server-only throw).
 * Does NOT call OpenAI. Does NOT touch Supabase.
 *
 * Run: node lib/supplier-ai/tests/step2-safety.node.mjs
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
  const gatewaySrc = read("lib/supplier-ai/gateway.ts");
  const budgetSrc = read("lib/supplier-ai/budget.ts");
  const serviceSrc = read("lib/supabase/server-service-role.ts");
  const openaiSrc = read("lib/supplier-ai/openai-provider.ts");
  const routeSrc = read("app/api/supplier/intelligence/ask/route.ts");
  const configSrc = read("lib/supplier-ai/config.ts");
  const pricingSrc = read("lib/supplier-ai/pricing.ts");
  const promptSrc = read("lib/supplier-ai/prompt.ts");
  const decisionSrc = read("lib/supplier-ai/decision.ts");
  const decisionHeuristicsSrc = read("lib/supplier-ai/decision-heuristics.ts");
  const packageJson = JSON.parse(read("package.json"));

  // Kill switch default
  assert.match(configSrc, /readBool\("SUPPLIER_AI_ENABLED", false\)/);

  // Decision heuristics present
  assert.match(decisionHeuristicsSrc, /database_only/);
  assert.match(decisionHeuristicsSrc, /synthesis/);
  assert.match(decisionHeuristicsSrc, /opportunit/);
  assert.match(decisionSrc, /decideSupplierAiPath/);

  // Ask schema has no client model/limit overrides
  const schemaMatch = gatewaySrc.match(
    /const askBodySchema = z\.object\(\{([\s\S]*?)\}\);/,
  );
  assert.ok(schemaMatch, "askBodySchema present");
  const schemaBody = schemaMatch[1];
  assert.doesNotMatch(schemaBody, /\bmodel\b/);
  assert.doesNotMatch(schemaBody, /max_tokens|temperature|maxOutputTokens|limit/);
  assert.match(schemaBody, /question/);
  assert.match(schemaBody, /organizationId/);
  assert.match(schemaBody, /personId/);
  // Phase 1A/1B optional type + scope filters; still no client model/limit.
  assert.match(schemaBody, /organizationTypeSlugs/);
  assert.match(schemaBody, /organizationTypeSlug/);
  assert.match(schemaBody, /\bscope\b/);

  // CRITICAL ordering: reserve before provider.complete
  const reserveIdx = gatewaySrc.indexOf("tryReserveSupplierAiBudget");
  const providerIdx = gatewaySrc.indexOf("provider.complete");
  assert.ok(reserveIdx > 0, "reservation call present");
  assert.ok(providerIdx > reserveIdx, "reserve BEFORE provider.complete");

  // DB_ONLY path skips provider
  assert.match(gatewaySrc, /mode === "DB_ONLY"/);
  assert.match(gatewaySrc, /ai_disabled/);
  assert.match(gatewaySrc, /budget_exhausted/);

  // Service role isolated from retrieval
  assert.match(budgetSrc, /import "server-only"/);
  assert.match(budgetSrc, /createServiceRoleSupabaseClient/);
  assert.doesNotMatch(budgetSrc, /supplier_conversations/);
  assert.match(serviceSrc, /import "server-only"/);
  assert.doesNotMatch(serviceSrc, /NEXT_PUBLIC_.*SERVICE/);
  assert.match(serviceSrc, /SUPABASE_SERVICE_ROLE_KEY/);

  // Gateway must not mix service-role construction into retrieval path
  assert.doesNotMatch(gatewaySrc, /createServiceRoleSupabaseClient/);
  assert.match(gatewaySrc, /getPrivilegedSupplierAiClient/);
  assert.match(gatewaySrc, /fetchSupplierConversationsForUser\(input\.client/);

  // Provider: timeout + no fabricated usage + no public key
  assert.match(openaiSrc, /AbortController/);
  assert.match(openaiSrc, /usageAvailable/);
  assert.doesNotMatch(openaiSrc, /NEXT_PUBLIC_OPENAI/);
  assert.match(openaiSrc, /getSupplierAiDefaultModel\(\)/);

  // Pricing fail-closed + conservative reservation (no /2)
  assert.match(pricingSrc, /FAIL CLOSED|fail closed|pricing_not_configured/i);
  assert.match(pricingSrc, /gpt-4o-mini/);
  assert.doesNotMatch(pricingSrc, /contextChars\s*\/\s*2/);
  assert.match(
    pricingSrc,
    /contextChars\s*\+\s*SUPPLIER_AI_RESERVATION_FRAMING_TOKEN_OVERHEAD/,
  );
  assert.match(pricingSrc, /!\(parsed\s*>\s*0\)/);

  // Failsafe usage path after successful provider
  assert.match(gatewaySrc, /usage_insert_retry/);
  assert.match(gatewaySrc, /reservation\.reserved_cost_usd/);

  // Prompt separation
  assert.match(promptSrc, /untrusted/);
  assert.match(promptSrc, /RETRIEVED SUPPLIER BUSINESS CONTENT/);
  assert.match(promptSrc, /SUPPLIER_AI_SYSTEM_INSTRUCTIONS/);

  // Route: no secrets, strips contentBlocks
  assert.doesNotMatch(routeSrc, /SERVICE_ROLE/);
  assert.doesNotMatch(routeSrc, /OPENAI_API_KEY/);
  assert.match(routeSrc, /contentBlocks/);

  // server-only dependency present
  assert.ok(packageJson.dependencies?.["server-only"]);

  // Release on provider failure
  assert.match(gatewaySrc, /releaseSupplierAiReservation/);
  assert.match(gatewaySrc, /insertSupplierAiUsage/);
  assert.match(gatewaySrc, /consumeSupplierAiReservation/);

  // No real OpenAI URL invocation outside openai-provider
  assert.doesNotMatch(gatewaySrc, /api\.openai\.com/);
  assert.doesNotMatch(budgetSrc, /api\.openai\.com/);
  assert.match(openaiSrc, /api\.openai\.com/);

  console.log("step2-safety: PASS");
}

main();
