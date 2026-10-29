import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const m118 = read("database/migrations/118_temporary_purchase_orders.sql");
const sql = m118.replace(/^\s*--.*$/gm, "");
const service = read("components/services/purchaseOrder.service.ts");
const page = read("components/purchaseOrder/PurchaseOrderListPage.tsx");
const lrPo = read("components/lr/PurchaseOrderFields.tsx");
const sender = read("supabase/functions/process-notifications/index.ts");

test("118 adds Temporary flag with every existing PO staying Permanent", () => {
  assert.match(sql, /add column if not exists is_temporary boolean not null default false/);
  assert.match(sql, /add column if not exists temporary_since timestamptz/);
});

test("118 never deletes data or touches bills", () => {
  assert.doesNotMatch(sql, /\bdelete\s+from\b|\btruncate\b|drop\s+table|drop\s+column/i);
  assert.doesNotMatch(sql, /update\s+public\.bills\b/i);
});

test("Make Permanent is permission-checked, all-or-nothing and duplicate-safe", () => {
  const start = sql.indexOf("function public.make_purchase_order_permanent");
  const fn = sql.slice(start, sql.indexOf("insert into public.notification_rules", start));
  assert.match(fn, /has_module_action\('purchase_orders', 'edit'\)/);
  assert.match(fn, /for update/);
  assert.match(fn, /already permanent/);
  assert.match(fn, /already exists for this billing party/);
  assert.match(fn, /update public\.purchase_orders\s+set po_number = v_new, issue_date = p_issue_date, is_temporary = false/);
  assert.match(fn, /update public\.lrs\s+set po_number = v_new, po_date = p_issue_date\s+where purchase_order_id = v_po\.id/);
});

test("LR refresh does not send one 'LR updated' alert per LR", () => {
  const on = sql.indexOf("set_config('app.suppress_lr_updated_notifications', 'on', true)");
  const upd = sql.indexOf("update public.lrs");
  const off = sql.indexOf("set_config('app.suppress_lr_updated_notifications', 'off', true)");
  assert.ok(on > 0 && on < upd && upd < off);
});

test("daily reminder after 3 days, once a day, at 10:00 IST", () => {
  assert.match(sql, /'po\.temporary_pending'/);
  assert.match(sql, /temporary_since <= now\(\) - interval '3 days'/);
  assert.match(sql, /temporary_reminded_on < v_today/);
  assert.match(sql, /cron\.schedule\(\s*'temporary-po-reminders-daily',\s*'30 4 \* \* \*'/);
  assert.match(sql, /revoke all on function public\.queue_temporary_po_reminders\(\) from public, anon, authenticated/);
});

test("ordinary PO saves never depend on the new column", () => {
  assert.match(service, /\.\.\.\(parsed\.isTemporary \? \{ is_temporary: true \} : \{\}\)/);
  assert.match(service, /isTemporary: row\.is_temporary === true/);
  assert.match(service, /if \(error \|\| !data\) return false;/);
});

test("PO Master: type filter, reminder link, Make Permanent only on temporary POs", () => {
  assert.match(page, /label: "PO Type", value: poType/);
  assert.match(page, /get\("type"\)/);
  assert.match(page, /label: "Make Permanent", icon: BadgeCheck, onClick: openMakePermanent, hidden: \(r\) => !r\.isTemporary/);
  assert.match(page, /makePurchaseOrderPermanent\(permanentTarget\.id, number, permanentDate\)/);
  assert.match(page, /Bills already made with the temporary number were not changed/);
});

test("LR form shows a Temporary PO chip without affecting the status lookup", () => {
  assert.match(lrPo, /getPurchaseOrderIsTemporary\(pid\)/);
  assert.match(lrPo, /Temporary PO · number will be updated when the permanent PO comes/);
  assert.match(lrPo, /\.select\("status"\)/);
});

test("reminders go to all staff on every channel", () => {
  assert.match(sender, /"po\.temporary_pending",\s*\]\);/);
});
