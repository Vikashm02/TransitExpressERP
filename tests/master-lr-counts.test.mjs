import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { countBillingPartyLrs, countCustomerLrs, countMaterialLrs, countVehicleLrs, vehicleKey } from "../lib/masterLrCounts.ts";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const lr = (over) => ({ consignorId: null, consignorName: "", consigneeId: null, consigneeName: "", billingPartyId: null, billingPartyName: "", materialId: null, materialName: "", vehicleNumber: "", ...over });

test("customers: linked LRs by id, older LRs by exact name, consignor and consignee separately", () => {
  const customers = [{ id: 1, name: "ACC LTD" }, { id: 2, name: "Cube Bio" }];
  const { asConsignor, asConsignee } = countCustomerLrs([
    lr({ consignorId: 1, consigneeId: 2 }),
    lr({ consignorName: " acc ltd ", consigneeName: "CUBE BIO" }),
    lr({ consignorId: 2, consignorName: "ACC LTD" }),
    lr({ consignorName: "Unknown party" }),
  ], customers);
  assert.equal(asConsignor.get(1), 2);
  assert.equal(asConsignor.get(2), 1);
  assert.equal(asConsignee.get(2), 2);
  assert.equal(asConsignee.get(1), undefined);
});

test("a name shared by two final masters is not guessed; drafts never take name matches", () => {
  const customers = [{ id: 1, name: "ZIGMA" }, { id: 2, name: "zigma" }, { id: 3, name: "DRAFT CO", entryStatus: "draft" }];
  const { asConsignor } = countCustomerLrs([lr({ consignorName: "ZIGMA" }), lr({ consignorName: "DRAFT CO" }), lr({ consignorId: 3 })], customers);
  assert.equal(asConsignor.get(1), undefined);
  assert.equal(asConsignor.get(2), undefined);
  assert.equal(asConsignor.get(3), 1);
});

test("billing party, material and vehicle counts", () => {
  assert.equal(countBillingPartyLrs([lr({ billingPartyId: 5 }), lr({ billingPartyName: "M/S ACC" })], [{ id: 5, name: "M/S ACC" }]).get(5), 2);
  assert.equal(countMaterialLrs([lr({ materialId: 7 }), lr({ materialName: "Fly Ash" })], [{ id: 7, name: "FLY ASH" }]).get(7), 2);
  const v = countVehicleLrs([lr({ vehicleNumber: "MH-40BG-0137" }), lr({ vehicleNumber: "mh40 bg 0137" }), lr({ vehicleNumber: "" })]);
  assert.equal(v.get(vehicleKey("MH40BG0137")), 2);
  assert.equal(v.size, 1);
});

test("counts are read-only, final LRs only, and hidden without LR view permission", () => {
  const svc = read("components/services/masterLrUsage.service.ts");
  assert.match(svc, /\.eq\("entry_status", "final"\)/);
  assert.doesNotMatch(svc, /\.(insert|update|upsert|delete)\(/);
  assert.match(svc, /hasPermission\("lr", "view"\)/);
  for (const p of ["components/customer/CustomerListPage.tsx", "components/billingParty/BillingPartyListPage.tsx", "components/vehicle/VehicleListPage.tsx", "components/material/MaterialListPage.tsx"]) {
    assert.match(read(p), /lrCounts=\{lrCounts\}/, p);
  }
  assert.match(read("components/customer/CustomerTable.tsx"), /LRs as Consignor[\s\S]*LRs as Consignee/);
});
