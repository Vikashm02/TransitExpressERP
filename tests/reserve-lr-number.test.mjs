import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isWithinEditWindow } from "../lib/editWindow.ts";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const mig = read("database/migrations/128_reserve_future_lr_number.sql");
const HOUR = 3600 * 1000;
const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();

test("allocation skips numbers already used (reserved LR) and never moves for a reservation", () => {
  assert.match(mig, /loop\s+v_next := v_next \+ 1;[\s\S]*exit when not exists \(select 1 from public\.lrs where lr_number = v_number\);\s+end loop;/);
  const reserve = mig.slice(mig.indexOf("function public.reserve_lr_number"));
  assert.doesNotMatch(reserve.slice(0, reserve.indexOf("$$;")), /lr_running_number\s*=/, "reserving must not change the running number");
  assert.match(reserve, /if p_number <= v_running then/);
  assert.match(reserve, /for update;/);
});

test("reserved mark can only be set by reserve_lr_number and never changed", () => {
  assert.match(mig, /if tg_op = 'UPDATE' then\s+new\.reserved_at := old\.reserved_at;\s+new\.reserved_by := old\.reserved_by;/);
  assert.match(mig, /elsif coalesce\(current_setting\('app\.reserving_lr', true\), 'off'\) <> 'on' then\s+new\.reserved_at := null;/);
  assert.match(read("components/services/lr.service.ts"), /delete row\.reserved_at;\s+delete row\.reserved_by;/);
});

test("cancel never deletes", () => {
  const cancel = mig.slice(mig.indexOf("function public.cancel_reserved_lr"));
  assert.match(cancel, /update public\.lrs set status = 'Cancelled'/);
  assert.doesNotMatch(mig, /\bdelete\s+from\b/i);
});

test("48-hour rule: reserved draft open, then 48h from finalization; normal LRs unchanged", () => {
  assert.equal(isWithinEditWindow({ created_at: at(120 * HOUR), reservedAt: at(120 * HOUR), entryStatus: "draft" }), true);
  assert.equal(isWithinEditWindow({ created_at: at(120 * HOUR), reservedAt: at(120 * HOUR), entryStatus: "final", finalizedAt: at(1 * HOUR) }), true);
  assert.equal(isWithinEditWindow({ created_at: at(120 * HOUR), reservedAt: at(120 * HOUR), entryStatus: "final", finalizedAt: at(72 * HOUR) }), false);
  assert.equal(isWithinEditWindow({ created_at: at(120 * HOUR), entryStatus: "final" }), false);
  assert.equal(isWithinEditWindow({ created_at: at(1 * HOUR), entryStatus: "final" }), true);
  assert.match(mig, /staff_within_lr_edit_window\(created_at, reserved_at, entry_status, finalized_at\)/);
});

test("screen: Reserve button for LR creators, Reserved label, cancel action, series ignores numbers ahead", () => {
  const page = read("components/lr/LRListPage.tsx");
  // Next to "Create LR" in the page header (not hidden in the toolbar menu).
  assert.match(page, /extraActions=\{\s+canCreate \? \(\s+<Button[\s\S]*?Reserve LR number\s+<\/Button>/);
  assert.doesNotMatch(page, /key: "reserve-lr"/);
  assert.match(page, /<LrSeriesStatus lrNumbers=\{seriesLrNumbers\} \/>/);
  const table = read("components/lr/LRTable.tsx");
  assert.match(table, /label: "Cancel reservation"/);
  assert.match(table, /\(Boolean\(row\.reservedAt\) && row\.status === "Cancelled"\) \|\|/);
});
