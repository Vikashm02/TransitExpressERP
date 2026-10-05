import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { selectLrMaterial, materialFinalizationError } from '../components/lr/materialIdentity.ts';
import { lrPoPartyChanged, readPartyIdentity } from '../components/lr/partyIdentity.ts';
import { normalizeLrTextFields } from '../components/lr/lrTextNormalize.ts';
import { purchaseOrderSchema } from '../components/purchaseOrder/purchaseOrder.schema.ts';
const read = (p) => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const m102=read('database/migrations/102_po_material_identity.sql');
const m103=read('database/migrations/103_po_material_identity_enforcement.sql');
const source=read('components/services/purchaseOrder.service.ts');
const ast=ts.createSourceFile('service.ts',source,ts.ScriptTarget.Latest,true);
const lookupNode=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='getActiveLrPurchaseOrders');
const lookupJs=ts.transpileModule(lookupNode.getText(ast).replace('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function lookupMock(){const calls=[];const supabase={rpc:async(name,args)=>{calls.push({name,args});return {error:null,data:[
 {id:1,billing_party_id:9,consignee_id:5,material_id:10,po_number:'A',issue_date:'2026-01-01'},
 {id:2,billing_party_id:9,consignee_id:5,material_id:10,po_number:'A2',issue_date:'2026-01-01'},
 {id:3,billing_party_id:9,consignee_id:5,material_id:11,po_number:'B',issue_date:'2026-01-01'},
 {id:4,billing_party_id:9,consignee_id:null,material_id:null,po_number:'LEGACY',issue_date:'2026-01-01'},
 {id:5,billing_party_id:9,consignee_id:6,material_id:10,po_number:'SAME-NAME-DIFFERENT-ID',issue_date:'2026-01-01'},
]}}};return {calls,run:new Function('supabase','readPartyIdentity',lookupJs+';return getActiveLrPurchaseOrders')(supabase,readPartyIdentity)};}
test('Material A retains both eligible POs, without a multiplicity restriction',async()=>{const h=lookupMock();assert.deepEqual((await h.run(9,'Sender',5,10)).map(x=>x.id),[1,2]);assert.deepEqual(h.calls,[{name:'get_lr_purchase_orders_by_party_consignee_material_id',args:{p_billing_party_id:9,p_consignor:'Sender',p_consignee_id:5,p_material_id:10}}]);});
test('Material B excludes A and legacy NULL',async()=>{const h=lookupMock();assert.deepEqual((await h.run(9,'Sender',5,11)).map(x=>x.id),[3]);});
test('Consignee ID excludes same-display-name candidates with another stable ID',async()=>{const h=lookupMock();assert.deepEqual((await h.run(9,'Sender',5,10)).map(x=>x.id),[1,2]);});
test('no lookup before all four identities/context are supplied',async()=>{const h=lookupMock();for(const args of [[null,'Sender',5,10],[9,'Sender',null,10],[9,'Sender',5,null],[9,'',5,10]])assert.deepEqual(await h.run(...args),[]);assert.equal(h.calls.length,0);});
test('explicit selection stores ID and exact name, not description',()=>{const r=selectLrMaterial({materialDescription:'SHREDDED RDF',packageType:'MT',billingPartyId:9},{id:10,materialName:'Untreated RDF',unit:'TON'});assert.equal(r.materialId,10);assert.equal(r.material,'Untreated RDF');assert.equal(r.materialDescription,'SHREDDED RDF');assert.equal(r.billingPartyId,9);});
test('description-only changes never change PO context',()=>{const r={materialId:10,purchaseOrderId:1,materialDescription:'A'};assert.equal(lrPoPartyChanged(r,{...r,materialDescription:'B'}),false);});
test('different material IDs change PO context even for identical names',()=>{assert.equal(lrPoPartyChanged({materialId:10,material:'RDF'},{materialId:11,material:'RDF'}),true);});
test('snapshot normalization preserves Material case and legacy text',()=>{const r={material:'Old Master Name',materialId:null};assert.equal(normalizeLrTextFields(r).material,r.material);assert.equal(normalizeLrTextFields(r).materialId,null);});
test('matching text does not satisfy finalization identity',()=>{assert.ok(materialFinalizationError({material:'Untreated RDF',materialId:null}));assert.equal(materialFinalizationError({materialId:10}),null);});
test('UI material changes use PO reset handler, descriptions are absent from its comparison',()=>{assert.match(read('components/lr/LRForm.tsx'),/<MaterialSection[\s\S]*?onChange=\{changeParty\}/);assert.doesNotMatch(read('components/lr/partyIdentity.ts'),/materialDescription/);});
test('SQL lookup uses Material ID equality and existing Active/consignor semantics',()=>{const sql=m102.slice(m102.indexOf('create function public.get_lr_purchase_orders_by_party_material_id'),m102.indexOf('-- PO users'));assert.match(sql,/p\.material_id=p_material_id and p\.status='Active'/);assert.match(sql,/upper\(trim\(coalesce\(p\.consignor,''\)\)\)=upper\(trim\(p_consignor\)\)/);assert.doesNotMatch(sql,/material_description|material_name/);});
test('indexes are non-unique; old PO-number uniqueness is not replaced',()=>{assert.doesNotMatch(m102+m103,/create\s+unique|drop\s+index|drop\s+constraint/i);assert.match(read('database/migrations/075_purchase_order_consignor_and_lr_route.sql'),/purchase_orders_party_consignor_number/);});
test('M100 identities persist alongside material in numbered draft',()=>{const sql=m102.slice(m102.indexOf('create or replace function public.create_numbered_lr_draft'),m102.indexOf('create or replace function public.lr_validate_purchase_order'));for(const key of ['billing_party_id','consignor_id','consignee_id','material_id'])assert.match(sql,new RegExp("p_payload->>'"+key+"'"));});
test('corrected draft wrapper and historical bulk function are never replaced',()=>{assert.doesNotMatch(m102+m103,/create\s+(or replace\s+)?function public\.(create_numbered_lr_draft_with_po|create_historical_lr_bulk)\(/i);});
test('snapshot trigger only reads master on explicit identity change',()=>{const sql=m102.slice(m102.indexOf('create function public.lr_validate_material_identity'),m102.indexOf('create function public.get_lr_purchase_orders'));assert.match(sql,/new.material_id is not distinct from old.material_id[\s\S]*new.material := old.material;[\s\S]*return new;/);assert.match(sql,/select material_name into v_name/);assert.doesNotMatch(sql,/material_description/);});
test('replacement material comes from persisted locked LR; old safeguards remain',()=>{const sql=m102.slice(m102.indexOf('create or replace function public.create_replacement'),m102.indexOf('create or replace function public.lr_edit_field_diffs'));for(const text of ['v_lr.material_id is null','v_lr.material_id,',"v_old_po.status <> 'Inactive'",'staff_within_48h_edit_window','where id = v_lr.id',"has_permission('lr', 'edit')"])assert.ok(sql.includes(text));});
test('audit retains party identities, Material text and new identity',()=>{for(const field of ['billing_party_id','consignor_id','consignee_id','material','material_id'])assert.ok(m102.includes("('"+field+"',"));});
test('stage 2 enforces insert and assigned-ID clearing, not legacy NULL updates',()=>{assert.match(m103,/if tg_op = 'INSERT'/);assert.match(m103,/elsif old.material_id is not null and new.material_id is null/);assert.doesNotMatch(m103,/set not null|create\s+unique/i);});
test('no replacement of RLS, 48-hour, financial or notification functions',()=>{assert.doesNotMatch(m102+m103,/create policy|drop policy|disable row level|function public\.(staff_within_48h_edit_window|update_lr_financials|queue_trusted)/i);});

// Execute the actual service/form handlers with local mocks, not copies of their logic.
function handler(path, name, dependencies) {
  const code = read(path);
  const tree = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, name);
  const js = ts.transpileModule(found.getText(tree).replace(/^export /, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), js + `; return ${name};`)(...Object.values(dependencies));
}

