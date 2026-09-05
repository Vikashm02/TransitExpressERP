/**
 * Phase 1B — Ask scope resolution + wiring checks.
 * Does NOT call OpenAI or Supabase. Does NOT import server-only modules.
 *
 * Run: node --experimental-strip-types lib/supplier-ai/tests/phase1b-ask-scope.node.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAskScopeFilters } from "../organization-type-filter.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function main() {
  const orgId = "11111111-1111-4111-8111-111111111111";
  const personId = "22222222-2222-4222-8222-222222222222";

  // 1. Existing organization Ask (scope organization)
  {
    const r = resolveAskScopeFilters({
      scope: "organization",
      organizationId: orgId,
      personId: null,
      organizationTypeSlug: "supplier",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.filters.organizationId, orgId);
      assert.equal(r.filters.personId, null);
      assert.equal(r.filters.organizationTypeSlugs, null);
    }
  }

  // 2. Existing person Ask
  {
    const r = resolveAskScopeFilters({
      scope: "organization",
      organizationId: orgId,
      personId,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.filters.personId, personId);
      assert.equal(r.filters.organizationId, orgId);
    }
  }

  // 3–5. Relationship type scopes (supplier / consignee / municipality)
  for (const slug of ["supplier", "consignee", "municipality"]) {
    const r = resolveAskScopeFilters({
      scope: "organization_type",
      organizationId: orgId,
      personId,
      organizationTypeSlug: slug,
    });
    assert.equal(r.ok, true, slug);
    if (r.ok) {
      assert.deepEqual(r.filters.organizationTypeSlugs, [slug]);
      // 10. person cleared for type scope
      assert.equal(r.filters.personId, null);
      assert.equal(r.filters.organizationId, null);
    }
  }

  // 6. Multi-type org: client picks one slug (server requires exactly one)
  {
    const r = resolveAskScopeFilters({
      scope: "organization_type",
      organizationTypeSlug: "processor",
      organizationTypeSlugs: ["supplier", "municipality"],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.filters.organizationTypeSlugs, ["processor"]);
    }
  }

  // organization_type without slug → fail
  {
    const r = resolveAskScopeFilters({
      scope: "organization_type",
      organizationId: orgId,
    });
    assert.equal(r.ok, false);
  }

  // 8. All organizations — clears org/person/type
  {
    const r = resolveAskScopeFilters({
      scope: "all",
      organizationId: orgId,
      personId,
      organizationTypeSlug: "supplier",
      organizationTypeSlugs: ["supplier"],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.filters.organizationId, null);
      assert.equal(r.filters.personId, null);
      assert.equal(r.filters.organizationTypeSlugs, null);
    }
  }

  // 9. Invalid empty type slug
  {
    const r = resolveAskScopeFilters({
      scope: "organization_type",
      organizationTypeSlug: "  ",
    });
    assert.equal(r.ok, false);
  }

  // 11. Back to organization restores org (+ optional person)
  {
    const r = resolveAskScopeFilters({
      scope: "organization",
      organizationId: orgId,
      personId,
      organizationTypeSlug: "supplier",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.filters.organizationId, orgId);
      assert.equal(r.filters.personId, personId);
      assert.equal(r.filters.organizationTypeSlugs, null);
    }
  }

  // Legacy no-scope keeps 1A multi-slug behavior
  {
    const r = resolveAskScopeFilters({
      organizationTypeSlugs: ["supplier", "municipality"],
      organizationId: orgId,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.filters.scope, null);
      assert.deepEqual(r.filters.organizationTypeSlugs, [
        "supplier",
        "municipality",
      ]);
      assert.equal(r.filters.organizationId, orgId);
    }
  }

  // organization scope requires organizationId
  {
    const r = resolveAskScopeFilters({ scope: "organization" });
    assert.equal(r.ok, false);
  }

  // --- Static wiring ---
  const gatewaySrc = read("lib/supplier-ai/gateway.ts");
  const decisionSrc = read("lib/supplier-ai/decision.ts");
  const decisionHeuristicsSrc = read("lib/supplier-ai/decision-heuristics.ts");
  const promptSrc = read("lib/supplier-ai/prompt.ts");
  const panelSrc = read("components/supplierIntelligence/AskIntelligencePanel.tsx");
  const budgetSrc = read("lib/supplier-ai/budget.ts");
  const openaiSrc = read("lib/supplier-ai/openai-provider.ts");
  const retrievalSrc = read("lib/supplier-ai/retrieval.ts");

  assert.match(gatewaySrc, /resolveAskScopeFilters/);
  assert.match(gatewaySrc, /scope:\s*z/);
  assert.match(gatewaySrc, /organizationTypeSlug/);
  assert.match(
    gatewaySrc,
    /decideSupplierAiPath\(input\.request\.question,\s*\{\s*scope:/,
  );
  assert.match(gatewaySrc, /mode === "DB_ONLY"/);
  assert.match(gatewaySrc, /tryReserveSupplierAiBudget/);
  assert.match(gatewaySrc, /fetchSupplierConversationsForUser\(input\.client/);
  assert.doesNotMatch(gatewaySrc, /createServiceRoleSupabaseClient/);

  assert.match(decisionHeuristicsSrc, /broad_scope_default_synthesis/);
  assert.match(decisionHeuristicsSrc, /organization_type/);
  assert.match(decisionSrc, /decideSupplierAiPath/);

  assert.match(promptSrc, /complete history|everything Transjit knows/i);
  assert.match(promptSrc, /RETRIEVAL SCOPE/);
  assert.match(promptSrc, /inference/i);

  assert.match(panelSrc, /This organization/);
  assert.match(panelSrc, /This relationship type/);
  assert.match(panelSrc, /All organizations/);
  assert.match(panelSrc, /personId:\s*\n?\s*scope === "organization"/);
  assert.match(panelSrc, /formatSourceLine|organizationName/);
  assert.match(panelSrc, /no active relationship type/i);

  // 12–14 budget/provider/retrieval safety unchanged by scope phase
  assert.doesNotMatch(budgetSrc, /scope ===|organizationTypeSlug/);
  assert.doesNotMatch(openaiSrc, /organizationTypeSlug|AskScope/);
  assert.doesNotMatch(retrievalSrc, /service_role|SERVICE_ROLE|createServiceRole/);

  // Ask schema still rejects client model/limit
  const schemaMatch = gatewaySrc.match(
    /const askBodySchema = z\.object\(\{([\s\S]*?)\}\);/,
  );
  assert.ok(schemaMatch);
  assert.doesNotMatch(schemaMatch[1], /\bmodel\b/);
  assert.doesNotMatch(
    schemaMatch[1],
    /max_tokens|temperature|maxOutputTokens|\blimit\b/,
  );

  console.log("phase1b-ask-scope: PASS");
}

main();
