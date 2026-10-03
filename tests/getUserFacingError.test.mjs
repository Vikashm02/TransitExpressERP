import assert from "node:assert/strict";
import { getUserFacingError } from "../lib/errors/getUserFacingError.ts";

const getErr = getUserFacingError;

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

// 1
test("Error with snapshot message", () => {
  assert.equal(
    getErr(new Error("Selected LR party identity does not match its snapshot"), FALLBACK),
    "Selected LR party identity does not match its snapshot"
  );
});

test("Supabase Postgrest style message only, not details/hint", () => {
  assert.equal(
    getErr({ message: "Selected LR party identity does not match its snapshot", code: "P0001", details: "sensitive detail", hint: "sensitive hint" }, FALLBACK),
    "Selected LR party identity does not match its snapshot"
  );
  const out = getErr({ message: "Selected LR party identity does not match its snapshot", code: "P0001", details: "sensitive detail", hint: "sensitive hint" }, FALLBACK);
  assert.equal(out.includes("sensitive detail"), false);
  assert.equal(out.includes("sensitive hint"), false);
});

test("Select a PO for the explicitly selected Material — allowed", () => {
  assert.equal(
    getErr(new Error("Select a PO for the explicitly selected Material"), FALLBACK),
    "Select a PO for the explicitly selected Material"
  );
});

test("PO does not belong to the selected Consignor — allowed", () => {
  assert.equal(
    getErr(new Error("PO does not belong to the selected Consignor"), FALLBACK),
    "PO does not belong to the selected Consignor"
  );
});

test("nested { error: { message } }", () => {
  assert.equal(getErr({ error: { message: "Nested message" } }, FALLBACK), "Nested message");
});

test("{ error: string }", () => {
  assert.equal(getErr({ error: "Top-level error string" }, FALLBACK), "Top-level error string");
});

test("{ message: string }", () => {
  assert.equal(getErr({ message: "Direct message" }, FALLBACK), "Direct message");
});

test("{ msg: string }", () => {
  assert.equal(getErr({ msg: "Msg variant" }, FALLBACK), "Msg variant");
});

test("{ detail: string }", () => {
  assert.equal(getErr({ detail: "Detail variant" }, FALLBACK), "Detail variant");
});

test("plain string", () => {
  assert.equal(getErr("Plain string error", FALLBACK), "Plain string error");
});

test("empty message => fallback", () => {
  assert.equal(getErr(new Error(""), FALLBACK), FALLBACK);
  assert.equal(getErr({ message: "" }, FALLBACK), FALLBACK);
  assert.equal(getErr({ message: "   " }, FALLBACK), FALLBACK);
});

test("null / undefined / {} / [] => fallback", () => {
  assert.equal(getErr(null, FALLBACK), FALLBACK);
  assert.equal(getErr(undefined, FALLBACK), FALLBACK);
  assert.equal(getErr({}, FALLBACK), FALLBACK);
  assert.equal(getErr([], FALLBACK), FALLBACK);
});

test("stack trace => fallback", () => {
  assert.equal(getErr(new Error("stack trace at Object.<anonymous> (/app/file.ts:10:5)"), FALLBACK), FALLBACK);
  assert.equal(getErr("Error: something\n at Object.<anonymous> (file.js:1:1)", FALLBACK), FALLBACK);
});

test("raw SQL dump => fallback", () => {
  assert.equal(getErr("select * from lrs where id = 1; insert into lrs ...", FALLBACK), FALLBACK);
  assert.equal(getErr("SELECT id, lr_number FROM lrs WHERE ...", FALLBACK), FALLBACK);
});

test("bearer token / JWT / api key => fallback", () => {
  assert.equal(getErr("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.signature", FALLBACK), FALLBACK);
  assert.equal(getErr("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.sss", FALLBACK), FALLBACK);
  assert.equal(getErr("x-api-key: abc123", FALLBACK), FALLBACK);
  assert.equal(getErr("Authorization: Bearer abcdefghijklmnopqrstuvwx", FALLBACK), FALLBACK);
});

test("overly long dump => fallback or truncated", () => {
  const long = "a".repeat(2000) + " { \"code\": \"xxx\", \"details\": \"...\" }";
  const out = getErr(long, FALLBACK);
  // Either fallback or bounded truncated — but must not return the raw 2000 chars
  assert.equal(out.length <= 500 || out === FALLBACK, true);
});

test("normalizes multiline/whitespace", () => {
  assert.equal(getErr(new Error("Selected  LR  \n  party\tidentity"), FALLBACK), "Selected LR party identity");
});

test("legitimate business messages with Select/update words are not blocked", () => {
  assert.equal(getErr(new Error("Please update the billing party before saving"), FALLBACK), "Please update the billing party before saving");
  assert.equal(getErr(new Error("A POD already exists for LR 123"), FALLBACK), "A POD already exists for LR 123");
  assert.equal(getErr(new Error("Billing party must be finalized before selecting a PO"), FALLBACK), "Billing party must be finalized before selecting a PO");
});

test("HTML content => fallback", () => {
  assert.equal(getErr(new Error("<script>alert('xss')</script>"), FALLBACK), FALLBACK);
  assert.equal(getErr({ message: "<div>hello</div> world" }, FALLBACK), FALLBACK);
  assert.equal(getErr("<p>Paragraph</p>", FALLBACK), FALLBACK);
});

test("credential URL with user:pass@host => fallback", () => {
  assert.equal(getErr(new Error("https://user:pass@example.com/path"), FALLBACK), FALLBACK);
  assert.equal(getErr("postgres://admin:secret123@db.example.com:5432/db", FALLBACK), FALLBACK);
  assert.equal(getErr({ message: "https://api.example.com?token=abc user:secret@host" }, FALLBACK), FALLBACK);
});

test("pg_ internal prefix => fallback", () => {
  assert.equal(getErr(new Error("pg_stat_activity error"), FALLBACK), FALLBACK);
});

if (process.exitCode) {
  console.error("\nSome tests FAILED");
} else {
  console.log("\nAll getUserFacingError tests PASSED");
}
