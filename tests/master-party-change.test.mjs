import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const mig = read("database/migrations/119_master_party_change_cascade.sql");
const rollback = read("database/migrations/119_master_party_change_cascade.rollback.sql");
const sql = mig.replace(/^\s*--.*$/gm, "");
const dialog = read("components/common/MasterPartyChangeDialog.tsx");
const billing = read("components/services/billing.service.ts");
const FLAG = "coalesce(current_setting('app.system_snapshot_refresh', true), 'off') = 'on'";

function fn(src, name) {
  const start = src.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start > 0, name);
  const end = src.indexOf("$function$;", start);
  return src.slice(start, end);
}

test("simple guarded rules are the exact live definition plus one switch line", () => {
  for (const name of ["record_lr_edit_event", "lr_create_purchase_order_from_snapshot", "lr_derive_route_from_master", "lr_validate_purchase_order"]) {
    const guarded = fn(mig, name).split("\n").filter((l) => !l.includes("app.system_snapshot_refresh") && !/^\s*-- System snapshot refresh/.test(l)).join("\n");
    assert.equal(guarded, fn(rollback, name), name);
  }
});

test("frozen-name rules keep the name a system update sets (so Undo can restore it)", () => {
  const keep = (col) => new RegExp(`if not \\(coalesce\\(current_setting\\('app\\.system_snapshot_refresh', true\\), 'off'\\) = 'on'\\) then\\s+new\\.${col} := old\\.${col};`);
  const bid = fn(mig, "transport_bid_before_write");
  for (const col of ["billing_party_name", "consignor_name", "consignee_name"]) assert.match(bid, keep(col), col);
  assert.match(fn(mig, "set_consignee_conversations_audit"), keep("customer_name"));
  assert.match(fn(mig, "purchase_order_before_write"), /elsif not \(coalesce\(current_setting\('app\.system_snapshot_refresh', true\), 'off'\) = 'on'\) then\s+new\.consignee := old\.consignee;/);
});

test("every approved update keeps each old value, and Undo restores the master first", () => {
  const body = sql.slice(sql.indexOf("function public.master_party_change("));
  const capture = body.indexOf("insert into public.master_party_update_items");
  assert.ok(capture > 0 && capture < body.indexOf("update public.lrs set"));
  const undo = sql.slice(sql.indexOf("function public.master_party_undo("));
  assert.ok(undo.indexOf("update public.customers set") < undo.indexOf("for v_item in"));
  assert.match(undo, /changed again after this update/);
  assert.match(undo, /%I is not distinct from \$3/);
  assert.match(undo, /raise exception 'Unexpected undo item\.'/);
  assert.match(undo, /if auth\.uid\(\) is null or not public\.is_creator\(\) then\s+raise exception 'Only the Creator can undo/);
  assert.match(undo, /where update_id = p_update_id and \(p_scope = 'all' or table_name = 'bills'\)/);
  assert.match(undo, /if p_scope = 'all' then\s+if v_update\.party_type = 'customer' then\s+update public\.customers set/);
  assert.match(sql, /if coalesce\(current_setting\('app\.system_snapshot_refresh', true\), 'off'\) = 'on' then\s+return null;/);
});

test("history with Undo is offered in both masters to editors", () => {
  for (const p of ["components/customer/CustomerListPage.tsx", "components/billingParty/BillingPartyListPage.tsx"]) {
    const src = read(p);
    assert.match(src, /\.\.\.\(canEdit\s+\? \[\{ key: "change-history", label: "Change history"/, p);
    assert.match(src, /<MasterPartyHistoryDialog/, p);
  }
});

test("Make Permanent no longer counts as staff edits", () => {
  const mp = fn(mig, "make_purchase_order_permanent");
  assert.match(mp, /set_config\('app\.system_snapshot_refresh', 'on', true\)/);
  assert.match(mp, /set_config\('app\.system_snapshot_refresh', 'off', true\)/);
});

test("no deletes; bills change only with the separate approval", () => {
  assert.doesNotMatch(sql, /\bdelete\s+from\b|\btruncate\b|drop\s+table|drop\s+column/i);
  const body = sql.slice(sql.indexOf("function public.master_party_change("));
  const billUpdate = body.indexOf("update public.bills set party_name = v_name");
  assert.ok(billUpdate > 0);
  assert.ok(body.lastIndexOf("if p_action = 'apply_with_bills' then", billUpdate) > body.lastIndexOf("end if;", billUpdate));
});

test("apply is permission-checked, preview changes nothing, older name matches are safe", () => {
  const body = sql.slice(sql.indexOf("function public.master_party_change("));
  assert.match(body, /has_module_action\(v_perm, 'edit'\)/);
  const previewReturn = body.indexOf("if p_action = 'preview' then\n    return v_result;");
  assert.ok(previewReturn > 0 && previewReturn < body.indexOf("update public.lrs"));
  assert.match(body, /where not exists \(select 1 from public\.customers x where x\.id <> p_party_id and upper\(trim\(x\.name\)\) = n\)/);
  assert.match(body, /set_config\('app\.suppress_lr_updated_notifications', 'on', true\);\s+perform set_config\('app\.system_snapshot_refresh', 'on', true\);/);
});

test("existing bills are filled from today's master without touching last-updated", () => {
  assert.match(sql, /alter table public\.bills disable trigger trg_bills_updated_at;\s+update public\.bills b\s+set party_name = bp\.name/);
  assert.match(sql, /alter table public\.bills enable trigger trg_bills_updated_at;/);
});

test("window: bills unticked with a GST warning; closing does not decide", () => {
  assert.match(dialog, /const \[updateBills, setUpdateBills\] = useState\(false\)/);
  assert.match(dialog, /GST documents/);
  assert.match(dialog, /GSTR-1/);
  assert.match(dialog, /No decision taken\. Older records are unchanged for now\./);
});

test("bill print uses the bill's stored party details", () => {
  assert.match(billing, /snapshot\.party_name != null/);
  assert.match(billing, /gst: snapshot\.party_gst \?\? masterParty\.gst/);
});

test("both masters ask after saving a final record", () => {
  for (const p of ["components/customer/CustomerListPage.tsx", "components/billingParty/BillingPartyListPage.tsx"]) {
    const src = read(p);
    assert.match(src, /previewMasterPartyChange\("(customer|billing_party)", partyId\)/, p);
    assert.match(src, /<MasterPartyChangeDialog/, p);
  }
});

test("Undo buttons are shown to the Creator only, with an Undo bills only choice", () => {
  const hist = read("components/common/MasterPartyHistoryDialog.tsx");
  assert.match(hist, /\{isCreator && !entry\.undoneAt \? \(/);
  assert.match(hist, /Undo bills only/);
  assert.match(hist, /Only the owner \(Creator\) can undo/);
});