test('actual form handler clears PO for Material ID changes but preserves it for description changes', () => {
  const lr = { materialId: 10, purchaseOrderId: 7, poNumber: 'KEEP', poDate: '2026-01-01', materialDescription: 'A' };
  const calls = [];
  const change = handler('components/lr/LRForm.tsx', 'changeParty', {
    lr, lrPoPartyChanged, setPoSelectionRequested: v => calls.push(['lookup', v]),
    onChange: v => calls.push(['change', v]),
  });
  change({ ...lr, materialDescription: 'B' });
  assert.deepEqual(calls, [['change', { ...lr, materialDescription: 'B' }]]);
  calls.length = 0;
  change({ ...lr, materialId: 11 });
  assert.deepEqual(calls, [['lookup', true], ['change', {
    ...lr, materialId: 11, purchaseOrderId: null, poNumber: '', poDate: '',
  }]]);
});

test('PO service persists explicit IDs, rejects new NULL, and allows legacy NULL edits', async () => {
  const calls = [];
  const query = { eq: () => query, select: () => query, single: async () => ({ error: null }) };
  const save = handler('components/services/purchaseOrder.service.ts', 'savePurchaseOrder', {
    purchaseOrderSchema,
    supabase: { from: table => ({
      insert: row => { calls.push([table, 'insert', row]); return query; },
      update: row => { calls.push([table, 'update', row]); return query; },
    }) },
  });
  const values = { billingPartyId: 9, consignor: 'Sender', consigneeId: 5, poNumber: 'A', issueDate: '2026-01-01', allottedWeight: 1, status: 'Active' };
  await assert.rejects(save(null, { ...values, materialId: null }), /Select Material/);
  assert.equal(calls.length, 0);
  await save(null, { ...values, materialId: 10 });
  await save(7, { ...values, materialId: null });
  assert.equal(calls[0][2].material_id, 10);
  assert.equal(calls[1][2].material_id, null);
});

