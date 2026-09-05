/**
 * Deterministic master-name resolve tests for Transport bulk upload.
 * Run: node --experimental-strip-types lib/bulkMasterResolve.node.mjs
 */

import assert from "node:assert/strict";
import {
  masterAmbiguousMessage,
  masterNotFoundMessage,
  resolveUniqueMasterByName,
} from "./bulkMasterResolve.ts";

function main() {
  const customers = [
    { id: 1, name: "ACC Limited - Wadi" },
    { id: 2, name: "Sample Buyer Pvt Ltd" },
    { id: 3, name: "Dup Name" },
    { id: 4, name: "dup name" },
  ];

  // TEST 1 — unique match (case/whitespace)
  {
    const r = resolveUniqueMasterByName("  acc limited - wadi ", customers, (c) => c.name);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.match.id, 1);
  }

  // TEST 2 — missing
  {
    const r = resolveUniqueMasterByName("ACC LTD", customers, (c) => c.name);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "missing");
  }

  // TEST 6 — ambiguous (case-insensitive duplicate names)
  {
    const r = resolveUniqueMasterByName("Dup Name", customers, (c) => c.name);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "ambiguous");
      assert.equal(r.matchCount, 2);
    }
  }

  // Do not strip LTD / fuzzy
  {
    const r = resolveUniqueMasterByName("Sample Buyer", customers, (c) => c.name);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "missing");
  }

  assert.match(
    masterNotFoundMessage("Consignee", "ACC LTD", "Customer Master"),
    /Customer Master/,
  );
  assert.match(
    masterAmbiguousMessage("Consignee", "XYZ", "Customer Master"),
    /multiple records/,
  );

  console.log("bulkMasterResolve.node.mjs: all assertions passed");
}

main();
