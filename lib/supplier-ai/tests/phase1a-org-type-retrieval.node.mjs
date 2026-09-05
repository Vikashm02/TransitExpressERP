/**
 * Phase 1A — organization relationship-type retrieval foundation.
 * Does NOT call OpenAI or Supabase. Does NOT import server-only modules.
 *
 * Run: node --experimental-strip-types lib/supplier-ai/tests/phase1a-org-type-retrieval.node.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeOrganizationTypeSlugs,
  SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUGS,
  SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUG_LENGTH,
} from "../organization-type-filter.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function main() {
  // --- Pure slug normalization / validation ---
  assert.equal(SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUGS, 5);
  assert.equal(SUPPLIER_AI_MAX_ORGANIZATION_TYPE_SLUG_LENGTH, 50);

  // 1. No type filter → existing behavior (null / undefined)
  assert.deepEqual(normalizeOrganizationTypeSlugs(undefined), {
    ok: true,
    slugs: null,
  });
  assert.deepEqual(normalizeOrganizationTypeSlugs(null), {
    ok: true,
    slugs: null,
  });

  // 2. ["supplier"] → supplier only (normalized)
  assert.deepEqual(normalizeOrganizationTypeSlugs(["supplier"]), {
    ok: true,
    slugs: ["supplier"],
  });
  assert.deepEqual(normalizeOrganizationTypeSlugs(["  Supplier  "]), {
    ok: true,
    slugs: ["supplier"],
  });

  // 3. ["consignee"]
  assert.deepEqual(normalizeOrganizationTypeSlugs(["consignee"]), {
    ok: true,
    slugs: ["consignee"],
  });

  // 4. ["supplier", "municipality"] → either type (OR)
  assert.deepEqual(
    normalizeOrganizationTypeSlugs(["supplier", "municipality"]),
    { ok: true, slugs: ["supplier", "municipality"] },
  );

  // Dedupes
  assert.deepEqual(
    normalizeOrganizationTypeSlugs(["supplier", "Supplier", "SUPPLIER"]),
    { ok: true, slugs: ["supplier"] },
  );

  // 7. empty / blank → validation error
  assert.equal(normalizeOrganizationTypeSlugs([]).ok, false);
  assert.equal(normalizeOrganizationTypeSlugs([""]).ok, false);
  assert.equal(normalizeOrganizationTypeSlugs(["  "]).ok, false);

  // 8. more than 5 types → validation error
  const six = [
    "consignee",
    "supplier",
    "municipality",
    "processor",
    "transporter",
    "broker",
  ];
  const over = normalizeOrganizationTypeSlugs(six);
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.match(over.message, /At most 5/);
  }

  // slug too long
  const long = normalizeOrganizationTypeSlugs(["a".repeat(51)]);
  assert.equal(long.ok, false);

  // --- Static retrieval / gateway wiring ---
  const retrievalSrc = read("lib/supplier-ai/retrieval.ts");
  const gatewaySrc = read("lib/supplier-ai/gateway.ts");
  const typesSrc = read("lib/supplier-ai/types.ts");
  const filterSrc = read("lib/supplier-ai/organization-type-filter.ts");
  const decisionSrc = read("lib/supplier-ai/decision.ts");
  const openaiSrc = read("lib/supplier-ai/openai-provider.ts");
  const budgetSrc = read("lib/supplier-ai/budget.ts");

  // Types expose organizationTypeSlugs
  assert.match(typesSrc, /organizationTypeSlugs\?:/);

  // Retrieval resolves against existing type tables (not client type UUIDs)
  assert.match(retrievalSrc, /supplier_organization_types/);
  assert.match(retrievalSrc, /supplier_organization_type_links/);
  assert.match(retrievalSrc, /normalizeOrganizationTypeSlugs/);
  assert.match(retrievalSrc, /resolveOrganizationIdsForTypeSlugs/);
  assert.match(retrievalSrc, /\.eq\("active", true\)/);
  assert.match(retrievalSrc, /Unknown organization relationship type/);

  // Intersection: org + type short-circuit when org not in type set
  assert.match(
    retrievalSrc,
    /organizationIdsForTypeFilter\.includes\(orgId\)/,
  );

  // Type-only path uses .in("organization_id", ...)
  assert.match(retrievalSrc, /\.in\("organization_id", organizationIdsForTypeFilter\)/);

  // organizationId path still uses .eq when organizationId set
  assert.match(retrievalSrc, /\.eq\("organization_id", query\.organizationId\.trim\(\)\)/);
  assert.match(retrievalSrc, /\.eq\("person_id", query\.personId\.trim\(\)\)/);

  // 9. no service_role for retrieval
  assert.doesNotMatch(retrievalSrc, /service_role|SERVICE_ROLE|createServiceRole/);
  assert.match(retrievalSrc, /import "server-only"/);
  assert.match(
    gatewaySrc,
    /fetchSupplierConversationsForUser\(input\.client/,
  );
  assert.doesNotMatch(gatewaySrc, /createServiceRoleSupabaseClient/);

  // Gateway parses + forwards organizationTypeSlugs (via authoritative scope resolve)
  assert.match(gatewaySrc, /organizationTypeSlugs/);
  assert.match(gatewaySrc, /resolveAskScopeFilters/);
  assert.match(
    gatewaySrc,
    /organizationTypeSlugs:\s*input\.request\.organizationTypeSlugs/,
  );

  // Ask schema still rejects client model/limit overrides
  const schemaMatch = gatewaySrc.match(
    /const askBodySchema = z\.object\(\{([\s\S]*?)\}\);/,
  );
  assert.ok(schemaMatch, "askBodySchema present");
  const schemaBody = schemaMatch[1];
  assert.doesNotMatch(schemaBody, /\bmodel\b/);
  assert.doesNotMatch(schemaBody, /max_tokens|temperature|maxOutputTokens|\blimit\b/);
  assert.match(schemaBody, /organizationTypeSlugs/);

  // Filter module has no server-only import / no DB client usage
  assert.doesNotMatch(filterSrc, /import\s+["']server-only["']/);
  assert.doesNotMatch(filterSrc, /from\(["'][^"']*supabase/i);
  assert.doesNotMatch(filterSrc, /\.from\(/);

  // 10. DB_ONLY / SYNTHESIS decision + provider / budget unchanged by this phase
  const decisionHeuristicsSrc = read("lib/supplier-ai/decision-heuristics.ts");
  assert.match(decisionHeuristicsSrc, /database_only/);
  assert.match(decisionHeuristicsSrc, /synthesis/);
  assert.doesNotMatch(decisionSrc, /organizationTypeSlugs/);
  assert.doesNotMatch(decisionHeuristicsSrc, /organizationTypeSlugs/);
  assert.doesNotMatch(openaiSrc, /organizationTypeSlugs/);
  assert.doesNotMatch(budgetSrc, /organizationTypeSlugs/);
  assert.match(gatewaySrc, /mode === "DB_ONLY"/);
  assert.match(gatewaySrc, /runSynthesisPath/);

  // No embeddings / vector search code paths in retrieval
  assert.doesNotMatch(retrievalSrc, /pgvector|match_documents|embedding_vector/i);
  assert.doesNotMatch(retrievalSrc, /\.rpc\(\s*["'][^"']*embed/i);

  console.log("phase1a-org-type-retrieval: PASS");
}

main();