test('replacement handler blocks NULL or unsaved material before any RPC', async () => {
  for (const [persisted, selected] of [[null, 10], [10, 11]]) {
    const calls = [];
    const replace = handler('components/lr/LRDialog.tsx', 'handleCreateReplacementPo', {
      readOnly: false, lr: { id: 'uuid', entryStatus: 'final', materialId: persisted },
      isEditing: true, isDraftEntry: () => false, replacementSaving: false,
      values: { materialId: selected }, toast: { error: v => calls.push(v) },
      setReplacementSaving: () => assert.fail('must not start RPC'),
    });
    await replace('NEW', '2026-01-01');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /Select and save Material/);
  }
});

test('replacement SQL is exactly M095 plus the material prerequisite and inherited ID', () => {
  const definition = sql => sql.slice(sql.indexOf('create or replace function public.create_replacement'), sql.indexOf('\n$$;', sql.indexOf('create or replace function public.create_replacement')) + 4);
  const current = definition(m102)
    .replace("\n  if v_lr.material_id is null then\n    raise exception 'Select and save a Material on this LR before creating a replacement PO';\n  end if;\n", '')
    .replace('    material_id,\n', '').replace('    v_lr.material_id,\n', '');
  assert.equal(current, definition(read('database/migrations/095_create_replacement_po_from_lr.sql')));
});

