import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lrPoPartyChanged } from '../components/lr/partyIdentity.ts';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migration = read('database/migrations/108_po_consignee_identity.sql');
const service = read('components/services/purchaseOrder.service.ts');
const form = read('components/lr/LRForm.tsx');
const fields = read('components/lr/PurchaseOrderFields.tsx');
const poMaster = read('components/purchaseOrder/PurchaseOrderListPage.tsx');
const lrDialog = read('components/lr/LRDialog.tsx');

test('M108 adds nullable restrictive Consignee identity and snapshot without historical DML', () => {
  assert.match(migration, /add column consignee_id bigint references public\.customers\(id\) on delete restrict/);
  assert.match(migration, /add column consignee text/);
  const outsideBodies = migration.replace(/\$\$[\s\S]*?\$\$/g, '');
  assert.doesNotMatch(outsideBodies, /\b(update|delete from|truncate)\s+public\.(purchase_orders|lrs)\b/i);
  assert.doesNotMatch(migration, /create\s+unique\s+index[\s\S]*consignee_id/i);
  assert.doesNotMatch(migration, /drop\s+index\s+.*purchase_orders_party_consignor_number/i);
});

test('new lookup is four-dimensional and legacy three-dimensional lookup is removed', () => {
  assert.match(migration, /drop function public\.get_lr_purchase_orders_by_party_material_id\(bigint, text, bigint\)/);
  assert.match(migration, /p\.billing_party_id = p_billing_party_id/);
  assert.match(migration, /upper\(trim\(coalesce\(p\.consignor,''\)\)\) = upper\(trim\(p_consignor\)\)/);
  assert.match(migration, /p\.consignee_id = p_consignee_id/);
  assert.match(migration, /p\.material_id = p_material_id/);
  assert.match(migration, /p\.status = 'Active'/);
  assert.match(service, /p_consignee_id: consigneeId/);
  assert.match(service, /row\.consigneeId === consigneeId/);
});

test('PO snapshots are server-derived and survive unrelated edits or customer renames', () => {
  assert.match(migration, /select name into v_consignee from public\.customers/);
  assert.match(migration, /if new\.consignee_id is distinct from old\.consignee_id then[\s\S]*new\.consignee := v_consignee[\s\S]*else[\s\S]*new\.consignee := old\.consignee/);
  assert.match(migration, /tg_op = 'INSERT' and new\.consignee_id is null/);
  assert.match(migration, /old\.consignee_id is not null and new\.consignee_id is null/);
});

test('different Consignee IDs are PO-context changes even with identical display names', () => {
  const prior = { purchaseOrderId: 11, poNumber: 'PO', poDate: '2026-01-01', customer: 'BP', billingPartyId: 1, consignor: 'Sender', consignorId: 2, consignee: 'Same Name', consigneeId: 3, materialId: 4 };
  assert.equal(lrPoPartyChanged(prior, { ...prior, consigneeId: 5 }), true);
  assert.equal(lrPoPartyChanged(prior, { ...prior, consignee: 'Renamed Snapshot' }), true);
  assert.match(form, /role="consignee"[\s\S]*?onChange=\{changeParty\}/);
  assert.match(fields, /lr\.consigneeId/);
  assert.match(lrDialog, /values\.consigneeId/);
});

test('server validation, LR-originated PO, and replacement PO require Consignee IDs', () => {
  assert.match(migration, /PO does not belong to the selected Consignee identity/);
  assert.match(migration, /new\.consignee_id is null or new\.consignee_id is distinct from v_po\.consignee_id/);
  assert.match(migration, /new\.material_id is null or new\.consignee_id is null/);
  assert.match(migration, /consignee_id = new\.consignee_id/);
  assert.match(migration, /v_lr\.consignee_id is null then raise exception 'Select and save a Consignee/);
  assert.match(migration, /v_lr\.consignee_id, v_normalized_po_number/);
});

test('unlinked legacy LRs cannot discover or attach a NULL-Consignee PO', () => {
  const start = migration.indexOf('create or replace function public.lr_create_purchase_order_from_snapshot');
  const end = migration.indexOf('revoke all on function public.lr_create_purchase_order_from_snapshot', start);
  const snapshot = migration.slice(start, end);
  assert.match(snapshot, /if new\.purchase_order_id is not null then return new/);
  assert.match(snapshot, /if new\.material_id is null or new\.consignee_id is null then/);
  assert.doesNotMatch(snapshot, /and\s+consignee_id\s+is\s+null/i);
  assert.doesNotMatch(snapshot, /v_legacy/);
  assert.match(snapshot, /consignee_id = new\.consignee_id/);
});

test('existing linked legacy POs are preserved only without a changed identity context', () => {
  const validation = migration.slice(
    migration.indexOf('create or replace function public.lr_validate_purchase_order'),
    migration.indexOf('create or replace function public.lr_create_purchase_order_from_snapshot'),
  );
  assert.match(validation, /if new\.purchase_order_id is null then return new/);
  for (const identity of ['new.billing_party_id', 'new.consignor', 'new.consignee_id', 'new.material_id', 'new.purchase_order_id']) {
    assert.ok(validation.includes(identity), `${identity} must trigger normal selection validation`);
  }
  assert.match(validation, /new\.consignee_id is null or new\.consignee_id is distinct from v_po\.consignee_id/);
  assert.match(validation, /elsif v_legacy_material_enrichment/);
});

test('PO Master uses PO-authorized Customer lookup and visibly supports legacy rows', () => {
  assert.match(migration, /create function public\.get_purchase_order_customers\(\)/);
  assert.match(migration, /has_module_action\('purchase_orders','create'\)/);
  assert.match(poMaster, /getPurchaseOrderCustomers/);
  assert.match(poMaster, /Not assigned \(legacy\)/);
  assert.match(poMaster, /label="Consignee"/);
});

test('M108 does not touch LR numbering functions or WhatsApp migrations', () => {
  assert.doesNotMatch(migration, /allocate_next_lr_number|lr_running_number|create_numbered_lr_draft|finalize_legacy_lr_draft/i);
  assert.doesNotMatch(migration, /whatsapp/i);
});
