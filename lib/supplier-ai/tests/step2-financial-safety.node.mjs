/**
 * Focused financial-safety static checks (Phase 10D Step 2 remediation).
 * Does NOT import server-only modules.
 * Does NOT call OpenAI or Supabase.
 *
 * Run: node lib/supplier-ai/tests/step2-financial-safety.node.mjs
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
  const pricingSrc = read("lib/supplier-ai/pricing.ts");
  const gatewaySrc = read("lib/supplier-ai/gateway.ts");

  // --- BLOCKER 1: no /2 reservation heuristic ---
  assert.doesNotMatch(
    pricingSrc,
    /contextChars\s*\/\s*2|contextCharacterCount\s*\/\s*2|\/\s*2\)\s*\+\s*2_?500/,
    "must not use chars/2 for max reservation",
  );
  assert.match(
    pricingSrc,
    /contextChars\s*\+\s*SUPPLIER_AI_RESERVATION_FRAMING_TOKEN_OVERHEAD/,
  );
  assert.match(
    pricingSrc,
    /CONSERVATIVE BILLING RESERVATION CEILING|conservative billing reservation ceiling/i,
  );
  assert.match(pricingSrc, /NOT an average tokenizer estimate/i);
  assert.match(pricingSrc, /Hindi|Devanagari|CJK/);

  // Indic-heavy context must reserve ~1 token/char + overhead (formula presence)
  const formulaOk =
    /maxInputTokens\s*=\s*\n?\s*contextChars\s*\+\s*SUPPLIER_AI_RESERVATION_FRAMING_TOKEN_OVERHEAD/.test(
      pricingSrc,
    );
  assert.ok(formulaOk, "maxInputTokens = contextChars + framing overhead");

  // --- MEDIUM: zero pricing rejected ---
  assert.match(
    pricingSrc,
    /!\(parsed\s*>\s*0\)|parsed\s*>\s*0/,
  );
  assert.doesNotMatch(
    pricingSrc,
    /parsed\s*<\s*0\)\s*return null;\n\s*return parsed/,
  );
  // Explicit: zero must not pass — condition uses > 0
  assert.match(pricingSrc, /Number\.isFinite\(parsed\)\s*\|\|\s*!\(parsed\s*>\s*0\)/);

  // --- BLOCKER 2: failsafe path ---
  assert.match(gatewaySrc, /usage_insert_retry/);
  assert.match(gatewaySrc, /failsafe/i);

  // After provider success, normal insert then failsafe on failure
  const firstInsert = gatewaySrc.indexOf("insertSupplierAiUsage");
  const failsafeMarker = gatewaySrc.indexOf('errorCode: "usage_insert_retry"');
  const secondInsertRegion = gatewaySrc.indexOf(
    "insertSupplierAiUsage",
    firstInsert + 1,
  );
  assert.ok(firstInsert > 0, "normal usage insert present");
  assert.ok(secondInsertRegion > firstInsert, "failsafe insert is a second call");
  assert.ok(failsafeMarker > secondInsertRegion - 500, "failsafe uses usage_insert_retry");

  // Failsafe amount = reserved_cost_usd
  assert.match(
    gatewaySrc,
    /estimatedCostUsd:\s*reservation\.reserved_cost_usd/,
  );

  // Failsafe failure does not release; pins accounting recovery hold instead
  const failsafeFailBlock = gatewaySrc.slice(
    gatewaySrc.indexOf("if (!failsafe.ok)"),
    gatewaySrc.indexOf("finalUsageId = failsafe.usageId"),
  );
  assert.ok(failsafeFailBlock.length > 0, "failsafe failure branch present");
  assert.doesNotMatch(
    failsafeFailBlock,
    /releaseSupplierAiReservation/,
    "failsafe INSERT failure must not release reservation",
  );
  assert.match(failsafeFailBlock, /usage_recording_failure/);
  assert.match(
    failsafeFailBlock,
    /pinSupplierAiReservationForAccountingRecovery/,
  );
  // Provider failure still releases (and only once around provider catch)
  const providerCatch = gatewaySrc.slice(
    gatewaySrc.indexOf("} catch (err) {"),
    gatewaySrc.indexOf("const usageAvailable"),
  );
  assert.match(providerCatch, /releaseSupplierAiReservation/);
  assert.match(providerCatch, /provider_error|SupplierAiDisabledError/);

  // Single provider.complete call (no retry loop)
  const completeMatches = gatewaySrc.match(/provider\.complete\(/g) || [];
  assert.equal(completeMatches.length, 1, "exactly one provider.complete call");
  assert.doesNotMatch(gatewaySrc, /for\s*\(.*provider\.complete|while\s*\(.*complete/);

  // Provider is only after reserve
  assert.ok(
    gatewaySrc.indexOf("tryReserveSupplierAiBudget") <
      gatewaySrc.indexOf("provider.complete"),
  );

  console.log("step2-financial-safety: PASS");
}

main();
