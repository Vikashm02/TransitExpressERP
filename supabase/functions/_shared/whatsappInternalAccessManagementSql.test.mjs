// STATIC contract tests only. This file intentionally never applies SQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../../../database/migrations/114_whatsapp_internal_access_management.sql', import.meta.url),
  'utf8',
);
const executable = sql.replace(/^--.*$/gm, '');
const definition = signature => {
  const start = executable.indexOf(`create function public.${signature}`);
  assert.ok(start >= 0, `${signature} exists`);
  const end = executable.indexOf('$$;', start);
  assert.ok(end > start, `${signature} is complete`);
  return executable.slice(start, end + 3);
};

const requireCreator = definition('whatsapp_internal_access_require_creator()');
const normalizePhone = definition('whatsapp_internal_access_normalize_phone(p_phone_input text)');
const list = definition('whatsapp_internal_access_list()');
const setPhone = definition('whatsapp_internal_access_set_phone(\n  p_target_user_id uuid,\n  p_phone_input text\n)');
const disable = definition('whatsapp_internal_access_disable(p_target_user_id uuid)');

function normalizeIndiaPhoneSpec(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (value.length < 10 || value.length > 32 || !/^\+?[0-9 ()-]+$/.test(value)) return null;
  const digits = value.replace(/[^0-9]/g, '');
  const national = /^[6-9][0-9]{9}$/.test(digits)
    ? digits
    : /^91[6-9][0-9]{9}$/.test(digits)
      ? digits.slice(2)
      : null;
  return national ? `+91${national}` : null;
}

test('M114 is a forward-only fixed-RPC migration with no table, policy, or operational assistant changes', () => {
  assert.match(executable, /^\s*begin;/);
  assert.match(executable, /commit;\s*$/);
  assert.equal((executable.match(/create function public\./g) ?? []).length, 5);
  assert.doesNotMatch(executable, /\b(?:alter\s+table|create\s+table|create\s+(?:or\s+replace\s+)?policy|drop\s+(?:table|policy)|truncate)\b/i);
  assert.doesNotMatch(executable, /whatsapp_internal_operational_(?:query|begin|continue)|whatsapp_external_/);
  assert.doesNotMatch(executable, /\bdelete\s+from\b/i);
  assert.doesNotMatch(executable, /\b(?:insert\s+into|update)\s+public\.(?!whatsapp_user_links\b)/i);
});

test('all management and private helper functions are SECURITY DEFINER with an empty search path', () => {
  for (const body of [requireCreator, normalizePhone, list, setPhone, disable]) {
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
    assert.doesNotMatch(body, /set search_path\s*=\s*(?:public|pg_catalog)/);
  }
});

test('actor authority is server-derived and requires an authenticated approved unlocked Creator', () => {
  assert.match(requireCreator, /v_actor uuid := auth\.uid\(\)/);
  assert.match(requireCreator, /u\.role = 'creator'/);
  assert.match(requireCreator, /u\.approval_status = 'approved'/);
  assert.match(requireCreator, /coalesce\(u\.is_locked, false\) = false/);
  assert.match(requireCreator, /raise exception 'Not permitted' using errcode = '42501'/);
  for (const body of [list, setPhone, disable]) {
    assert.match(body, /public\.whatsapp_internal_access_require_creator\(\)/);
  }
  assert.doesNotMatch(setPhone, /p_(?:actor|created_by|updated_by|audit)/i);
  assert.doesNotMatch(disable, /p_(?:actor|created_by|updated_by|audit)/i);
});

test('mutations reject self and Creator targets; enable/change additionally requires an approved unlocked admin or staff target', () => {
  for (const body of [setPhone, disable]) {
    assert.match(body, /v_target\.id = v_actor or v_target\.role = 'creator'/);
    assert.match(body, /for update/);
    assert.match(body, /v_target\.role not in \('admin', 'staff'\)/);
  }
  assert.match(setPhone, /coalesce\(v_target\.approval_status, 'pending'\) <> 'approved'/);
  assert.match(setPhone, /coalesce\(v_target\.is_locked, false\)/);
  assert.doesNotMatch(disable, /v_target\.approval_status/);
  assert.doesNotMatch(disable, /v_target\.is_locked/);
});

test('phone normalizer accepts only bounded Indian mobile forms and returns exact +91 canonical storage', () => {
  assert.match(normalizePhone, /char_length\(v_input\) not between 10 and 32/);
  assert.ok(normalizePhone.includes("v_input !~ '^\\+?[0-9 ()-]+$'"));
  assert.match(normalizePhone, /v_digits ~ '\^\[6-9\]\[0-9\]\{9\}\$'/);
  assert.match(normalizePhone, /v_digits ~ '\^91\[6-9\]\[0-9\]\{9\}\$'/);
  assert.match(normalizePhone, /return '\+91' \|\| v_national/);
  assert.match(normalizePhone, /Invalid Indian mobile number/);
  for (const accepted of ['9876543210', '919876543210', '+919876543210', '91 98765 43210', '91-98765-43210']) {
    assert.equal(normalizeIndiaPhoneSpec(accepted), '+919876543210', accepted);
  }
  for (const rejected of ['09876543210', '00919876543210', '+91+9876543210', '+14155552671', '5876543210', '987654321', '98765432101', '9876543210 ext 1']) {
    assert.equal(normalizeIndiaPhoneSpec(rejected), null, rejected);
  }
});

