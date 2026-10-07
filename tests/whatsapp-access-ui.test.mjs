// Focused static/unit checks for the Staff Master WhatsApp access UI (M114 RPCs).
// Run: node --experimental-strip-types --test tests/whatsapp-access-ui.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  canChangeWhatsappAccess,
  canDisableWhatsappAccess,
  canEnableWhatsappAccess,
  canManageWhatsappAccessAsCreator,
  canSubmitWhatsappPhone,
  parseWhatsappAccessRow,
  parseWhatsappDisableResponse,
  parseWhatsappSetPhoneResponse,
  previewIndiaWhatsappPhone,
  WHATSAPP_ACCESS_STATUSES,
  WHATSAPP_ACCESS_STATUS_LABELS,
} from "../lib/whatsappAccessRules.ts";
import { createLatestRequestTracker } from "../lib/latestRequestTracker.ts";
import { isStrictWhatsappTimestamp } from "../lib/whatsappAccessRules.ts";
import { getWhatsappAccessErrorMessage } from "../lib/errors/whatsappAccessError.ts";

// Production TypeScript deliberately uses extensionless relative imports so
// Next/TypeScript and the build remain standard. Node's strip-types runner
// needs this narrowly scoped test resolver for that one TypeScript import.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "./latestRequestTracker" &&
      context.parentURL.endsWith("/lib/whatsappRequestCoordinator.ts")
    ) {
      return nextResolve("./latestRequestTracker.ts", context);
    }
    return nextResolve(specifier, context);
  },
});
const { createWhatsappRequestCoordinator } = await import("../lib/whatsappRequestCoordinator.ts");

const serviceSrc = readFileSync(
  new URL("../components/services/whatsappAccess.service.ts", import.meta.url),
  "utf8"
);
const dialogSrc = readFileSync(
  new URL("../components/staff/WhatsappAccessDialog.tsx", import.meta.url),
  "utf8"
);
const pageSrc = readFileSync(
  new URL("../components/staff/StaffListPage.tsx", import.meta.url),
  "utf8"
);

/* ---------------- Service RPC contract ---------------- */

