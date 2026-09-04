/**
 * Step 3 — accounting recovery safety (static).
 * Does NOT import server-only modules.
 * Does NOT call OpenAI or Supabase.
 *
 * Run: node lib/supplier-ai/tests/step2-recovery-safety.node.mjs
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
  const migrationSrc = read(
    "database/migrations/069_supplier_ai_usage_and_budget.sql",
  );

  // Recovery pin exists and uses far-future expiry (no new status / migration)
  assert.match(budgetSrc, /pinSupplierAiReservationForAccountingRecovery/);
  assert.match(budgetSrc, /SUPPLIER_AI_ACCOUNTING_RECOVERY_EXPIRES_AT/);
  assert.match(budgetSrc, /2099-12-31/);
  assert.match(budgetSrc, /\.update\(\{\s*expires_at:/);
  assert.match(budgetSrc, /\.eq\("status", "reserved"\)/);
  assert.doesNotMatch(budgetSrc, /accounting_pending/);

  // 069 expire only touches reserved where expires_at < now()
  assert.match(
    migrationSrc,
    /status = 'expired'[\s\S]*status = 'reserved'[\s\S]*expires_at < now\(\)/,
  );

  // Gateway: failsafe path then pin on both-fail; never release there
  assert.match(gatewaySrc, /usage_insert_retry/);
  assert.match(gatewaySrc, /pinSupplierAiReservationForAccountingRecovery/);

  const bothFailBlock = gatewaySrc.slice(
    gatewaySrc.indexOf("if (!failsafe.ok)"),
    gatewaySrc.indexOf("finalUsageId = failsafe.usageId"),
  );
  assert.ok(bothFailBlock.includes("pinSupplierAiReservationForAccountingRecovery"));
  assert.doesNotMatch(bothFailBlock, /releaseSupplierAiReservation/);
  assert.match(bothFailBlock, /usage_recording_failure/);

  // Provider failure still releases (before usageAvailable)
  const providerCatch = gatewaySrc.slice(
    gatewaySrc.indexOf("} catch (err) {"),
    gatewaySrc.indexOf("const usageAvailable"),
  );
  assert.match(providerCatch, /releaseSupplierAiReservation/);
  assert.doesNotMatch(providerCatch, /pinSupplierAiReservationForAccountingRecovery/);

  // Exactly one provider.complete — no retry
  assert.equal((gatewaySrc.match(/provider\.complete\(/g) || []).length, 1);

  // Normal success still consumes
  assert.match(gatewaySrc, /consumeSupplierAiReservation/);
  const consumeIdx = gatewaySrc.indexOf("consumeSupplierAiReservation");
  const pinIdx = gatewaySrc.indexOf("pinSupplierAiReservationForAccountingRecovery");
  assert.ok(pinIdx > 0 && consumeIdx > 0);

  // Hard-stop path unchanged: try_reserve still used; expire still only reserved+past
  assert.match(gatewaySrc, /tryReserveSupplierAiBudget/);
  assert.match(
    migrationSrc,
    /v_spent \+ v_held \+ p_reserved_cost_usd\) > v_budget/,
  );

  // No new migration file for recovery
  const migrations = fs.readdirSync(path.join(root, "database/migrations"));
  assert.ok(!migrations.some((name) => /070|accounting.?pending|recovery/i.test(name)));

  console.log("step2-recovery-safety: PASS");
}

main();
