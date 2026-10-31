import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { groupBillLines, printedBillNumber, rupees, plainNumber } from "../components/billing/billPrintLayout.ts";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("page 1 groups same From + Destination + Consignor + Rate and adds weight and freight", () => {
  const line = (over) => ({ from: "NIZAMABAD", to: "CHANDA", consignor: "CUBE BIO ENERGY PVT LTD", weight: 0, rate: 1000, freight: 0, ...over });
  const rows = groupBillLines([
    line({ weight: 32.75, freight: 32750 }),
    line({ weight: 33.02, freight: 33020, consignor: "cube bio energy pvt ltd " }),
    line({ weight: 10, rate: 1200, freight: 12000 }),
    line({ weight: 5, to: "WADI", freight: 5000 }),
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { from: "NIZAMABAD", to: "CHANDA", consignor: "CUBE BIO ENERGY PVT LTD", rate: 1000, weight: 65.77, freight: 65770, lrCount: 2 });
  assert.equal(rows[1].rate, 1200);
  assert.equal(rows[2].to, "WADI");
});

test("grouped totals equal the bill lines (nothing recalculated)", () => {
  const lines = [0.1, 0.2, 0.3].map((w, i) => ({ from: "A", to: "B", consignor: "C", weight: w, rate: 100, freight: 10.1 * (i + 1) }));
  const [row] = groupBillLines(lines);
  assert.equal(row.weight, 0.6);
  assert.equal(row.freight, 60.6);
});

test("printed bill number gets TEL/ once; amounts print like the approved bill", () => {
  assert.equal(printedBillNumber("2475"), "TEL/2475");
  assert.equal(printedBillNumber("TEL/2475"), "TEL/2475");
  assert.equal(printedBillNumber(""), "");
  assert.equal(rupees(65770), "65770/-");
  assert.equal(rupees(65770.5), "65770.50/-");
  assert.equal(plainNumber(1000), "1000");
});

test("bill print is landscape with an invoice page and an LR details page", () => {
  const css = read("components/billing/BillPrint.module.css");
  const tsx = read("components/billing/BillPrint.tsx");
  const share = read("components/billing/ShareBillDialog.tsx");
  assert.match(css, /size: A4 landscape;/);
  assert.match(tsx, /RATE PER MT/);
  assert.match(tsx, /Details of Bill no/);
  assert.equal((tsx.match(/data-bill-sheet=""/g) ?? []).length, 2);
  assert.match(tsx, /billingParty\?\.vendorCode \?/);
  assert.match(share, /orientation: "landscape"/);
  assert.match(share, /useCORS: true/);
});