test('auto-created PO checks existing number/material conflict before insert and never retags a PO', () => {
  const sql = m102.slice(m102.indexOf('create or replace function public.lr_create_purchase_order_from_snapshot'), m102.indexOf('create or replace function public.create_replacement'));
  assert.match(sql, /v_po.material_id is distinct from new.material_id/);
  assert.match(sql, /values\(v_party_id,new.consignor,new.material_id/);
  assert.doesNotMatch(sql, /update public.purchase_orders/i);
  assert.match(sql, /if new.purchase_order_id is not null then return new/);
});

test('stage 1 adds only nullable restrictive Material FKs, without historical data rewrite', () => {
  for (const table of ['purchase_orders', 'lrs']) {
    assert.ok(m102.includes(`alter table public.${table} add column material_id bigint references public.materials(id) on delete restrict;`));
  }
  assert.doesNotMatch(m102 + m103, /\b(delete from|truncate|set not null)\b/i);
  // All UPDATE statements are inside the reviewed trigger/RPC bodies, never migration-level backfills.
  assert.doesNotMatch((m102 + m103).replace(/\$\$[\s\S]*?\$\$/g, ''), /\bupdate\s+public\./i);
});

const legacy = { entryStatus: 'final', materialId: null, material: 'Old snapshot', purchaseOrderId: 7,
  poNumber: 'OLD', poDate: '2025-01-01', customer: 'Billing', billingPartyId: 9, consignor: 'Sender', consignorId: 2 };

test('legacy finalized first Material selection preserves inactive PO link and snapshot in actual form handler', () => {
  const calls = [];
  const change = handler('components/lr/LRForm.tsx', 'changeParty', {
    lr: legacy, lrPoPartyChanged, setPoSelectionRequested: () => assert.fail('must not reset'),
    onChange: v => calls.push(v),
  });
  const selected = selectLrMaterial(legacy, { id: 10, materialName: 'Material A', unit: 'MT' });
  change(selected);
  assert.equal(calls[0].materialId, 10);
  assert.equal(calls[0].material, 'Material A');
  for (const key of ['purchaseOrderId', 'poNumber', 'poDate']) assert.equal(calls[0][key], legacy[key]);
});

test('legacy enrichment save does not query Active POs and submits original link', async () => {
  const { isLegacyMaterialEnrichment } = await import('../components/lr/partyIdentity.ts');
  const selected = selectLrMaterial(legacy, { id: 10, materialName: 'Material A', unit: 'MT' });
  const saved = [];
  const save = handler('components/lr/LRDialog.tsx', 'handleSave', {
    lr: legacy, values: selected, isEditing: true, readOnly: false, checkingPo: false,
    loading: false, replacementSaving: false, requireMaterialDescription: false,
    validateLR: () => ({}), isDraftEntry: s => s === 'draft', isDraftLrNumber: () => false,
    isLegacyMaterialEnrichment, setCheckingPo: () => {}, setErrors: () => {},
    getActiveLrPurchaseOrders: () => assert.fail('historical PO must not require Active eligibility'),
    onSubmit: async v => saved.push(v), toast: { error: () => assert.fail('save failed') },
  });
  await save();
  assert.deepEqual(saved, [selected]);
});

test('persisted enriched LR enters actual replacement handler with original LR ID', async () => {
  const persisted = { ...legacy, id: '00000000-0000-0000-0000-000000000123', materialId: 10 };
  const calls = [];
  const replace = handler('components/lr/LRDialog.tsx', 'handleCreateReplacementPo', {
    lr: persisted, values: persisted, isEditing: true, readOnly: false, replacementSaving: false,
    isDraftEntry: () => false, setReplacementSaving: () => {}, setErrors: () => {}, setValues: () => {},
    emptyLR: {}, normalizeLrTextFields: v => v, toEditableLR: v => v,
    onReplacementCreated: async () => {}, toast: { success: () => {}, error: () => assert.fail('replacement failed') },
    createReplacementPurchaseOrderFromLr: async (...args) => { calls.push(args); return { ...persisted, purchaseOrderId: 8 }; },
  });
  await replace('NEW', '2026-01-01');
  assert.deepEqual(calls, [[persisted.id, 'NEW', '2026-01-01']]);
});

test('enrichment exception cannot bypass changed PO, parties, existing Material, or draft matching', () => {
  for (const [before, after] of [
    [{ ...legacy, materialId: 10 }, { ...legacy, materialId: 11 }],
    [{ ...legacy, entryStatus: 'draft' }, { ...legacy, entryStatus: 'draft', materialId: 10 }],
    [{ ...legacy, entryStatus: 'draft' }, { ...legacy, materialId: 10 }],
    [legacy, { ...legacy, purchaseOrderId: 8, materialId: 10 }],
    [legacy, { ...legacy, billingPartyId: 99, materialId: 10 }],
    [legacy, { ...legacy, consignor: 'Other', materialId: 10 }],
    [{ ...legacy, purchaseOrderId: null }, { ...legacy, purchaseOrderId: null, materialId: 10 }],
  ]) assert.equal(lrPoPartyChanged(before, after), true);
  assert.equal(lrPoPartyChanged(legacy, { ...legacy, materialDescription: 'changed' }), false);
});

test('SQL enrichment exception is update/final/first-ID/same-link only and preserves snapshot', () => {
  const sql = m102.slice(m102.indexOf('create or replace function public.lr_validate_purchase_order'), m102.indexOf('create or replace function public.lr_create_purchase_order_from_snapshot'));
  assert.match(sql, /if tg_op = 'UPDATE' then\s+v_legacy_material_enrichment := old.entry_status = 'final' and new.entry_status = 'final'/);
  assert.match(sql, /old.material_id is null and new.material_id is not null/);
  assert.match(sql, /old.purchase_order_id is not null\s+and new.purchase_order_id is not distinct from old.purchase_order_id/);
  assert.match(sql, /or \(new.material_id is distinct from old.material_id and not v_legacy_material_enrichment\)/);
  assert.match(sql, /elsif v_legacy_material_enrichment then[\s\S]*?new.po_number := old.po_number;\s+new.po_date := old.po_date;/);
  assert.match(sql, /v_selection := tg_op = 'INSERT'/);
  assert.match(sql, /old.entry_status = 'draft' and new.entry_status = 'final'/);
});

test('M103 LR guard is UPDATE-only and limited to draft-to-final with NULL Material', () => {
  const sql = m103.slice(m103.indexOf('create function public.lr_require_material_on_finalization'));
  assert.match(sql, /old.entry_status = 'draft' and new.entry_status = 'final' and new.material_id is null/);
  assert.match(sql, /raise exception 'Select Material before finalizing this LR'/);
  assert.match(sql, /before update on public.lrs/);
  assert.doesNotMatch(sql, /before insert|after insert|create_historical_lr_bulk/);
});
