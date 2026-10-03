import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const m106 = read('database/migrations/106_lr_dc_snapshot_sync.sql');
const lrService = read('components/services/lr.service.ts');
const dcService = read('components/services/deliveryChallan.service.ts');
const dcDialog = read('components/deliveryChallan/DeliveryChallanDialog.tsx');
const dcSchema = read('components/deliveryChallan/deliveryChallan.schema.ts');
const lrListPage = read('components/lr/LRListPage.tsx');
const lrDialog = read('components/lr/LRDialog.tsx');
const m090 = read('database/migrations/090_staff_48h_edit_window.sql');
const m023 = read('database/migrations/023_create_delivery_challans.sql');
const m105 = read('database/migrations/105_fix_legacy_draft_finalization.sql');
const m095 = read('database/migrations/095_create_replacement_po_from_lr.sql');

// 1. Migration exists, idempotent structure, behavioral-only
test('migration 106 exists and documents scope', () => {
  assert.match(m106, /behavioral DB migration/i);
  assert.match(m106, /no table columns added\/dropped/i);
  assert.match(m106, /no rows deleted/i);
  assert.match(m106, /no automatic backfill/i);
  assert.match(m106, /no LR renumbering/i);
  assert.match(m106, /no PO identity/i);
  assert.match(m106, /no RLS policy weakening/i);
  assert.match(m106, /NOT EXECUTED AUTOMATICALLY/);
});

test('migration has no DDL/backfill/delete/RLS changes', () => {
  assert.doesNotMatch(m106, /alter table/i);
  assert.doesNotMatch(m106, /create table/i);
  assert.doesNotMatch(m106, /drop table/i);
  assert.doesNotMatch(m106, /delete from/i);
  assert.doesNotMatch(m106, /insert into public\.delivery_challans/i);
  assert.doesNotMatch(m106, /create policy/i);
  assert.doesNotMatch(m106, /drop policy/i);
  assert.doesNotMatch(m106, /update public\.purchase_orders/i);
  assert.doesNotMatch(m106, /alter\s+table\s+public\.lrs/i);
});

