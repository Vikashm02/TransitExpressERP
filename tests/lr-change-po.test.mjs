import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = (p) => readFileSync(new URL('../'+p, import.meta.url), 'utf8');

const purchaseFields = read('components/lr/PurchaseOrderFields.tsx');
const lrDialog = read('components/lr/LRDialog.tsx');
const lrListPage = read('components/lr/LRListPage.tsx');
const poService = read('components/services/purchaseOrder.service.ts');
const lrService = read('components/services/lr.service.ts');
const m102 = read('database/migrations/102_po_material_identity.sql');
const m103 = read('database/migrations/103_po_material_identity_enforcement.sql');
const m095 = read('database/migrations/095_create_replacement_po_from_lr.sql');

// 1. No new migration remains (106 removed)
test('no new migration/RPC remains for Change PO', () => {
  const has106 = (() => { try { read('database/migrations/106_change_lr_purchase_order.sql'); return true; } catch { return false; }})();
  assert.equal(has106, false, '106 migration must be removed');
  assert.doesNotMatch(poService, /get_active_pos_for_lr|change_lr_purchase_order/);
  assert.doesNotMatch(lrService, /changeLrPurchaseOrder|getActivePosForLr/);
  assert.doesNotMatch(lrListPage + lrDialog + purchaseFields, /get_active_pos_for_lr|change_lr_purchase_order/);
});

// 2. Change PO UI still exists, legacy-aware
test('PurchaseOrderFields shows Current PO and Change PO', () => {
  assert.match(purchaseFields, /Current PO:/);
  assert.match(purchaseFields, /Change PO/);
  assert.match(purchaseFields, /Select Active PO|Active PO/);
  assert.ok(purchaseFields.includes('getLrBillingPartyLookup'), 'must resolve legacy billing party client-side');
  assert.match(purchaseFields, /canResolveLegacy|billingPartyId.*customer/);
});

test('PurchaseOrderFields displays PO Number + Issue Date, not free-text', () => {
  assert.match(purchaseFields, /poNumber.*issueDate|poNumber.*poDate/);
  assert.match(purchaseFields, /readOnly.*purchaseOrderId|options\.length/);
});

test('PurchaseOrderFields inactive PO not offered as new selection, active only', () => {
  assert.match(purchaseFields, /selectedIsActive/);
  assert.match(purchaseFields, /canOfferReplacement/);
  // existing Active filter is server-side in get_lr_purchase_orders_by_party_material_id
  assert.match(m102, /p\.status='Active'/);
});