test("service calls exactly the three public management RPCs", () => {
  for (const name of [
    "whatsapp_internal_access_list",
    "whatsapp_internal_access_set_phone",
    "whatsapp_internal_access_disable",
  ]) {
    assert.ok(serviceSrc.includes(name), `${name} referenced`);
  }
  const rpcNames = [...serviceSrc.matchAll(/\.rpc\("([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(rpcNames)].sort(),
    [
      "whatsapp_internal_access_disable",
      "whatsapp_internal_access_list",
      "whatsapp_internal_access_set_phone",
    ],
    "no other RPCs are called"
  );
});

test("service never references the two private helpers or raw link tables", () => {
  assert.doesNotMatch(serviceSrc, /\.rpc\(\s*"whatsapp_internal_access_(require_creator|normalize_phone)/);
  assert.doesNotMatch(serviceSrc, /from\(\s*"whatsapp_user_links"\s*\)/);
  assert.doesNotMatch(serviceSrc, /\.(insert|update|delete|select)\([\s\S]*whatsapp_user_links/);
});

/* ---------------- Eligible Creator predicate (FIX 1) ---------------- */

test("approved, unlocked Creator passes the management predicate", () => {
  assert.equal(
    canManageWhatsappAccessAsCreator({ role: "creator", approvalStatus: "approved", isLocked: false }),
    true
  );
});

test("locked Creator is denied", () => {
  assert.equal(
    canManageWhatsappAccessAsCreator({ role: "creator", approvalStatus: "approved", isLocked: true }),
    false
  );
});

test("unapproved Creator is denied", () => {
  for (const approvalStatus of ["pending", "rejected"]) {
    assert.equal(
      canManageWhatsappAccessAsCreator({ role: "creator", approvalStatus, isLocked: false }),
      false,
      approvalStatus
    );
  }
});

test("non-Creator is denied regardless of approval/lock", () => {
  for (const role of ["admin", "staff"]) {
    assert.equal(
      canManageWhatsappAccessAsCreator({ role, approvalStatus: "approved", isLocked: false }),
      false,
      role
    );
  }
});

test("null/undefined actor is denied", () => {
  assert.equal(canManageWhatsappAccessAsCreator(null), false);
  assert.equal(canManageWhatsappAccessAsCreator(undefined), false);
});

test("StaffListPage gates the WhatsApp RPC path on the eligible-Creator predicate", () => {
  // The loader must derive eligibility from canManageWhatsappAccessAsCreator
  // and must not call listWhatsappAccess for an ineligible actor.
  assert.match(pageSrc, /canManageWhatsappAccessAsCreator\(profile\)/);
  const ineligibleBranch = pageSrc.indexOf("if (!canManageWhatsapp) {");
  const rpcCall = pageSrc.indexOf("listWhatsappAccess()");
  assert.ok(ineligibleBranch > -1 && rpcCall > ineligibleBranch, "ineligible branch precedes RPC");
  assert.doesNotMatch(pageSrc, /if \(isCreator\) \{[\s\S]{0,200}listWhatsappAccess/);
});

/* ---------------- Latest-request-wins (FIX 2) ---------------- */

test("latest request wins; older generations are rejected", () => {
  const tracker = createLatestRequestTracker();
  const g1 = tracker.start();
  assert.equal(tracker.isLatest(g1), true);
  const g2 = tracker.start();
  assert.equal(tracker.isLatest(g2), true);
  assert.equal(tracker.isLatest(g1), false, "older generation must be stale");
  const g3 = tracker.start();
  assert.equal(tracker.isLatest(g2), false, "even newer generation wins");
  assert.equal(tracker.isLatest(g3), true);
});

test("simulated WhatsApp list race: old success cannot overwrite newer state, old failure cannot clear it", async () => {
  const tracker = createLatestRequestTracker();
  /** Simulated WhatsApp row map state. */
  let state = { rows: [] };
  const applySuccess = (generation, rows) => {
    if (!tracker.isLatest(generation)) return;
    state = { rows };
  };
  const applyFailure = (generation) => {
    if (!tracker.isLatest(generation)) return;
    state = { rows: [] };
  };

  const g1 = tracker.start();
  state = { rows: [] }; // clear at start of current fresh load
  // g1's RPC resolves late...
  const p1 = new Promise((resolve) => setTimeout(resolve, 20));
  const g2 = tracker.start();
  state = { rows: [] };
  await p1;
  applySuccess(g1, [{ id: "old" }]); // stale — must be ignored
  assert.deepEqual(state.rows, [], "old success must not restore state");
  applyFailure(g1);
  assert.deepEqual(state.rows, [], "old failure must not clear newer state");
  const p2 = new Promise((resolve) => setTimeout(resolve, 5));
  await p2;
  applySuccess(g2, [{ id: "new" }]);
  assert.deepEqual(state.rows, [{ id: "new" }], "latest success applies");
  applyFailure(g2);
  assert.deepEqual(state.rows, [], "latest failure clears state");
});

/* ---------------- Enablement rules ---------------- */

test("account_ineligible and security_override_denied can never Enable/Change", () => {
  for (const status of ["account_ineligible", "security_override_denied"]) {
    assert.equal(canEnableWhatsappAccess({ effectiveAccessStatus: status, whatsappPhoneE164: null, approvalStatus: "approved", isLocked: false }), false, `enable blocked for ${status}`);
    assert.equal(canChangeWhatsappAccess({ effectiveAccessStatus: status, whatsappPhoneE164: "+919800000001", approvalStatus: "approved", isLocked: false }), false, `change blocked for ${status}`);
  }
});

test("Enable is allowed only from not_configured/disabled for an eligible account", () => {
  assert.equal(canEnableWhatsappAccess({ effectiveAccessStatus: "not_configured", whatsappPhoneE164: null, approvalStatus: "approved", isLocked: false }), true);
  assert.equal(canEnableWhatsappAccess({ effectiveAccessStatus: "disabled", whatsappPhoneE164: null, approvalStatus: "approved", isLocked: false }), true);
  for (const status of ["enabled_no_lr_permission", "enabled_lr_only", "enabled_lr_and_pod"]) {
    assert.equal(canEnableWhatsappAccess({ effectiveAccessStatus: status, whatsappPhoneE164: "+919800000001", approvalStatus: "approved", isLocked: false }), false);
  }
  assert.equal(canEnableWhatsappAccess({ effectiveAccessStatus: "disabled", whatsappPhoneE164: null, approvalStatus: "approved", isLocked: true }), false);
  assert.equal(canEnableWhatsappAccess({ effectiveAccessStatus: "disabled", whatsappPhoneE164: null, approvalStatus: "pending", isLocked: false }), false);
});

test("Change is allowed only from enabled statuses for an eligible account", () => {
  for (const status of ["enabled_no_lr_permission", "enabled_lr_only", "enabled_lr_and_pod"]) {
    assert.equal(canChangeWhatsappAccess({ effectiveAccessStatus: status, whatsappPhoneE164: "+919800000001", approvalStatus: "approved", isLocked: false }), true, status);
  }
  assert.equal(canChangeWhatsappAccess({ effectiveAccessStatus: "not_configured", whatsappPhoneE164: null, approvalStatus: "approved", isLocked: false }), false);
  assert.equal(canChangeWhatsappAccess({ effectiveAccessStatus: "disabled", whatsappPhoneE164: null, approvalStatus: "approved", isLocked: false }), false);
});

test("Disable cleanup remains available with an active mapping even if the account became ineligible", () => {
  assert.equal(canDisableWhatsappAccess({ effectiveAccessStatus: "account_ineligible", whatsappPhoneE164: "+919800000001", approvalStatus: "rejected", isLocked: true }), true);
  assert.equal(canDisableWhatsappAccess({ effectiveAccessStatus: "enabled_lr_only", whatsappPhoneE164: "+919800000001", approvalStatus: "approved", isLocked: false }), true);
  assert.equal(canDisableWhatsappAccess({ effectiveAccessStatus: "disabled", whatsappPhoneE164: null, approvalStatus: "approved", isLocked: false }), false);
  assert.equal(canDisableWhatsappAccess({ effectiveAccessStatus: "not_configured", whatsappPhoneE164: null, approvalStatus: "approved", isLocked: false }), false);
});

/* ---------------- Status labels ---------------- */

test("all 7 backend statuses have fixed, non-revealing labels", () => {
  assert.equal(WHATSAPP_ACCESS_STATUSES.length, 7);
  for (const status of WHATSAPP_ACCESS_STATUSES) {
    assert.ok(WHATSAPP_ACCESS_STATUS_LABELS[status], status);
  }
  assert.equal(WHATSAPP_ACCESS_STATUS_LABELS.security_override_denied, "Unavailable");
  assert.equal(WHATSAPP_ACCESS_STATUS_LABELS.account_ineligible, "Account ineligible");
  assert.equal(WHATSAPP_ACCESS_STATUS_LABELS.not_configured, "Not set");
  assert.equal(WHATSAPP_ACCESS_STATUS_LABELS.disabled, "Disabled");
  assert.equal(WHATSAPP_ACCESS_STATUS_LABELS.enabled_no_lr_permission, "Enabled — no LR access");
  assert.equal(WHATSAPP_ACCESS_STATUS_LABELS.enabled_lr_only, "Enabled — LR only");
  assert.equal(WHATSAPP_ACCESS_STATUS_LABELS.enabled_lr_and_pod, "Enabled — LR + POD");
});

/* ---------------- Strict response parsing (FIX 3) ---------------- */

const VALID_ROW = {
  target_user_id: "2f6d0b54-9d2f-4f9e-9d2a-5c5f4d5f2a1b",
  display_name: "Test Staff User",
  email: "staff@example.test",
  role: "staff",
  approval_status: "approved",
  is_locked: false,
  whatsapp_phone_e164: "+919876543210",
  effective_access_status: "enabled_lr_and_pod",
  effective_lr_access: true,
  effective_pod_access: true,
  mapping_updated_at: "2026-10-01T10:00:00.000Z",
  mapping_updated_by_display_name: "Creator",
};

test("valid list row parses", () => {
  const row = parseWhatsappAccessRow(VALID_ROW);
  assert.equal(row.targetUserId, VALID_ROW.target_user_id);
  assert.equal(row.role, "staff");
  assert.equal(row.effectiveLrAccess, true);
});

test("malformed list payload is rejected (container shape)", () => {
  for (const bad of [null, undefined, 42, "row", {}, "{}", [VALID_ROW.target_user_id]]) {
    // {} is a valid object but fails on missing fields; arrays/scalars fail shape.
    assert.throws(() => parseWhatsappAccessRow(bad), /unexpected response/, JSON.stringify(bad));
  }
});

test("malformed target_user_id is rejected", () => {
  for (const id of ["not-a-uuid", "", 123, null, undefined]) {
    assert.throws(() => parseWhatsappAccessRow({ ...VALID_ROW, target_user_id: id }), /unexpected response/);
  }
});

test("malformed role is rejected", () => {
  for (const role of ["creator", "superadmin", "", 7, null, undefined]) {
    assert.throws(() => parseWhatsappAccessRow({ ...VALID_ROW, role }), /unexpected response/);
  }
});

test("malformed approval status is rejected", () => {
  for (const approval_status of ["active", "", 0, null, undefined]) {
    assert.throws(() => parseWhatsappAccessRow({ ...VALID_ROW, approval_status }), /unexpected response/);
  }
});

test("malformed booleans are rejected", () => {
  for (const patch of [
    { is_locked: "false" },
    { is_locked: 0 },
    { effective_lr_access: "true" },
    { effective_pod_access: 1 },
    { effective_lr_access: null },
  ]) {
    assert.throws(() => parseWhatsappAccessRow({ ...VALID_ROW, ...patch }), /unexpected response/);
  }
});

test("malformed/noncanonical phone is rejected", () => {
  for (const whatsapp_phone_e164 of ["9876543210", "+91 98765 43210", "+91987654321", "+9198765432100", "+14155552671", 919876543210, {}]) {
    assert.throws(() => parseWhatsappAccessRow({ ...VALID_ROW, whatsapp_phone_e164 }), /unexpected response/);
  }
  assert.doesNotThrow(() =>
    parseWhatsappAccessRow({
      ...VALID_ROW,
      whatsapp_phone_e164: null,
      mapping_updated_at: null,
      effective_access_status: "not_configured",
    })
  );
});

test("unknown effective_access_status is rejected", () => {
  for (const effective_access_status of ["enabled", "okay", "", 5, null]) {
    assert.throws(() => parseWhatsappAccessRow({ ...VALID_ROW, effective_access_status }), /unexpected response/);
  }
});

test("malformed nullable strings/timestamps are rejected", () => {
  for (const patch of [
    { display_name: 42 },
    { email: {} },
    { mapping_updated_at: 1696101600000 },
    { mapping_updated_by_display_name: ["Creator"] },
  ]) {
    assert.throws(() => parseWhatsappAccessRow({ ...VALID_ROW, ...patch }), /unexpected response/);
  }
});

test("set_phone status must be exactly enabled or unchanged", () => {
  assert.equal(
    parseWhatsappSetPhoneResponse({ status: "enabled", whatsapp_phone_e164: "+919876543210", mapping_updated_at: "2026-10-01T10:00:00.000Z" }).status,
    "enabled"
  );
  assert.equal(
    parseWhatsappSetPhoneResponse({ status: "unchanged", whatsapp_phone_e164: "+919876543210" }).status,
    "unchanged"
  );
  for (const status of ["disabled", "ERROR", "", null, undefined, "ENABLED"]) {
    assert.throws(
      () => parseWhatsappSetPhoneResponse({ status, whatsapp_phone_e164: "+919876543210" }),
      /unexpected response/
    );
  }
});

test("set_phone phone must be canonical", () => {
  for (const whatsapp_phone_e164 of ["9876543210", "+91987654321", "+14155552671", "", null, undefined]) {
    assert.throws(
      () => parseWhatsappSetPhoneResponse({ status: "enabled", whatsapp_phone_e164 }),
      /unexpected response/
    );
  }
});

test("set_phone mapping_updated_at must be string/null when present", () => {
  assert.throws(
    () => parseWhatsappSetPhoneResponse({ status: "enabled", whatsapp_phone_e164: "+919876543210", mapping_updated_at: 123 }),
    /unexpected response/
  );
});

test("set_phone disabled/extra shapes are rejected", () => {
  assert.throws(
    () => parseWhatsappSetPhoneResponse({ status: "disabled", whatsapp_phone_e164: "+919876543210" }),
    /unexpected response/
  );
});

test("disable response must be { status: 'disabled' }", () => {
  assert.doesNotThrow(() => parseWhatsappDisableResponse({ status: "disabled" }));
  for (const bad of [null, {}, { status: "enabled" }, { status: "DISABLED" }, { disabled: true }, "disabled", [{ status: "disabled" }]]) {
    assert.throws(() => parseWhatsappDisableResponse(bad), /unexpected response/);
  }
});

/* ---------------- Phone preview (FIX 4) ---------------- */

test("preview accepts the five required M114-supported input forms", () => {
  for (const accepted of [
    "9876543210",
    "919876543210",
    "+919876543210",
    "91 98765 43210",
    "91-98765-43210",
  ]) {
    assert.equal(previewIndiaWhatsappPhone(accepted), "+919876543210", accepted);
  }
});

test("preview rejects invalid, non-India, and trunk-prefixed inputs", () => {
  for (const rejected of [
    "",
    "09876543210",
    "00919876543210",
    "+91+9876543210",
    "+14155552671",
    "5876543210",
    "987654321",
    "98765432101",
    "9876543210 ext 1",
  ]) {
    assert.equal(previewIndiaWhatsappPhone(rejected), null, rejected);
  }
});

test("preview trims ASCII spaces at the edges (M114 btrim semantics)", () => {
  assert.equal(previewIndiaWhatsappPhone("  9876543210  "), "+919876543210");
  assert.equal(previewIndiaWhatsappPhone(" +919876543210  "), "+919876543210");
});

test("preview rejects leading/trailing tab (M114 btrim does not strip tabs)", () => {
  assert.equal(previewIndiaWhatsappPhone("\t9876543210"), null);
  assert.equal(previewIndiaWhatsappPhone("9876543210\t"), null);
  assert.equal(previewIndiaWhatsappPhone("\t 9876543210 \t"), null);
});

test("preview rejects leading/trailing newline", () => {
  assert.equal(previewIndiaWhatsappPhone("\n9876543210"), null);
  assert.equal(previewIndiaWhatsappPhone("9876543210\r\n"), null);
  assert.equal(previewIndiaWhatsappPhone("\n+919876543210\n"), null);
});

test("preview rejects non-breaking space", () => {
  assert.equal(previewIndiaWhatsappPhone(" 9876543210"), null);
  assert.equal(previewIndiaWhatsappPhone("9876543210 "), null);
  assert.equal(previewIndiaWhatsappPhone(" +919876543210 "), null);
});

test("preview rejects other representative Unicode whitespace", () => {
  for (const ws of [" ", " ", " ", "﻿", " "]) {
    assert.equal(previewIndiaWhatsappPhone(`${ws}9876543210${ws}`), null, JSON.stringify(ws));
  }
});

/* ---------------- Confirmation gate ---------------- */

test("submit stays disabled until the exact canonical number is confirmed", () => {
  assert.equal(canSubmitWhatsappPhone("9876543210", null), false);
  assert.equal(canSubmitWhatsappPhone("not-a-number", "+919876543210"), false);
  assert.equal(canSubmitWhatsappPhone("9876543210", "+919876543211"), false);
  assert.equal(canSubmitWhatsappPhone("9876543210", "+919876543210"), true);
  assert.equal(canSubmitWhatsappPhone("91 98765 43210", "+919876543210"), true);
});

test("dialog resets confirmation on every input change and uses the typed input on submit", () => {
  assert.match(dialogSrc, /setConfirmedCanonical\(null\);?\s*\n\s*\}\}/);
  assert.match(dialogSrc, /setWhatsappPhoneNumber\(target\.id, phoneInput\)/);
  assert.match(dialogSrc, /disabled=\{!canSubmit\}/);
  assert.match(dialogSrc, /Invalid Indian mobile number/);
  assert.doesNotMatch(dialogSrc, /whatsapp_user_links|whatsapp_internal_access_/);
});

/* ---------------- Request orchestration (FIX 1/3) ---------------- */

test("orchestration: completion inversion — first-started request stays stale", async () => {
  let eligible = true;
  const coordinator = createWhatsappRequestCoordinator(() => eligible);
  let fetches = 0;
  const list = () => {
    fetches += 1;
    return ["rows"];
  };
  // A starts first (generation 1), B starts later (generation 2).
  const genA = coordinator.beginLoad();
  const genB = coordinator.beginLoad();
  assert.ok(genB > genA);
  // B's staff fetch completes first; B may continue to the gate.
  assert.equal(coordinator.mayFetch(genB), true, "B is newest");
  // A's staff fetch completes later; A must be stale and never fetch.
  assert.equal(coordinator.isCurrent(genA), false);
  assert.equal(coordinator.mayFetch(genA), false, "A must not invoke list");
  if (coordinator.mayFetch(genA)) list();
  assert.equal(fetches, 0);
  // B is still allowed exactly once.
  if (coordinator.mayFetch(genB)) list();
  assert.equal(fetches, 1);
});

test("orchestration: eligibility loss blocks the same generation from fetching", () => {
  let eligible = true;
  const coordinator = createWhatsappRequestCoordinator(() => eligible);
  const genA = coordinator.beginLoad();
  // Profile becomes locked/unapproved/non-Creator; newer load invalidates A.
  eligible = false;
  coordinator.beginLoad();
  assert.equal(coordinator.isCurrent(genA), false, "A invalidated by newer load");
  assert.equal(coordinator.mayFetch(genA), false, "A must not invoke list");
  // Even without a newer generation, lost eligibility blocks the RPC.
  const genC = coordinator.beginLoad();
  assert.equal(coordinator.mayFetch(genC), false);
  eligible = true;
  assert.equal(coordinator.mayFetch(genC), true);
});

test("orchestration: unmount suppresses state application and future fetches", () => {
  const coordinator = createWhatsappRequestCoordinator(() => true);
  const gen = coordinator.beginLoad();
  coordinator.markUnmounted();
  assert.equal(coordinator.isCurrent(gen), false);
  assert.equal(coordinator.mayFetch(gen), false);
  assert.equal(coordinator.isMounted, false);
});

test("StaffListPage allocates the generation before its first await and gates on the coordinator", () => {
  const bodyStart = pageSrc.indexOf("const loadStaff = useCallback");
  const beginGen = pageSrc.indexOf("beginLoad()", bodyStart);
  const firstAwait = pageSrc.indexOf("await Promise.all", bodyStart);
  assert.ok(beginGen > -1 && firstAwait > -1 && beginGen < firstAwait, "generation allocated before first await");
  assert.match(pageSrc, /mayFetch\(generation\)/);
  assert.match(pageSrc, /isCurrent\(generation\)/);
  assert.match(pageSrc, /markUnmounted\(\)/);
  const fetchGate = pageSrc.indexOf("mayFetch(generation)");
  const rpcCall = pageSrc.indexOf("listWhatsappAccess()");
  assert.ok(fetchGate > -1 && rpcCall > fetchGate, "fetch gate precedes RPC call");
});

/* ---------------- Strict timestamp contract (FIX 2) ---------------- */

test("accepts legitimate Supabase/PostgREST timestamptz serializations", () => {
  for (const ok of [
    "2026-10-01T10:00:00.000Z",
    "2026-10-01T10:00:00.123456+00:00",
    "2026-10-01T10:00:00+00:00",
    "2026-10-01T10:00:00+05:30",
    "2026-10-01 10:00:00.5+00:00",
  ]) {
    assert.equal(isStrictWhatsappTimestamp(ok), true, ok);
  }
});

test("rejects malformed and impossible timestamps", () => {
  for (const bad of [
    "not-a-date",
    "2026/10/01 10:00:00",
    "2026-13-01T00:00:00Z", // month 13
    "2026-02-31T00:00:00Z", // JS Date would normalize to Mar 3
    "2026-10-01T25:00:00Z", // hour 25
    "2026-10-01T10:61:00Z", // minute 61
    "1696101600000",
    "",
    null,
    undefined,
    123,
    {},
  ]) {
    assert.equal(isStrictWhatsappTimestamp(bad), false, JSON.stringify(bad));
  }
});

test("list: malformed mapping_updated_at is rejected", () => {
  for (const bad of ["not-a-date", "2026-02-31T00:00:00Z", "1696101600000", 42, {}]) {
    assert.throws(
      () => parseWhatsappAccessRow({ ...VALID_ROW, mapping_updated_at: bad }),
      /unexpected response/,
      JSON.stringify(bad)
    );
  }
});

test("list: mapping_updated_at is coupled to the active M114 link", () => {
  // M114's list allows null when the account has no active link; a real
  // timestamp is required for an active link, and mapping_updated_by_display_name may be null.
  assert.doesNotThrow(() =>
    parseWhatsappAccessRow({ ...VALID_ROW, mapping_updated_at: null, mapping_updated_by_display_name: null, whatsapp_phone_e164: null, effective_access_status: "not_configured" })
  );
  assert.doesNotThrow(() => parseWhatsappAccessRow({ ...VALID_ROW, mapping_updated_at: "2026-10-01T10:00:00+05:30" }));
  assert.throws(
    () => parseWhatsappAccessRow({ ...VALID_ROW, mapping_updated_at: null }),
    /unexpected response/,
    "active phone requires its active-link updated_at"
  );
  assert.throws(
    () => parseWhatsappAccessRow({ ...VALID_ROW, whatsapp_phone_e164: null, mapping_updated_at: "2026-10-01T10:00:00Z" }),
    /unexpected response/,
    "no active phone cannot carry an active-link timestamp"
  );
});

test("set_phone enabled requires a strict mapping_updated_at", () => {
  for (const bad of [undefined, null, "", "not-a-date", "2026-02-31T00:00:00Z", 123]) {
    assert.throws(
      () => parseWhatsappSetPhoneResponse({ status: "enabled", whatsapp_phone_e164: "+919876543210", mapping_updated_at: bad }),
      /unexpected response/,
      JSON.stringify(bad)
    );
  }
  assert.doesNotThrow(() =>
    parseWhatsappSetPhoneResponse({ status: "enabled", whatsapp_phone_e164: "+919876543210", mapping_updated_at: "2026-10-01T10:00:00.000Z" })
  );
});

test("set_phone unchanged follows the exact M114 shape (no timestamp)", () => {
  assert.deepEqual(
    parseWhatsappSetPhoneResponse({ status: "unchanged", whatsapp_phone_e164: "+919876543210" }),
    { status: "unchanged", whatsappPhoneE164: "+919876543210", mappingUpdatedAt: null }
  );
  assert.throws(
    () => parseWhatsappSetPhoneResponse({ status: "unchanged", whatsapp_phone_e164: "+919876543210", mapping_updated_at: "2026-10-01T10:00:00Z" }),
    /unexpected response/
  );
  assert.throws(
    () => parseWhatsappSetPhoneResponse({ status: "unchanged", whatsapp_phone_e164: "+919876543210", mapping_updated_at: null }),
    /unexpected response/
  );
});

test("disable response is exactly { status: 'disabled' } — no timestamp/extras", () => {
  assert.doesNotThrow(() => parseWhatsappDisableResponse({ status: "disabled" }));
  for (const bad of [
    { status: "disabled", mapping_updated_at: "2026-10-01T10:00:00Z" },
    { status: "disabled", mapping_updated_by_display_name: "Creator" },
    { status: "disabled", target_user_id: "2f6d0b54-9d2f-4f9e-9d2a-5c5f4d5f2a1b" },
  ]) {
    assert.throws(() => parseWhatsappDisableResponse(bad), /unexpected response/, JSON.stringify(bad));
  }
});

/* ---------------- Safe error mapping (LOW 1) ---------------- */

test("unexpected PostgREST/RPC errors become generic safe text", () => {
  const fallback = "Unable to update WhatsApp access.";
  assert.equal(getWhatsappAccessErrorMessage({ message: "some raw backend string", code: "23505", details: "x" }, fallback), fallback);
  assert.equal(getWhatsappAccessErrorMessage(new Error("duplicate key value violates unique constraint"), fallback), fallback);
  assert.equal(getWhatsappAccessErrorMessage({ message: 'duplicate key value violates unique constraint "whatsapp_user_links_phone_idx"' }, fallback), fallback);
  assert.equal(getWhatsappAccessErrorMessage("PGRST301 JWT expired", fallback), fallback);
  assert.equal(getWhatsappAccessErrorMessage(null, fallback), fallback);
  assert.equal(getWhatsappAccessErrorMessage(undefined, fallback), fallback);
});

test("known safe backend errors map only to approved categories", () => {
  assert.equal(
    getWhatsappAccessErrorMessage(new Error("Invalid Indian mobile number"), "fallback"),
    "Invalid Indian mobile number. Enter a 10-digit Indian mobile number, optionally with +91."
  );
  assert.equal(
    getWhatsappAccessErrorMessage({ message: "Phone unavailable" }, "fallback"),
    "That WhatsApp number is unavailable — it may already be linked to another account."
  );
  assert.equal(
    getWhatsappAccessErrorMessage({ message: "Not permitted" }, "fallback"),
    "You do not have permission to manage this account."
  );
  assert.equal(
    getWhatsappAccessErrorMessage({ message: "Invalid target" }, "fallback"),
    "This account can no longer be managed."
  );
});

test("WhatsApp client code does not log or surface raw backend strings", () => {
  assert.doesNotMatch(dialogSrc, /console\.error/);
  assert.doesNotMatch(pageSrc, /console\.error\(whatsappError\)/);
  assert.doesNotMatch(serviceSrc, /console\.error/);
});

/* ---------------- Handler-level defense (LOW 2) ---------------- */

test("handlers recheck the same eligibility predicates used for visibility", () => {
  // Open Enable requires canEnableWhatsappAccess; Change requires
  // canChangeWhatsappAccess; Disable requires the management predicate,
  // non-self/non-Creator target, and the active-mapping signal.
  assert.match(pageSrc, /mode === "enable" \? !canEnableWhatsappAccess\(ruleInput\) : !canChangeWhatsappAccess\(ruleInput\)/);
  assert.match(pageSrc, /canManageWhatsappAccessAsCreator\(profile\)/);
  assert.match(pageSrc, /!canDisableWhatsappAccess\(whatsappRuleInput\(user\)\)/);
  const enabledRow = { effectiveAccessStatus: "not_configured", whatsappPhoneE164: null, approvalStatus: "approved", isLocked: false };
  assert.equal(canEnableWhatsappAccess(enabledRow), true);
  assert.equal(canDisableWhatsappAccess(enabledRow), false, "no active mapping → handler must refuse");
});

test("StaffListPage gates WhatsApp controls on the eligible-Creator predicate", () => {
  assert.match(pageSrc, /const canManageWhatsapp = canManageWhatsappAccessAsCreator\(profile\)/);
  // No WhatsApp UI may key off the role-only isCreator flag anymore.
  const whatsappSection = pageSrc.slice(pageSrc.indexOf("const whatsappColumn"), pageSrc.indexOf("\n  const columns"));
  assert.match(whatsappSection, /canManageWhatsapp/);
  assert.doesNotMatch(whatsappSection, /isCreator/);
});
