import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LR_RECOVERY_USER_ID,
  canContinueDraftRecord,
  isLrRecoveryExceptionApplicable,
} from '../components/lr/lrDraftRecovery.ts';
import { canStaffEditRecord } from '../lib/editWindow.ts';

const OM = LR_RECOVERY_USER_ID;
const OTHER_STAFF = '11111111-2222-3333-4444-555555555555';

// Deterministic clock: 2026-10-03T00:00:00Z
const NOW = Date.parse('2026-10-03T00:00:00.000Z');
const WITHIN_48H = '2026-10-02T12:00:00.000Z'; // 12h old
const EXPIRED = '2026-09-28T00:00:00.000Z'; // 5 days old

const draft19646 = { lrNumber: 'LR19646', entryStatus: 'draft', created_at: EXPIRED };
const draft19647 = { lrNumber: 'LR19647', entryStatus: 'draft', created_at: EXPIRED };
const draftOther = { lrNumber: 'LR19648', entryStatus: 'draft', created_at: EXPIRED };
const final19646 = { lrNumber: 'LR19646', entryStatus: 'final', created_at: EXPIRED };
const freshDraft = { lrNumber: 'LR19646', entryStatus: 'draft', created_at: WITHIN_48H };

test('1. Om + LR19646 + Draft + permission, expired 48h => allowed', () => {
  const staffEditAllowed = canStaffEditRecord(false, true, draft19646, NOW);
  assert.equal(staffEditAllowed, false);
  assert.equal(canContinueDraftRecord(true, staffEditAllowed, draft19646, OM), true);
});

test('2. Om + LR19647 + Draft + permission, expired 48h => allowed', () => {
  const staffEditAllowed = canStaffEditRecord(false, true, draft19647, NOW);
  assert.equal(staffEditAllowed, false);
  assert.equal(canContinueDraftRecord(true, staffEditAllowed, draft19647, OM), true);
});

test('3. Om + another expired Draft => denied', () => {
  const staffEditAllowed = canStaffEditRecord(false, true, draftOther, NOW);
  assert.equal(canContinueDraftRecord(true, staffEditAllowed, draftOther, OM), false);
  assert.equal(isLrRecoveryExceptionApplicable(OM, draftOther), false);
});

test('4. another staff UUID + LR19646 expired Draft => denied', () => {
  const staffEditAllowed = canStaffEditRecord(false, true, draft19646, NOW);
  assert.equal(canContinueDraftRecord(true, staffEditAllowed, draft19646, OTHER_STAFF), false);
  assert.equal(isLrRecoveryExceptionApplicable(OTHER_STAFF, draft19646), false);
});

test('5. Om + LR19646 but no Create/Edit/continue eligibility => denied', () => {
  const staffEditAllowed = canStaffEditRecord(false, false, draft19646, NOW);
  assert.equal(canContinueDraftRecord(false, staffEditAllowed, draft19646, OM), false);
});

test('6. normal staff + Draft within 48h + permission => existing behavior allowed', () => {
  const staffEditAllowed = canStaffEditRecord(false, true, freshDraft, NOW);
  assert.equal(staffEditAllowed, true);
  assert.equal(canContinueDraftRecord(true, staffEditAllowed, freshDraft, OTHER_STAFF), true);
});

test('7. final LR19646 => recovery exception does not apply', () => {
  assert.equal(isLrRecoveryExceptionApplicable(OM, final19646), false);
  // Non-admin, expired, permission present: normal 48h rule still denies.
  const staffEditDenied = canStaffEditRecord(false, true, final19646, NOW);
  assert.equal(canContinueDraftRecord(true, staffEditDenied, final19646, OM), false);
  // Admin keeps existing behavior (window bypass only).
  const staffEditAdmin = canStaffEditRecord(true, true, final19646, NOW);
  assert.equal(canContinueDraftRecord(true, staffEditAdmin, final19646, OM), true);
});

test('8. normal admin behavior remains unchanged', () => {
  // Admin bypasses the window exactly like canStaffEditRecord did.
  const adminAllowed = canStaffEditRecord(true, true, draft19646, NOW);
  assert.equal(canContinueDraftRecord(true, adminAllowed, draft19646, OTHER_STAFF), true);
  // Admin without base eligibility is still denied (no permission weakening).
  const adminNoEligibility = canStaffEditRecord(true, false, draft19646, NOW);
  assert.equal(canContinueDraftRecord(false, adminNoEligibility, draft19646, OTHER_STAFF), false);
  // Om as admin is also allowed through the normal admin path.
  const omAdmin = canStaffEditRecord(true, true, draftOther, NOW);
  assert.equal(canContinueDraftRecord(true, omAdmin, draftOther, OM), true);
});

test('missing user id never qualifies for recovery', () => {
  const expired = canStaffEditRecord(false, true, draft19646, NOW);
  assert.equal(canContinueDraftRecord(true, expired, draft19646, null), false);
  assert.equal(canContinueDraftRecord(true, expired, draft19646, undefined), false);
});

test('lr numbers with surrounding whitespace do not match; lookalikes do not', () => {
  assert.equal(
    isLrRecoveryExceptionApplicable(OM, { ...draft19646, lrNumber: '  LR19646 ' }),
    false
  );
  assert.equal(
    isLrRecoveryExceptionApplicable(OM, { ...draft19646, lrNumber: 'LR196460' }),
    false
  );
  assert.equal(
    isLrRecoveryExceptionApplicable(OM, { ...draft19646, lrNumber: 'lr19646' }),
    false
  );
});