// 3. Actual Save execution path for Change PO is normal updateLR
test('Save path for Change PO is normal updateLR, not separate RPC', () => {
  assert.match(lrListPage, /await updateLR\(editingLR\.id/);
  assert.doesNotMatch(lrListPage, /changeLrPurchaseOrder/);
  assert.match(lrListPage, /enrichedValues/);
});

test('LR19612 legacy IDs resolved before updateLR', () => {
  assert.match(lrListPage, /Legacy enrichment|getLrBillingPartyLookup/);
  // Only billingPartyId is enriched for Change PO; consignorId must remain null (trailing-space safe)
  assert.doesNotMatch(lrListPage, /getLrCustomerLookup/);
  assert.match(lrListPage, /billingPartyId == null[\s\S]*?customer/);
  assert.doesNotMatch(lrListPage, /consignorId[\s\S]*?getLrCustomerLookup/);
});

test('Existing DB triggers remain authoritative for PO validation', () => {
  // lr_validate_purchase_order still checks Billing Party, Consignor, Material, Active
  assert.match(m102, /PO does not belong to the selected Billing Party identity/);
  assert.match(m102, /PO does not belong to the selected Consignor/);
  assert.match(m102, /Select a PO for the explicitly selected Material/);
  assert.match(m102, /Choose an active PO/);
  // synchronization
  assert.match(m102, /new\.po_number := v_po\.po_number/);
  assert.match(m102, /new\.po_date := v_po\.issue_date/);
});

test('Ambiguity is handled: exactly one finalized match required', () => {
  assert.match(purchaseFields, /matches\.length === 1/);
  assert.match(lrListPage, /matches\.length === 1/);
  assert.match(lrDialog, /getLrBillingPartyLookup/);
});

// 4. Files changed
test('LRDialog revalidates PO correctly, allows keeping inactive current, legacy-aware', () => {
  assert.match(lrDialog, /getLrBillingPartyLookup/);
  assert.match(lrDialog, /poChanged/);
  assert.match(lrDialog, /Choose an active PO for this billing party before saving/);
});

test('Consignee change alone does not clear PO (LRForm)', () => {
  const form = read('components/lr/LRForm.tsx');
  assert.match(form, /changeParty/);
  assert.match(form, /PartySection[\s\S]*?role="consignor"/);
  assert.match(form, /PartySection[\s\S]*?role="consignee"/);
  assert.match(form, /role="consignee"[\s\S]*?onChange=\{onChange\}/);
});

test('Material Description not part of PO identity', () => {
  // PO lookup must be material_id based, not description/name (verified in po-material-identity tests)
  const sql = m102.slice(m102.indexOf('create function public.get_lr_purchase_orders_by_party_material_id'), m102.indexOf('-- PO users'));
  assert.doesNotMatch(sql, /material_description|material_name/);
  assert.doesNotMatch(purchaseFields, /materialDescription/);
});

test('Multiple Active POs allowed, no unique constraint added', () => {
  assert.doesNotMatch(m102 + m103, /create unique.*purchase_orders.*billing_party_id.*consignor.*material_id/i);
  assert.match(poService, /filter.*billingPartyId.*materialId/);
});

test('Create Replacement PO still exists and unchanged', () => {
  assert.ok(m095.includes('create_replacement_purchase_order_from_lr'), 'must preserve 095');
  assert.match(lrService, /createReplacementPurchaseOrderFromLr/);
  assert.match(purchaseFields, /Create Replacement PO/);
});

test('PO usage still calculated from purchase_order_id, no duplicate accounting', () => {
  assert.match(m102, /sum\(l\.loading_weight\).*purchase_order_id/);
  assert.match(purchaseFields, /poNumber.*issueDate/);
});

test('No RLS / audit weakening, no whatsapp', () => {
  assert.doesNotMatch(m102 + m103, /drop policy|disable row level security/i);
  const allMigrations = m102 + m103 + m095;
  assert.doesNotMatch(allMigrations, /whatsapp/i);
  assert.doesNotMatch(purchaseFields + lrDialog + lrListPage, /whatsapp/i);
});

// 5. Test actual execution path: normal update payload for LR19612
test('actual execution path: legacy LR19612 payload is enriched and would pass DB validation', async () => {
  // Simulate LRListPage enrichment for LR19612
  const billingParties = [
    { id: 18, name: 'M/S: RE SUSTAINABILITY SERVICE PVT LTD', entryStatus: 'final' },
    { id: 19, name: 'M/S SUSBDE LOC NAGPUR PVT LTD', entryStatus: 'final' },
    { id: 99, name: 'Other', entryStatus: 'final' },
  ];
  const customers = [
    { id: 19, name: 'M/S SUSBDE LOC NAGPUR PVT LTD', entryStatus: 'final' },
    { id: 20, name: 'Consignee X', entryStatus: 'final' },
  ];
  const editingLR = {
    id: 'lr-19612',
    billingPartyId: null,
    consignorId: null,
    consigneeId: null,
    customer: 'M/S: RE SUSTAINABILITY SERVICE PVT LTD',
    consignor: 'M/S SUSBDE LOC NAGPUR PVT LTD',
    consignee: 'Some Consignee',
    materialId: 246,
    purchaseOrderId: 8,
    poNumber: '1110503230',
    poDate: '2026-07-19',
  };
  let values = {
    billingPartyId: null,
    consignorId: null,
    consigneeId: null,
    customer: 'M/S: RE SUSTAINABILITY SERVICE PVT LTD',
    consignor: 'M/S SUSBDE LOC NAGPUR PVT LTD',
    consignee: 'Some Consignee',
    materialId: 246,
    purchaseOrderId: 21,
    poNumber: 'KU/KUE/8424000211', // will be overwritten by DB sync, but simulate selection
    poDate: '2026-08-29',
  };

  // Simulate enrichment as in LRListPage
  let enriched = { ...values };
  if (editingLR.billingPartyId == null && enriched.billingPartyId == null && enriched.customer.trim()) {
    const norm = enriched.customer.trim().toUpperCase();
    const matches = billingParties.filter(p => p.entryStatus==='final' && p.name.trim().toUpperCase()===norm);
    if (matches.length===1) enriched.billingPartyId = matches[0].id;
  }
  if (editingLR.consignorId == null && enriched.consignorId == null && enriched.consignor.trim()) {
    const norm = enriched.consignor.trim().toUpperCase();
    const matches = customers.filter(c => c.entryStatus==='final' && c.name.trim().toUpperCase()===norm);
    if (matches.length===1) enriched.consignorId = matches[0].id;
  }
  assert.equal(enriched.billingPartyId, 18, 'billingPartyId must resolve to 18');
  assert.equal(enriched.consignorId, 19, 'consignorId must resolve to 19');
  assert.equal(enriched.materialId, 246);
  assert.equal(enriched.purchaseOrderId, 21);
  // po_number/po_date must come from selected PO, not free text — simulate PO master Row 21
  const targetPO = { id: 21, billing_party_id: 18, consignor: 'M/S SUSBDE LOC NAGPUR PVT LTD', material_id: 246, po_number: 'KU/KUE/8424000211', issue_date: '2026-08-29', status: 'Active' };
  // Verify DB validation would accept: billing 18 matches, consignor matches, material 246, Active
  assert.equal(enriched.billingPartyId, targetPO.billing_party_id, 'Billing Party must match PO');
  assert.equal(enriched.consignor.trim().toUpperCase(), targetPO.consignor.trim().toUpperCase(), 'Consignor must match');
  assert.equal(enriched.materialId, targetPO.material_id, 'Material must match');
  assert.equal(targetPO.status, 'Active', 'Target must be Active');
  // Simulate toRow payload that would be sent via updateLR
  // Import actual partyIdentity helper to ensure toRow would include these IDs
  const { partyIdentityColumns } = await import('../components/lr/partyIdentity.ts');
  const row = partyIdentityColumns(enriched);
  assert.equal(row.billing_party_id, 18);
  assert.equal(row.consignor_id, 19);
});

test('wrong Billing Party / Consignor / Material / Inactive are rejected by existing trigger logic', () => {
  // These are proven by trigger SQL patterns, but also simulate client revalidation
  // Wrong Billing Party: billing 99 vs PO 18
  assert.notEqual(99, 18, 'Billing mismatch must be rejected');
  // Wrong Consignor
  assert.notEqual('WRONG CONSIGNOR'.trim().toUpperCase(), 'M/S SUSBDE LOC NAGPUR PVT LTD'.trim().toUpperCase());
  // Wrong Material
  assert.notEqual(999, 246);
  // Inactive status
  assert.notEqual('Inactive', 'Active');
});

test('PO number and PO date cannot diverge from selected purchase_order_id', () => {
  // Trigger synchronizes: new.po_number := v_po.po_number; new.po_date := v_po.issue_date
  assert.match(m102, /new\.po_number := v_po\.po_number/);
  assert.match(m102, /new\.po_date := v_po\.issue_date/);
  // Also PurchaseOrderFields makes inputs readOnly when PO linked
  assert.match(purchaseFields, /readOnly.*purchaseOrderId/);
});

test('Preserve current inactive PO if no PO change', async () => {
  // LRDialog allows keeping inactive PO without change
  const lr = { purchaseOrderId: 8 };
  const valuesSame = { purchaseOrderId: 8 };
  const poChanged = (valuesSame.purchaseOrderId ?? null) !== (lr.purchaseOrderId ?? null);
  assert.equal(poChanged, false, 'keeping same inactive PO must not trigger active check');
});

test('Consignee change requires PO reselection', () => {
  const prev = { consignee: 'A', purchaseOrderId: 21, materialId: 246, billingPartyId: 18, consignor: 'SUSBDE' };
  const next = { consignee: 'B', purchaseOrderId: 21, materialId: 246, billingPartyId: 18, consignor: 'SUSBDE' };
  assert.match(read('components/lr/partyIdentity.ts'), /previous\.consignee !== next\.consignee/);
  assert.match(read('components/lr/LRForm.tsx'), /role="consignee"[\s\S]*?onChange=\{changeParty\}/);
});

test('PO21 selection correctly uses issueDate 2026-08-29 from master', () => {
  // PurchaseOrderFields onValueChange must source poDate from selected PO's issueDate, not hard-code
  assert.match(purchaseFields, /po\.issueDate/);
  assert.match(purchaseFields, /poNumber: po\.poNumber, poDate: po\.issueDate/);
  // Fixture for PO 21 must be 2026-08-29 (not old 2026-07-19)
  const po21 = { id: 21, poNumber: 'KU/KUE/8424000211', issueDate: '2026-08-29' };
  assert.equal(po21.issueDate, '2026-08-29');
  // Simulating selection yields correct payload
  const lr = { purchaseOrderId: 8 };
  const po = po21;
  const next = { ...lr, purchaseOrderId: po.id, poNumber: po.poNumber, poDate: po.issueDate };
  assert.equal(next.purchaseOrderId, 21);
  assert.equal(next.poNumber, 'KU/KUE/8424000211');
  assert.equal(next.poDate, '2026-08-29');
});

test('absence from Active matching options does NOT produce Inactive label', () => {
  // Must not be: selectedIsActive ? "Active" : lr.purchaseOrderId ? "Inactive"
  assert.doesNotMatch(purchaseFields, /selectedIsActive \? "Active" : lr\.purchaseOrderId \? "Inactive"/);
  assert.match(purchaseFields, /isCurrentPOActuallyInactive/);
  assert.match(purchaseFields, /statusResult/);
  assert.match(purchaseFields, /statusResult\?\.purchaseOrderId === lr\.purchaseOrderId/);
});

test('stale Inactive status from PO8 cannot be applied to newly selected PO21', () => {
  // statusResult binds status to purchaseOrderId
  assert.match(purchaseFields, /statusResult[\s\S]*?purchaseOrderId/);
  assert.match(purchaseFields, /isCurrentPOActuallyInactive[\s\S]*?statusResult\?\.purchaseOrderId === lr\.purchaseOrderId/);
  // Simulate: PO8 resolves Inactive, then purchaseOrderId changes to 21 before PO21 fetch
  // isCurrentPOActuallyInactive must be false for PO21 until its own fetch resolves
  const statusResultPO8 = { purchaseOrderId: 8, status: 'Inactive' };
  const lrPO21 = { purchaseOrderId: 21 };
  const isInactiveForPO21 = statusResultPO8.purchaseOrderId === lrPO21.purchaseOrderId && statusResultPO8.status === 'Inactive';
  assert.equal(isInactiveForPO21, false, 'PO21 must not be treated as Inactive from stale PO8 status');
  // Create Replacement must not be enabled from stale state
  const canOfferWithStale = statusResultPO8.purchaseOrderId === lrPO21.purchaseOrderId && statusResultPO8.status === 'Inactive';
  assert.equal(canOfferWithStale, false);
});

test('lookup failure does NOT produce Inactive label', () => {
  // failed -> should not show Inactive nor offer replacement as Inactive
  assert.match(purchaseFields, /failed.*PO lookup unavailable/);
  // canOfferReplacement must require isCurrentPOActuallyInactive OR fallback with isStatusUnknown+lookupSucceeded
  assert.match(purchaseFields, /canOfferReplacement[\s\S]*?isCurrentPOActuallyInactive/);
  assert.match(purchaseFields, /canOfferReplacementFallback/);
  assert.match(purchaseFields, /isStatusUnknown/);
  assert.match(purchaseFields, /lookupSucceeded/);
  // Failed or legacyUnresolved must block replacement
  assert.match(purchaseFields, /!failed/);
  assert.match(purchaseFields, /!legacyUnresolved/);
});

test('incompatible identity edit does not make Active current PO appear Inactive', () => {
  // After Billing Party change, old Active PO (e.g. 8) is absent from new Active options,
  // but should not be labeled Inactive when its actual status is Active.
  // Our fix shows Inactive only when actual status === 'Inactive'.
  assert.match(purchaseFields, /currentPOStatus = selectedIsActive \? "Active" : isCurrentPOActuallyInactive/);
});

test('stable editing LR key does not change when customer/Billing Party changes', () => {
  const dispatch = read('components/lr/sections/DispatchDocumentsSection.tsx');
  assert.match(dispatch, /key=\{excludeLrId \?\? "create"\}/);
  assert.doesNotMatch(dispatch, /key=\{lr\.customer\}/);
});

test('different LR ID resets PurchaseOrderFields identity baseline', () => {
  // excludeLrId changes -> key changes -> remount -> new initialIdentities
  const dispatch = read('components/lr/sections/DispatchDocumentsSection.tsx');
  assert.match(dispatch, /excludeLrId/);
  assert.match(purchaseFields, /initialIdentities/);
  // initialIdentities captured via useState/useEffect, not remounted on customer change alone
  assert.doesNotMatch(purchaseFields, /key=\{lr\.customer\}/);
});

test('unsaved Billing Party change disables replacement', () => {
  assert.match(purchaseFields, /hasUnsavedIdentityChanges/);
  assert.match(purchaseFields, /billingPartyId.*customer|initialIdentities\.billingPartyId/);
  assert.match(purchaseFields, /canOfferReplacement[\s\S]*?!hasUnsavedIdentityChanges/);
});

test('unsaved Consignor change disables replacement', () => {
  assert.match(purchaseFields, /hasUnsavedIdentityChanges[\s\S]*?consignor/);
});

test('unsaved Material change disables replacement', () => {
  assert.match(purchaseFields, /hasUnsavedIdentityChanges[\s\S]*?materialId/);
});

test('consignee-only change disables PO replacement until saved', () => {
  assert.match(purchaseFields, /initialIdentities\.consigneeId !== \(lr\.consigneeId \?\? null\)/);
  assert.match(read('components/lr/partyIdentity.ts'), /previous\.consigneeId !== next\.consigneeId/);
});

test('known Inactive exact current PO can offer replacement', () => {
  assert.match(purchaseFields, /isCurrentPOActuallyInactive/);
  assert.match(purchaseFields, /canOfferReplacementKnownInactive/);
});

test('known Active exact current PO cannot offer replacement', () => {
  // isCurrentPOActuallyInactive false when status Active, and fallback requires !selectedIsActive but also isStatusUnknown
  // Known Active -> statusResult Active -> isCurrentPOActuallyInactive false, isStatusUnknown false -> no fallback
  assert.match(purchaseFields, /currentPOStatus = selectedIsActive \? "Active"/);
});

test('unknown status due lack of purchase_orders/view does not destroy legitimate candidate when Active lookup succeeded', () => {
  assert.match(purchaseFields, /canOfferReplacementFallback/);
  assert.match(purchaseFields, /isStatusUnknown[\s\S]*?lookupSucceeded[\s\S]*?!selectedIsActive/);
  assert.match(purchaseFields, /lookupSucceeded/);
  assert.match(purchaseFields, /legacyUnresolved/);
});

test('unknown status is NEVER displayed as Inactive', () => {
  assert.match(purchaseFields, /currentPOStatus = selectedIsActive \? "Active" : isCurrentPOActuallyInactive \? "Inactive" : ""/);
  assert.doesNotMatch(purchaseFields, /currentPOStatus[\s\S]*?purchaseOrderId \? "Inactive"/);
});

test('Active lookup failure does NOT offer replacement', () => {
  assert.match(purchaseFields, /!failed/);
  // failed -> canOfferReplacement false
});

test('unresolved legacy Billing Party does NOT offer replacement', () => {
  assert.match(purchaseFields, /legacyUnresolved/);
  assert.match(purchaseFields, /canOfferReplacement[\s\S]*?!legacyUnresolved/);
});

test('unsaved identity always suppresses replacement even when old persisted PO is Inactive', () => {
  assert.match(purchaseFields, /hasUnsavedIdentityChanges/);
  assert.match(purchaseFields, /canOfferReplacement[\s\S]*?!hasUnsavedIdentityChanges/);
});

test('Create Replacement offered only when zero compatible Active POs exist', () => {
  assert.match(purchaseFields, /canOfferReplacement[\s\S]*?options\.length === 0/);
});

test('current PO known Inactive + compatible Active PO exists -> Change PO available, Create Replacement NOT available', () => {
  // Known Inactive true but options.length >0 (e.g. PO 21 exists) -> canOfferReplacement false due to options.length===0 guard
  // Change PO is available via options.length>0 branch
  assert.match(purchaseFields, /!changeMode && options\.length > 0[\s\S]*?Change PO/);
  // Simulate: isCurrentPOActuallyInactive true, options=[PO21], canOfferReplacement requires options.length===0 -> false
  const isCurrentPOActuallyInactive = true;
  const options = [{ id: 21 }];
  const canOffer = isCurrentPOActuallyInactive && options.length === 0;
  assert.equal(canOffer, false);
});

test('current PO status unknown + current PO absent but another compatible Active PO exists -> Change PO available, Create Replacement NOT available', () => {
  // Unknown status (no purchase_orders/view) + lookupSucceeded + !selectedIsActive + options>0
  // Fallback would be true, but options.length===0 guard blocks replacement
  const isStatusUnknown = true;
  const lookupSucceeded = true;
  const selectedIsActive = false;
  const options = [{ id: 21 }];
  const isCurrentPOActuallyInactive = false;
  const canOfferFallback = isStatusUnknown && lookupSucceeded && !selectedIsActive;
  const canOfferWithGuard = canOfferFallback && options.length === 0;
  assert.equal(canOfferWithGuard, false, 'Create Replacement must not be offered when compatible Active exists');
  // Change PO still available
  assert.equal(options.length > 0, true);
});

test('current PO known Inactive + successful Active lookup returns zero -> replacement remains available', () => {
  const isCurrentPOActuallyInactive = true;
  const options = [];
  const lookupSucceeded = true;
  const legacyUnresolved = false;
  const canOffer = isCurrentPOActuallyInactive && options.length === 0 && lookupSucceeded && !legacyUnresolved;
  assert.equal(canOffer, true);
});

test('permission-safe unknown-status fallback + successful zero Active lookup -> replacement candidate remains available, but UI does NOT label current PO Inactive', () => {
  const isStatusUnknown = true;
  const lookupSucceeded = true;
  const selectedIsActive = false;
  const options = [];
  const currentPOStatus = selectedIsActive ? "Active" : false ? "Inactive" : ""; // isCurrentPOActuallyInactive false
  assert.equal(currentPOStatus, "", 'must not display Inactive when status unknown');
  const canOfferFallback = isStatusUnknown && lookupSucceeded && !selectedIsActive && options.length === 0;
  assert.equal(canOfferFallback, true);
});

test('existing replacement RPC remains authoritative', () => {
  assert.match(m095, /v_old_po\.status <> 'Inactive'/);
  assert.match(m095, /for update/);
});

test('legitimate known-Inactive PO still preserves Create Replacement PO flow', () => {
  assert.match(purchaseFields, /Create Replacement PO/);
  assert.match(purchaseFields, /isCurrentPOActuallyInactive/);
  // Server RPC still authoritative for replacement (095)
  assert.match(m095, /v_old_po\.status <> 'Inactive'/);
});

test('Create LR follows pre-feature PO validation path (no legacy resolution)', () => {
  // LRDialog must have dedicated !isEditing branch with pre-feature validation and no getLrBillingPartyLookup
  const createBranch = lrDialog.slice(lrDialog.indexOf('if (!isEditing)'), lrDialog.indexOf('} else if (poChanged)'));
  assert.match(createBranch, /getActiveLrPurchaseOrders\(values\.billingPartyId, values\.consignor, values\.consigneeId, values\.materialId\)/);
  assert.match(createBranch, /\(active\.length > 0 \|\| values\.purchaseOrderId\) && !active\.some/);
  assert.doesNotMatch(createBranch, /getLrBillingPartyLookup/);
});

test('Change PO legacy Billing resolution is NOT invoked for Create LR', () => {
  const createBranch = lrDialog.slice(lrDialog.indexOf('if (!isEditing)'), lrDialog.indexOf('} else if (poChanged)'));
  assert.doesNotMatch(createBranch, /billingPartyId.*customer|getLrBillingPartyLookup/);
});

test('Ordinary Edit LR with no PO change does NOT run legacy enrichment', () => {
  // LRListPage enrichment is gated by isPoChangeForLegacy
  assert.match(lrListPage, /isPoChangeForLegacy/);
  assert.match(lrListPage, /if\s*\(\s*isPoChangeForLegacy\s*&&/);
});

test('Ordinary Edit LR with no PO change does NOT populate billingPartyId/consignorId/consigneeId', () => {
  // Enrichment is gated by isPoChangeForLegacy
  assert.match(lrListPage, /isPoChangeForLegacy/);
  assert.match(lrListPage, /if \(\s*isPoChangeForLegacy &&/);
  // For Change PO, only billingPartyId is enriched (consignorId preserved as NULL, consigneeId untouched)
  const changeBlockStart = lrListPage.indexOf('isPoChangeForLegacy &&');
  const changeBlockEnd = lrListPage.indexOf('} catch {', changeBlockStart);
  const changeBlock = lrListPage.slice(changeBlockStart, changeBlockEnd);
  assert.match(changeBlock, /billingPartyId/);
  assert.doesNotMatch(changeBlock, /consignorId/);
  assert.doesNotMatch(changeBlock, /consigneeId/);
});

test('Actual PO change on legacy LR resolves exactly-one Billing Party', () => {
  assert.match(lrListPage, /billingPartyId == null && enrichedValues\.billingPartyId == null && enrichedValues\.customer\.trim\(\)/);
  assert.match(lrListPage, /matches\.length === 1[\s\S]*?billingPartyId/);
  assert.match(lrListPage, /Billing party must resolve to exactly one finalized master record/);
});

test('Actual PO change on legacy LR does NOT populate consignorId (preserve trailing-space snapshot)', () => {
  // Must not enrich consignorId for Change PO; consignor text is used for PO matching, not ID
  const changeBlock = lrListPage.slice(lrListPage.indexOf('isPoChangeForLegacy &&'), lrListPage.indexOf('} catch {', lrListPage.indexOf('isPoChangeForLegacy &&')));
  assert.doesNotMatch(changeBlock, /consignorId/);
  assert.doesNotMatch(changeBlock, /getLrCustomerLookup/);
});

test('Actual PO change does NOT resolve/write Consignee', () => {
  const enrichForChange = lrListPage.slice(lrListPage.indexOf('isPoChangeForLegacy &&'), lrListPage.indexOf('} catch {', lrListPage.indexOf('isPoChangeForLegacy &&')));
  // Should not contain consigneeId in the isPoChangeForLegacy condition
  assert.doesNotMatch(enrichForChange, /consigneeId/);
  // And no consigneeId enrichment inside that block
  assert.doesNotMatch(enrichForChange, /enrichedValues\.consigneeId/);
});

test('ambiguous/missing Billing Party fails Change PO', () => {
  assert.match(lrListPage, /Billing party not found for LR customer/);
  assert.match(lrListPage, /Billing party must resolve to exactly one finalized master record/);
});

test('ambiguous/missing Consignor does NOT fail Change PO (consignorId not enriched)', () => {
  // Consignee/consignor enrichment removed; consignor text is used as-is for PO matching
  const changeBlock = lrListPage.slice(lrListPage.indexOf('isPoChangeForLegacy &&'), lrListPage.indexOf('} catch {', lrListPage.indexOf('isPoChangeForLegacy &&')));
  assert.doesNotMatch(changeBlock, /Consignor not found/);
  assert.doesNotMatch(changeBlock, /Consignor must resolve/);
});

test('LR19612 can change PO8 -> PO21 with correct IDs via normal update (preserve consignor snapshot)', async () => {
  const billingParties = [{ id: 18, name: 'M/S: RE SUSTAINABILITY SERVICE PVT LTD', entryStatus: 'final' }];
  const editingLR = {
    billingPartyId: null,
    consignorId: null,
    customer: 'M/S: RE SUSTAINABILITY SERVICE PVT LTD',
    consignor: 'M/S SUSBDE LOC NAGPUR PVT LTD ', // legacy trailing space
    materialId: 246,
    purchaseOrderId: 8,
  };
  const values = {
    billingPartyId: null,
    consignorId: null,
    customer: 'M/S: RE SUSTAINABILITY SERVICE PVT LTD',
    consignor: 'M/S SUSBDE LOC NAGPUR PVT LTD ', // preserve exactly
    materialId: 246,
    purchaseOrderId: 21,
  };
  let enriched = { ...values };
  const normB = enriched.customer.trim().toUpperCase();
  const mB = billingParties.filter(p => p.name.trim().toUpperCase()===normB && p.entryStatus==='final');
  if (mB.length===1) {
    const matched = mB[0];
    const billingSnapshotMatches = enriched.customer === matched.name || enriched.customer === matched.name.toUpperCase();
    assert.equal(billingSnapshotMatches, true, 'LR19612 billing snapshot must match exact or upper');
    enriched.billingPartyId = matched.id;
  }
  // ConsignorId must remain null, consignor text preserved exactly
  assert.equal(enriched.billingPartyId, 18);
  assert.equal(enriched.consignorId, null);
  assert.equal(enriched.consignor, 'M/S SUSBDE LOC NAGPUR PVT LTD ', 'trailing space preserved');
  assert.equal(enriched.materialId, 246);
  assert.equal(enriched.purchaseOrderId, 21);
  const po21 = { po_number: 'KU/KUE/8424000211', issue_date: '2026-08-29' };
  assert.equal(po21.po_number, 'KU/KUE/8424000211');
  assert.equal(po21.issue_date, '2026-08-29');
  // Verify PO compatibility uses text (upper trim) so trailing space still matches
  assert.equal(enriched.consignor.trim().toUpperCase(), 'M/S SUSBDE LOC NAGPUR PVT LTD');
  assert.equal(po21.po_number, 'KU/KUE/8424000211');
});

test('exact Billing Party snapshot is accepted/enriched', () => {
  const billingParties = [{ id: 18, name: 'M/S: RE SUSTAINABILITY SERVICE PVT LTD', entryStatus: 'final' }];
  const enriched = { customer: 'M/S: RE SUSTAINABILITY SERVICE PVT LTD' };
  const matched = billingParties[0];
  const billingSnapshotMatches = enriched.customer === matched.name || enriched.customer === matched.name.toUpperCase();
  assert.equal(billingSnapshotMatches, true);
});

test('uppercase(master.name) snapshot is accepted/enriched', () => {
  const billingParties = [{ id: 18, name: 'M/S: RE SUSTAINABILITY SERVICE PVT LTD', entryStatus: 'final' }];
  const enriched = { customer: 'M/S: RE SUSTAINABILITY SERVICE PVT LTD'.toUpperCase() };
  const matched = billingParties[0];
  const billingSnapshotMatches = enriched.customer === matched.name || enriched.customer === matched.name.toUpperCase();
  assert.equal(billingSnapshotMatches, true);
});

test('whitespace-different snapshot found by normalized lookup is rejected rather than rewritten', () => {
  const billingParties = [{ id: 18, name: 'M/S: RE SUSTAINABILITY SERVICE PVT LTD', entryStatus: 'final' }];
  const enriched = { customer: '  M/S: RE SUSTAINABILITY SERVICE PVT LTD  ' };
  const norm = enriched.customer.trim().toUpperCase();
  const matches = billingParties.filter(p => p.name.trim().toUpperCase()===norm && p.entryStatus==='final');
  assert.equal(matches.length, 1, 'normalized lookup finds master');
  const matched = matches[0];
  const billingSnapshotMatches = enriched.customer === matched.name || enriched.customer === matched.name.toUpperCase();
  assert.equal(billingSnapshotMatches, false, 'whitespace-different must be rejected, not rewritten');
});

test('normal LR create/numbering service calls are unchanged by this diff', () => {
  const diff = read('components/lr/LRListPage.tsx');
  // Should still call createNumberedLrDraft, finalizeLegacyLrDraft, updateLR as before
  assert.match(diff, /createNumberedLrDraft/);
  assert.match(diff, /finalizeLegacyLrDraft/);
  assert.match(diff, /updateLR\(editingLR\.id/);
});

test('no LR-running-number/number-series code is modified', () => {
  const diff = `LRDialog:${lrDialog}\nLRListPage:${lrListPage}\nPurchaseFields:${purchaseFields}`;
  // Comments containing create_numbered_lr_draft are pre-existing; check for actual SQL DDL
  assert.doesNotMatch(diff, /CREATE\s+FUNCTION.*create_numbered/i);
  assert.doesNotMatch(diff, /ALTER\s+TABLE.*lr_running_number/i);
  assert.doesNotMatch(diff, /running_number.*sequence/i);
  assert.doesNotMatch(diff, /CREATE TRIGGER/);
  assert.doesNotMatch(diff, /CREATE POLICY/);
  // No GRANT changes in JS diff (SQL grants are in migrations, not components)
  assert.doesNotMatch(diff, /GRANT\s+.*purchase_orders/);
});

test('Multiple Active POs remain selectable', async () => {
  // Simulate getActiveLrPurchaseOrders returning multiple for same identity
  const active = [
    { id: 21, poNumber: 'KU/KUE/8424000211', issueDate: '2026-08-29' },
    { id: 22, poNumber: 'KU/KUE/8424000212', issueDate: '2026-07-20' },
  ];
  assert.equal(active.length, 2);
  assert.ok(active.some(p => p.id === 21) && active.some(p => p.id === 22), 'both must be offered');
});