test('active exclusion is authoritative for enable/change and management functions never mutate exclusions', () => {
  assert.match(setPhone, /from public\.whatsapp_assistant_access_exclusions e[\s\S]*e\.app_user_id = v_target\.id and e\.is_active/);
  assert.match(setPhone, /raise exception 'Not permitted'/);
  for (const body of [requireCreator, normalizePhone, list, setPhone, disable]) {
    assert.doesNotMatch(body, /\b(?:insert\s+into|update|delete\s+from)\s+public\.whatsapp_assistant_access_exclusions\b/i);
  }
  assert.match(list, /when exclusion\.app_user_id is not null then 'security_override_denied'/);
  assert.doesNotMatch(disable, /whatsapp_assistant_access_exclusions/);
});

test('list returns only safe staff/admin UI fields and derives status from existing ERP LR/POD permission rules', () => {
  assert.match(list, /returns table\([\s\S]*target_user_id uuid[\s\S]*mapping_updated_by_display_name text/);
  assert.match(list, /where u\.role in \('admin', 'staff'\)/);
  assert.match(list, /'security_override_denied'/);
  assert.match(list, /'account_ineligible'/);
  assert.match(list, /'not_configured'/);
  assert.match(list, /'disabled'/);
  assert.match(list, /'enabled_no_lr_permission'/);
  assert.match(list, /'enabled_lr_only'/);
  assert.match(list, /'enabled_lr_and_pod'/);
  assert.match(list, /public\.whatsapp_assistant_has_permission\(u\.id, 'lr'\)/);
  assert.match(list, /public\.whatsapp_assistant_has_permission\(u\.id, 'pod'\)/);
  assert.doesNotMatch(list, /(?:inbound_events|reservation_owner|provider|service_role|created_by\s*,|updated_by\s*,)/i);
});

test('effective access status evaluates the security override before every lower-precedence account or mapping state', () => {
  const securityOverride = list.indexOf("when exclusion.app_user_id is not null then 'security_override_denied'");
  const accountIneligible = list.indexOf("when coalesce(u.approval_status, 'pending') <> 'approved'");
  const notConfigured = list.indexOf("when active_link.id is null and history.app_user_id is null then 'not_configured'");
  const disabled = list.indexOf("when active_link.id is null then 'disabled'");
  const noLr = list.indexOf("when not public.whatsapp_assistant_has_permission(u.id, 'lr') then 'enabled_no_lr_permission'");
  const lrOnly = list.indexOf("when not public.whatsapp_assistant_has_permission(u.id, 'pod') then 'enabled_lr_only'");
  assert.ok(securityOverride >= 0);
  for (const lowerPrecedenceState of [accountIneligible, notConfigured, disabled, noLr, lrOnly]) {
    assert.ok(securityOverride < lowerPrecedenceState, 'security override is evaluated first');
  }
});

test('set-phone preserves history, rejects cross-user historical reuse, and changes active phone atomically', () => {
  assert.match(setPhone, /from public\.whatsapp_user_links w[\s\S]*w\.whatsapp_phone_e164 = v_phone[\s\S]*w\.app_user_id <> v_target\.id/);
  assert.match(setPhone, /raise exception 'Phone unavailable'/);
  assert.match(setPhone, /from public\.whatsapp_phone_reservations r[\s\S]*r\.principal_kind <> 'internal'/);
  assert.match(setPhone, /found and v_existing\.whatsapp_phone_e164 = v_phone[\s\S]*'unchanged'/);
  const disableOld = setPhone.indexOf('set is_active = false, updated_by = v_actor');
  const insertNew = setPhone.indexOf('insert into public.whatsapp_user_links');
  assert.ok(disableOld >= 0 && insertNew > disableOld, 'old active row is disabled before the new history row is inserted');
  assert.match(setPhone, /app_user_id, whatsapp_phone_e164, is_active, created_by, updated_by/);
  assert.match(setPhone, /values \([\s\S]*v_target\.id, v_phone, true, v_actor, v_actor/);
  assert.match(setPhone, /when unique_violation then[\s\S]*raise exception 'Phone unavailable'/);
  assert.doesNotMatch(setPhone, /\bdelete\s+from\b/i);
});

test('set-phone keeps insertion failures propagating after replacement begins', () => {
  assert.doesNotMatch(setPhone, /when\s+others\b/i);
  const insertionException = setPhone.match(/begin\s+insert into public\.whatsapp_user_links[\s\S]*?exception\s+when unique_violation then[\s\S]*?end;/i);
  assert.ok(insertionException, 'the insertion conflict handler is present');
  assert.doesNotMatch(insertionException[0], /\breturn\b/i);
  assert.match(insertionException[0], /raise exception 'Phone unavailable'/);
});

test('set-phone serializes every canonical-phone ownership decision with a transaction-scoped advisory lock', () => {
  // Deterministic, canonical-phone-derived key.
  assert.match(setPhone, /perform\s+pg_advisory_xact_lock\(\s*hashtextextended\('whatsapp_internal_access_phone:' \|\| v_phone,\s*0\)\s*\)/);
  // Transaction-scoped, never a session lock (which could leak or survive).
  assert.doesNotMatch(setPhone, /pg_advisory_lock\s*\(/);
  assert.doesNotMatch(setPhone, /pg_try_advisory_lock/);
  assert.doesNotMatch(setPhone, /pg_advisory_unlock/);
  // Acquired after normalization but before every ownership decision and the insert.
  const phoneLock = setPhone.indexOf('pg_advisory_xact_lock');
  const historyCheck = setPhone.indexOf('and w.app_user_id <> v_target.id');
  const reservationCheck = setPhone.indexOf('from public.whatsapp_phone_reservations r');
  const activeMappingLock = setPhone.indexOf('where w.app_user_id = v_target.id and w.is_active');
  const insertNew = setPhone.indexOf('insert into public.whatsapp_user_links');
  assert.ok(phoneLock >= 0, 'advisory lock is present');
  for (const [name, at] of [
    ['historical ownership check', historyCheck],
    ['reservation conflict check', reservationCheck],
    ['active mapping decision', activeMappingLock],
    ['history insertion', insertNew],
  ]) {
    assert.ok(at > phoneLock, `advisory lock precedes the ${name}`);
  }
  // It must be derived from the persisted canonical phone, not the raw input.
  assert.doesNotMatch(setPhone, /pg_advisory_xact_lock\(hashtextextended\([^)]*p_phone_input/);
});

test('set-phone translates only the known M101 reservation conflict and re-raises everything else', () => {
  // No broad swallowing, ever.
  assert.doesNotMatch(setPhone, /when\s+others\b/i);
  // unique_violation still yields the generic refusal.
  assert.match(setPhone, /when unique_violation then\s*raise exception 'Phone unavailable' using errcode = '23505'/);
  // The ONLY additional translation is the exact M101 reservation message,
  // keyed on SQLSTATE raise_exception + exact text, and it re-raises others.
  assert.match(
    setPhone,
    /when raise_exception then[\s\S]*?if sqlerrm = 'Phone reserved for another identity system' then[\s\S]*?raise exception 'Phone unavailable' using errcode = '23505';[\s\S]*?else[\s\S]*?raise;/,
  );
  // The insertion handler must never return (it must propagate).
  const insertionException = setPhone.match(/begin\s+insert into public\.whatsapp_user_links[\s\S]*?exception\s+when unique_violation then[\s\S]*?when raise_exception then[\s\S]*?end;/i);
  assert.ok(insertionException, 'the insertion conflict handler is present');
  assert.doesNotMatch(insertionException[0], /\breturn\b/i);
  assert.doesNotMatch(insertionException[0], /when\s+others\b/i);
  assert.match(insertionException[0], /raise exception 'Phone unavailable'/);
  assert.match(insertionException[0], /else[\s\S]*?raise;/);
});

test('set-phone explicitly locks the target user and that target’s active mapping', () => {
  assert.match(setPhone, /select \* into v_target\s+from public\.app_users u\s+where u\.id = p_target_user_id\s+for update/i);
  assert.match(setPhone, /select \* into v_existing\s+from public\.whatsapp_user_links w\s+where w\.app_user_id = v_target\.id and w\.is_active\s+for update/i);
});

test('disable is idempotent, retains link history, and may clean up later-ineligible non-Creator targets', () => {
  assert.match(disable, /where w\.app_user_id = v_target\.id and w\.is_active[\s\S]*for update/);
  assert.match(disable, /if not found then[\s\S]*'disabled'/);
  assert.match(disable, /update public\.whatsapp_user_links[\s\S]*set is_active = false, updated_by = v_actor/);
  assert.doesNotMatch(disable, /\bdelete\s+from\b/i);
});

test('only authenticated callers receive the three fixed public management RPCs', () => {
  const publicSignatures = [
    'whatsapp_internal_access_list()',
    'whatsapp_internal_access_set_phone(uuid, text)',
    'whatsapp_internal_access_disable(uuid)',
  ];
  for (const signature of publicSignatures) {
    assert.match(executable, new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, '\\$&')}[\\s\\S]*from public, anon, authenticated, service_role`));
    assert.match(executable, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, '\\$&')}[\\s\\S]*to authenticated`));
  }
  for (const signature of ['whatsapp_internal_access_require_creator()', 'whatsapp_internal_access_normalize_phone(text)']) {
    assert.match(executable, new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, '\\$&')}[\\s\\S]*from public, anon, authenticated, service_role`));
    assert.doesNotMatch(executable, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, '\\$&')}[\\s\\S]*to`));
  }
  assert.equal((executable.match(/grant execute on function/g) ?? []).length, 3);
  assert.doesNotMatch(executable, /grant execute on function[\s\S]*to service_role/);
});
