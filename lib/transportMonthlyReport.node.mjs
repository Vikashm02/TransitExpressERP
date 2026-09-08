/**
 * Transport monthly report pure helpers.
 * Run: node --experimental-strip-types lib/transportMonthlyReport.node.mjs
 */

import assert from "node:assert/strict";
import {
  buildTransportMonthlyEmailText,
  previousCalendarMonth,
  transportMonthBounds,
} from "./transportMonthlyReport.ts";

function main() {
  const aug = transportMonthBounds(2026, 8);
  assert.equal(aug.from, "2026-08-01");
  assert.equal(aug.toExclusive, "2026-09-01");
  assert.equal(aug.periodKey, "2026-08");
  assert.match(aug.periodLabel, /August/);
  assert.match(aug.periodLabel, /2026/);

  const prev = previousCalendarMonth("2026-09-01");
  assert.deepEqual(prev, { year: 2026, month: 8 });

  const janPrev = previousCalendarMonth("2026-01-15");
  assert.deepEqual(janPrev, { year: 2025, month: 12 });

  const text = buildTransportMonthlyEmailText({
    periodFrom: aug.from,
    periodToExclusive: aug.toExclusive,
    periodLabel: aug.periodLabel,
    totalLrs: 10,
    totalLoadingWeight: 123.5,
    uniqueVehicles: 4,
    topConsignees: [
      { consignee: "A Co", loadingWeight: 80, lrCount: 3 },
      { consignee: "B Co", loadingWeight: 43.5, lrCount: 7 },
    ],
  });

  assert.match(text, /TRANSPORT MONTHLY SUMMARY/);
  assert.match(text, /Total LRs: 10/);
  assert.match(text, /Unique Vehicles: 4/);
  assert.match(text, /A Co/);
  assert.match(text, /3 LRs/);

  console.log("transportMonthlyReport.node.mjs: all assertions passed");
}

main();
