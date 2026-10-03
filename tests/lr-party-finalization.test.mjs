import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { materialFinalizationError } from '../components/lr/materialIdentity.ts';
import { lrPartyFinalizationError } from '../components/lr/partyIdentity.ts';
import { isDraftLrNumber, isDraftEntry, needsLrNumberAllocation } from '../lib/entryStatus.ts';

const valid = { materialId: 10, customer: 'Billing', consignor: 'Sender', consignee: 'Receiver', billingPartyId: 1, consignorId: 2, consigneeId: 3 };
const messages = [
  'Please reselect Billing Party from Billing Party Master.',
  'Please reselect Consignor from Customer Master.',
  'Please reselect Consignee from Customer Master.',
];
test('populated parties with numeric IDs pass', () => assert.equal(lrPartyFinalizationError(valid), null));
for (const [index, key] of ['billingPartyId', 'consignorId', 'consigneeId'].entries()) {
  for (const missing of [null, undefined]) {
    test(`${key} ${missing} blocks`, () => assert.equal(lrPartyFinalizationError({ ...valid, [key]: missing }), messages[index]));
  }
}
test('error order is billing, consignor, consignee', () => {
  const row = { ...valid, billingPartyId: null, consignorId: null, consigneeId: null };
  assert.equal(lrPartyFinalizationError(row), messages[0]);
  row.billingPartyId = 1;
  assert.equal(lrPartyFinalizationError(row), messages[1]);
  row.consignorId = 2;
  assert.equal(lrPartyFinalizationError(row), messages[2]);
});
test('blank text is left to existing required-text validation; IDs use null checking', () => {
  assert.equal(lrPartyFinalizationError({ customer: '  ', consignor: '', consignee: '\t' }), null);
  assert.equal(lrPartyFinalizationError({ ...valid, billingPartyId: 0 }), null);
});

// Execute the actual submit handler with mocked side effects, without mounting
// the page or importing its Supabase client. TypeScript is already a dependency.
const source = readFileSync(new URL('../components/lr/LRListPage.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findFunction(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `${name} exists`);
  return found.getText(ast);
}
const handler = ts.transpileModule(findFunction('handleSubmit'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
async function submit(editingLR, values, extra = {}) {
  const calls = [];
  const context = {
    editingLR, lrPartyFinalizationError, materialFinalizationError, isDraftLrNumber, isDraftEntry, needsLrNumberAllocation,
    toast: { error: message => calls.push(['error', message]), success: () => {} },
    setSaving: value => calls.push(['saving', value]),
    canStaffEditRecord: () => true, canContinueDraftRecord: () => true, isAdmin: true, canContinueDraft: true, canEdit: true,
    user: null,
    allocateNextLrNumber: async () => { calls.push(['allocate']); return 'LR100'; },
    createNumberedLrDraft: async () => { calls.push(['createNumberedLrDraft']); return { id: 'synthetic', lrNumber: 'LR100' }; },
    createLR: async () => { calls.push(['create']); return { id: 'synthetic', lrNumber: 'LR100' }; },
    updateLR: async () => { calls.push(['update']); return { id: 'synthetic', lrNumber: 'LR100' }; },
    createDraftPromiseRef: { current: null }, sessionCreatedDraftIdRef: { current: null },
    syncVehicleMasterFromLr: async () => calls.push(['vehicle']),
    setDialogOpen: () => {}, setEditingLR: () => {}, setDialogMode: () => {},
    clearCreateSessionTracking: () => {}, loadLRs: async () => {},
    ...extra,
  };
  const run = new Function(...Object.keys(context), `${handler}; return handleSubmit;`)(...Object.values(context));
  await run(values);
  return calls;
}
const missing = { ...valid, billingPartyId: null, consignorId: null, consigneeId: null };
for (const [name, existing] of [
  ['new create', null],
  ['numbered draft', { id: 'synthetic', entryStatus: 'draft', lrNumber: 'LR100' }],
  ['legacy draft number', { id: 'synthetic', entryStatus: 'final', lrNumber: 'DRAFT-old' }],
]) {
  test(`${name} rejects before saving, numbering or writes`, async () => {
    assert.deepEqual(await submit(existing, missing), [['error', messages[0]]]);
  });
}
test('create session with reserved draft also rejects before writes', async () => {
  assert.deepEqual(await submit(null, missing, { sessionCreatedDraftIdRef: { current: 'synthetic' } }), [['error', messages[0]]]);
});
test('valid new finalization reaches createNumberedLrDraft', async () => {
  const calls = await submit(null, valid);
  assert.ok(calls.some(([kind]) => kind === 'createNumberedLrDraft'));
  assert.equal(calls.some(([kind]) => kind === 'error'), false);
});
test('valid draft finalization updates without reallocating', async () => {
  const calls = await submit({ id: 'synthetic', entryStatus: 'draft', lrNumber: 'LR100' }, valid);
  assert.ok(calls.some(([kind]) => kind === 'update'));
  assert.equal(calls.some(([kind]) => kind === 'allocate' || kind === 'error'), false);
});
test('historical final edit with missing IDs reaches update', async () => {
  const calls = await submit({ id: 'synthetic', entryStatus: 'final', lrNumber: 'LR100' }, missing);
  assert.ok(calls.some(([kind]) => kind === 'update'));
  assert.equal(calls.some(([kind]) => kind === 'error'), false);
});
test('guard is absent from autosave and bulk service/import paths', () => {
  assert.doesNotMatch(findFunction('handleAutosave'), /lrPartyFinalizationError/);
  for (const path of ['../components/services/lr.service.ts', '../components/lr/lrBulkUpload.ts']) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), 'utf8'), /lrPartyFinalizationError/);
  }
});

test('interactive new/finalized LR requires explicit Material ID', async () => {
  for (const materialId of [null, undefined]) {
    const calls = await submit(null, { ...valid, materialId });
    assert.deepEqual(calls, [['error', materialFinalizationError({ materialId })]]);
  }
});
