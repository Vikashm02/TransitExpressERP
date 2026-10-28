import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { matchesListSearch } from "../lib/listSearch.ts";
import { buildCsv } from "../lib/csvExport.ts";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("search matches any displayed field, case-insensitive", () => {
  const row = ["LR19370", "2026-10-27", "M/S ACC LIMITED - CHANDA", "MH 12 AB 1234", 2133.46, "Open"];
  assert.equal(matchesListSearch("lr19370", row), true);
  assert.equal(matchesListSearch("open", row), true);
  assert.equal(matchesListSearch("chanda", row), true);
  assert.equal(matchesListSearch("kolkata", row), false);
  assert.equal(matchesListSearch("   ", row), true);
});

test("every typed word must match (in any field)", () => {
  const row = ["M/S ACC LIMITED - CHANDA", "MH 12 AB 1234"];
  assert.equal(matchesListSearch("acc chanda", row), true);
  assert.equal(matchesListSearch("acc mh12", row), true);
  assert.equal(matchesListSearch("acc wadi", row), false);
});

test("dates match YYYY-MM-DD, DD-MM-YYYY and DD/MM/YYYY", () => {
  const row = ["2026-10-27"];
  for (const q of ["2026-10-27", "27-10-2026", "27/10/2026", "27/10", "10-2026"]) {
    assert.equal(matchesListSearch(q, row), true, q);
  }
  assert.equal(matchesListSearch("28/10/2026", row), false);
});

test("vehicle numbers match with or without spaces and hyphens", () => {
  const row = ["MH 12 AB-1234"];
  assert.equal(matchesListSearch("MH12AB1234", row), true);
  assert.equal(matchesListSearch("ab1234", row), true);
});

test("numbers match raw and Indian-formatted", () => {
  const row = [123456.5];
  assert.equal(matchesListSearch("123456", row), true);
  assert.equal(matchesListSearch("1,23,456", row), true);
});

test("fields never run together across columns", () => {
  assert.equal(matchesListSearch("ab", ["xa", "bx"]), false);
});

test("CSV quoting, empty values and formula protection", () => {
  const csv = buildCsv(["A", "B"], [['He said "hi"', null], ["=SUM(A1)", -12.5], ["+91 98450", "@x"]]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], '"A","B"');
  assert.equal(lines[1], '"He said ""hi""",""');
  assert.equal(lines[2], `"'=SUM(A1)","-12.5"`);
  assert.equal(lines[3], `"'+91 98450","'@x"`);
});

// Every list page's export must use the searched/filtered rows, never the full list.
function listPages() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(new URL("../" + dir, import.meta.url))) {
      const rel = `${dir}/${name}`;
      if (statSync(new URL("../" + rel, import.meta.url)).isDirectory()) walk(rel);
      else if (name.endsWith("ListPage.tsx")) out.push(rel);
    }
  };
  walk("components");
  return out;
}

test("every page with a search bar uses the shared search helper", () => {
  for (const page of listPages()) {
    const src = read(page);
    if (!src.includes("<SearchToolbar")) continue;
    if (page.endsWith("BidListPage.tsx") || page.endsWith("VehicleListPage.tsx")) {
      assert.match(src, /matchesListSearch\(/, page);
      continue;
    }
    assert.match(src, /matchesListSearch\(/, page);
    assert.doesNotMatch(src, /\.some\(\(field\) => field\.toLowerCase\(\)\.includes\(query/, page);
  }
});

test("every Export button exports the filtered rows", () => {
  const filteredNames = /(filtered[A-Za-z]*|visibleStaff)\.map\(|exportCsv\([\s\S]*?\b(filtered[A-Za-z]*)\)/;
  for (const page of listPages()) {
    const src = read(page);
    if (!src.includes("<SearchToolbar")) continue;
    assert.match(src, /onExport=/, `${page} has a working Export`);
    const exportStart = src.search(/function handleExport|onExport=\{\(\) =>/);
    // Long column lists can sit between the start and the rows argument.
    assert.ok(exportStart > -1, page);
    assert.match(src.slice(exportStart, exportStart + 6000), filteredNames, `${page} exports filtered rows`);
  }
});

test("LR list has a POD filter using the POD chip rule", () => {
  const src = read("components/lr/LRListPage.tsx");
  assert.match(src, /label: "POD Created", value: POD_CREATED_FILTER/);
  assert.match(src, /label: "POD Pending", value: POD_PENDING_FILTER/);
  assert.match(src, /const hasPod = Boolean\(lrKey && podIdByLrNumber\.has\(lrKey\)\)/);
  assert.match(src, /matchesPod =\s*!podFilter \|\| \(podFilter === POD_CREATED_FILTER \? hasPod : !hasPod\)/);
});