// 2. Trigger architecture
test('trigger is AFTER UPDATE on lrs, row-level, with change guard', () => {
  assert.match(m106, /after update on public\.lrs/i);
  assert.match(m106, /for each row/i);
  assert.match(m106, /when\s*\(/i);
  assert.match(m106, /new\.entry_status = 'final'/);
});

test('change guard covers all synchronized source columns', () => {
  for (const col of ['lr_date','consignor','consignor_address','consignor_gst','consignee','consignee_address','consignee_gst','material','loading_weight','vehicle_number','po_number','po_date']) {
    assert.ok(m106.includes(`old.${col}`) && m106.includes(`new.${col}`), `guard missing ${col}`);
    assert.ok(m106.includes(`old.${col}`) && m106.includes('is distinct from'), `guard uses IS DISTINCT FROM for ${col}`);
  }
});

test('draft -> final allowed even when values unchanged', () => {
  assert.match(m106, /old\.entry_status is distinct from[\s\S]*?new\.entry_status/i);
  assert.match(m106, /draft\/non-final -> final|draft -> final/i);
});

test('ordinary draft edits do not sync (NEW must be final)', () => {
  assert.match(m106, /if new\.entry_status is distinct from 'final' then[\s\S]*?return new;/);
});

// 3. Field mapping
test('synchronized field mapping matches the approved contract', () => {
  assert.match(m106, /lr_date\s*=\s*new\.lr_date/);
  assert.match(m106, /consignor\s*=\s*new\.consignor/);
  assert.match(m106, /consignor_address\s*=\s*new\.consignor_address/);
  assert.match(m106, /consignor_gst\s*=\s*new\.consignor_gst/);
  assert.match(m106, /consignee\s*=\s*new\.consignee/);
  assert.match(m106, /consignee_address\s*=\s*new\.consignee_address/);
  assert.match(m106, /consignee_gst\s*=\s*new\.consignee_gst/);
  assert.match(m106, /description\s*=\s*new\.material/);
  assert.match(m106, /qty\s*=\s*new\.loading_weight/);
  assert.match(m106, /vehicle_number\s*=\s*new\.vehicle_number/);
  assert.match(m106, /po_number\s*=\s*new\.po_number/);
});

test('po_date NULL-preserving rule (no NULL writes, no not-null loosening)', () => {
  assert.match(m106, /po_date\s*=\s*coalesce\(new\.po_date,\s*dc\.po_date\)/);
  assert.doesNotMatch(m106, /po_date\s*=\s*new\.po_date,/);
  assert.doesNotMatch(m106, /alter table.*po_date.*drop not null/i);
});

test('by_name and hsn never overwritten; identity fields preserved', () => {
  const setBlock = m106.slice(m106.indexOf('set\n'), m106.indexOf('where dc.lr_number'));
  assert.doesNotMatch(setBlock, /by_name/);
  assert.doesNotMatch(setBlock, /hsn/);
  assert.doesNotMatch(setBlock, /\bid\s*=/);
  assert.doesNotMatch(setBlock, /created_at/);
  assert.doesNotMatch(setBlock, /created_by/);
  assert.doesNotMatch(setBlock, /updated_by/);
});

test('links by lr_number only; no new columns/FK; no create/delete of DCs', () => {
  assert.match(m106, /where dc\.lr_number = new\.lr_number/);
  assert.doesNotMatch(m106, /lr_id/i);
  assert.doesNotMatch(m106, /insert into public\.delivery_challans/i);
  assert.doesNotMatch(m106, /delete from public\.delivery_challans/i);
});

// 4. Security hardening
test('SECURITY DEFINER with fixed search_path, no dynamic SQL', () => {
  assert.match(m106, /security definer/i);
  assert.match(m106, /set search_path = public/i);
  assert.doesNotMatch(m106, /execute\s+format\s*\(/i);
  assert.doesNotMatch(m106, /\bEXECUTE\b[^;]*\|\|/i);
});

test('EXECUTE revoked from public/anon/authenticated (no direct-call capability)', () => {
  assert.match(m106, /revoke all on function public\.sync_delivery_challans_from_lr\(\) from public/i);
  assert.match(m106, /revoke all on function public\.sync_delivery_challans_from_lr\(\) from anon/i);
  assert.match(m106, /revoke all on function public\.sync_delivery_challans_from_lr\(\) from authenticated/i);
  assert.doesNotMatch(m106, /grant execute/i);
});

// 5. Atomicity by trigger semantics (same transaction)
test('trigger function does not contain transaction control', () => {
  assert.doesNotMatch(m106, /\bbegin;/i);
  assert.doesNotMatch(m106, /\bcommit;/i);
  assert.doesNotMatch(m106, /\brollback;/i);
});

// 6. Client-side post-commit sync removed
test('updateLR no longer calls client-side DC sync', () => {
  assert.doesNotMatch(lrService, /syncDeliveryChallanFromLr/);
  assert.equal(lrService.includes('syncDeliveryChallanFromLr'), false);
});

test('replacement PO path no longer calls client-side DC sync', () => {
  const repl = lrService.slice(lrService.indexOf('createReplacementPurchaseOrderFromLr'), lrService.indexOf('return record;', lrService.indexOf('createReplacementPurchaseOrderFromLr')));
  assert.doesNotMatch(repl, /syncDeliveryChallanFromLr/);
});

test('syncDeliveryChallanFromLr helper removed from DC service', () => {
  assert.doesNotMatch(dcService, /export async function syncDeliveryChallanFromLr/);
});

test('no frontend runtime caller of the removed helper remains', () => {
  for (const src of [lrService, dcService, lrListPage, lrDialog]) {
    assert.doesNotMatch(src, /await\s+syncDeliveryChallanFromLr|import\s+\{[^}]*syncDeliveryChallanFromLr|supabase\s*\n?\s*\.from\(TABLE\)\s*\n?\s*\.update\(\{\s*\n?\s*qty: loadingWeight/);
  }
});

// 7. Dialog poDate snapshot consistency
test('applyLrSnapshot snapshots poDate only when LR has one', () => {
  assert.match(dcDialog, /poDate:\s*lr\.poDate && lr\.poDate\.trim\(\) !== "" \? lr\.poDate : current\.poDate/);
});

test('schema comment documents poDate as LR-derived', () => {
  assert.match(dcSchema, /poDate fields are snapshotted from the LR|poDate.*LR/);
  assert.doesNotMatch(dcSchema, /Manual entry fields are\s*\n?\s*`byName`, `poDate`, and `hsn`/);
});

// 8. Regression: c139188 / replacement PO / legacy paths intact
test('c139188 legacy Change PO enrichment behavior intact', () => {
  assert.match(lrListPage, /Legacy enrichment|getLrBillingPartyLookup/);
  assert.match(lrListPage, /await updateLR\(editingLR\.id/);
  assert.doesNotMatch(lrListPage, /consignorId[\s\S]*?getLrCustomerLookup/);
});

test('replacement PO RPC untouched by this change', () => {
  assert.match(m095, /create_replacement_purchase_order_from_lr/);
  assert.match(lrService, /create_replacement_purchase_order_from_lr/);
});

test('legacy finalize RPC untouched by this change', () => {
  assert.match(m105, /finalize_legacy_lr_draft/);
  assert.match(lrService, /finalize_legacy_lr_draft/);
});

test('change PO SQL tests still present in migrations 102/103', () => {
  const m102 = read('database/migrations/102_po_material_identity.sql');
  assert.match(m102, /new\.po_number := v_po\.po_number/);
  assert.match(m102, /new\.po_date := v_po\.issue_date/);
});

// 9. RLS / numbering / PO identity untouched
test('delivery_challans RLS policies unchanged in 023/090 and untouched by 106', () => {
  assert.match(m023, /has_permission\('delivery_challans', 'edit'\)/);
  assert.match(m090, /staff_within_48h_edit_window/);
  assert.doesNotMatch(m106, /delivery_challans_update|has_permission\('delivery_challans'/);
});

test('LR numbering functions not referenced or altered', () => {
  assert.doesNotMatch(m106, /allocate_next_lr_number|create_numbered_lr_draft|lr_running_number/);
});

test('PO identity trigger untouched', () => {
  const m102 = read('database/migrations/102_po_material_identity.sql');
  assert.match(m102, /PO does not belong to the selected Billing Party identity/);
});

// 10. No frontend notification emitted by the DB trigger (DB never had dc events)
test('trigger emits no notification events', () => {
  assert.doesNotMatch(m106, /notification_event|emitNotificationEvent|pg_notify/i);
});
