import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("DC Description comes from the LR Material Description (Material name when blank)", () => {
  assert.match(read("components/deliveryChallan/DeliveryChallanDialog.tsx"),
    /description: lr\.materialDescription\?\.trim\(\) \? lr\.materialDescription : lr\.material,/);
  const mig = read("database/migrations/127_dc_description_from_lr_material_description.sql");
  assert.match(mig, /description\s+= coalesce\(nullif\(btrim\(new\.material_description\), ''\), new\.material\)/);
  assert.match(mig, /or old\.material_description is distinct from new\.material_description/);
  assert.match(mig, /CREATE TRIGGER trg_lrs_sync_delivery_challans [\s\S]*\(old\.material_description IS DISTINCT FROM new\.material_description\)/);
  const rb = read("database/migrations/127_dc_description_from_lr_material_description.rollback.sql");
  assert.match(rb, /description\s+= new\.material,/);
  assert.doesNotMatch(rb, /material_description/);
});
