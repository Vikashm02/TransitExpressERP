import assert from "node:assert/strict";
import { getUserFacingError } from "../lib/errors/getUserFacingError.ts";
import { isPoNumberMissingFromMaster, poNotInMasterMessage } from "../components/lr/poMasterRequirement.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    console.error(`FAIL: ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

const FALLBACK = "Unable to save.";
const noTechnicalText = (out) => {
  assert.doesNotMatch(out, /23505|23503|23502|42501|constraint|violates|relation|PGRST|null value/i);
};

test("duplicate LR number names the field and value", () => {
  const out = getUserFacingError({
    code: "23505",
    message: 'duplicate key value violates unique constraint "lrs_lr_number_key"',
    details: "Key (lr_number)=(19370) already exists.",
  }, FALLBACK);
  assert.match(out, /^LR number "19370" already exists\./);
  assert.match(out, /Nothing was saved\./);
  noTechnicalText(out);
});

test("duplicate PO number on composite expression key", () => {
  const out = getUserFacingError({
    code: "23505",
    message: 'duplicate key value violates unique constraint "purchase_orders_party_number_key"',
    details: "Key (billing_party_id, upper(TRIM(BOTH FROM po_number)))=(23, 6200002939) already exists.",
  }, FALLBACK);
  assert.match(out, /^PO number "6200002939" already exists\./);
  noTechnicalText(out);
});

test("duplicate without details still explains", () => {
  const out = getUserFacingError({ code: "23505", message: 'duplicate key value violates unique constraint "x"' }, FALLBACK);
  assert.match(out, /already exists/);
  noTechnicalText(out);
});

test("RLS / permission denied", () => {
  const out = getUserFacingError({ code: "42501", message: 'new row violates row-level security policy for table "lrs"' }, FALLBACK);
  assert.match(out, /do not have permission/);
  noTechnicalText(out);
});

test("record in use cannot be deleted", () => {
  const out = getUserFacingError({
    code: "23503",
    message: 'update or delete on table "customers" violates foreign key constraint "lrs_consignor_id_fkey" on table "lrs"',
  }, FALLBACK);
  assert.match(out, /being used by other records/);
  noTechnicalText(out);
});

test("missing linked item", () => {
  const out = getUserFacingError({ code: "23503", message: 'insert or update on table "lrs" violates foreign key constraint "x"' }, FALLBACK);
  assert.match(out, /no longer exists/);
  noTechnicalText(out);
});

test("required field names the column", () => {
  const out = getUserFacingError({ code: "23502", message: 'null value in column "vehicle_number" of relation "lrs" violates not-null constraint' }, FALLBACK);
  assert.match(out, /^"Vehicle number" is required\./);
  noTechnicalText(out);
});

test("check constraint, format, too long", () => {
  noTechnicalText(getUserFacingError({ code: "23514", message: 'new row for relation "x" violates check constraint "y"' }, FALLBACK));
  assert.match(getUserFacingError({ code: "22P02", message: 'invalid input syntax for type numeric: "abc"' }, FALLBACK), /wrong format/);
  assert.match(getUserFacingError({ code: "22001", message: "value too long for type character varying(60)" }, FALLBACK), /too long/);
});

test("network failure", () => {
  assert.match(getUserFacingError(new TypeError("Failed to fetch"), FALLBACK), /Could not connect to the server/);
  assert.match(getUserFacingError(new TypeError("Load failed"), FALLBACK), /Could not connect to the server/);
});

test("expired session", () => {
  assert.match(getUserFacingError({ code: "PGRST301", message: "JWT expired" }, FALLBACK), /session has expired/);
});

test("record not found (PGRST116)", () => {
  const out = getUserFacingError({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, FALLBACK);
  assert.match(out, /could not be found/);
  noTechnicalText(out);
});

test("timeout and concurrent save", () => {
  assert.match(getUserFacingError({ code: "57014", message: "canceling statement due to statement timeout" }, FALLBACK), /too long to respond/);
  assert.match(getUserFacingError({ code: "40P01", message: "deadlock detected" }, FALLBACK), /same moment/);
});

test("business rule messages (P0001) pass through unchanged", () => {
  assert.equal(
    getUserFacingError({ code: "P0001", message: "Choose a finalized billing party" }, FALLBACK),
    "Choose a finalized billing party"
  );
  assert.equal(
    getUserFacingError({ code: "P0001", message: "Permission denied for this billing party" }, FALLBACK),
    "Permission denied for this billing party"
  );
});

test("PO rule: new LR with typed PO not chosen from master is blocked", () => {
  assert.equal(isPoNumberMissingFromMaster({ poNumber: "PO-1", purchaseOrderId: null }, null, true), true);
});

test("PO rule: PO chosen from master is allowed", () => {
  assert.equal(isPoNumberMissingFromMaster({ poNumber: "PO-1", purchaseOrderId: 7 }, null, true), false);
});

test("PO rule: blank PO is allowed", () => {
  assert.equal(isPoNumberMissingFromMaster({ poNumber: "  ", purchaseOrderId: null }, null, true), false);
});

test("PO rule: existing LR with unchanged unlinked PO keeps saving", () => {
  assert.equal(isPoNumberMissingFromMaster({ poNumber: "OLD-9", purchaseOrderId: null }, { poNumber: "OLD-9" }, false), false);
});

test("PO rule: existing LR changed to an unknown PO is blocked", () => {
  assert.equal(isPoNumberMissingFromMaster({ poNumber: "NEW-1", purchaseOrderId: null }, { poNumber: "OLD-9" }, false), true);
});

test("PO rule message is plain and names the PO", () => {
  const out = poNotInMasterMessage(" 6200002939 ");
  assert.match(out, /^PO number "6200002939" is not in the PO Master/);
  assert.match(out, /add this PO in PO Master first/);
});
