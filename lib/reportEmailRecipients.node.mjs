/**
 * Report email recipient list helpers.
 * Run: node --experimental-strip-types lib/reportEmailRecipients.node.mjs
 */

import assert from "node:assert/strict";
import {
  buildResendToPayload,
  coerceReportEmailList,
  formatReportRecipientsForAudit,
  normalizeReportEmails,
} from "./reportEmailRecipients.ts";

function main() {
  // a) one recipient
  const one = normalizeReportEmails(["ops@example.com"]);
  assert.equal(one.ok, true);
  if (one.ok) {
    assert.deepEqual(one.emails, ["ops@example.com"]);
  }

  // b) two recipients
  const two = normalizeReportEmails([
    "haridwar@transjitexpress.com",
    "transjitexpress@gmail.com",
  ]);
  assert.equal(two.ok, true);
  if (two.ok) {
    assert.deepEqual(two.emails, [
      "haridwar@transjitexpress.com",
      "transjitexpress@gmail.com",
    ]);
  }

  // c) duplicate recipient rejection (case-insensitive after normalize)
  const dup = normalizeReportEmails(["a@b.com", " A@B.com "]);
  assert.equal(dup.ok, false);
  if (!dup.ok) {
    assert.match(dup.error, /Duplicate/i);
  }

  // d) invalid recipient rejection
  const bad = normalizeReportEmails(["not-an-email"]);
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.match(bad.error, /Invalid/i);
  }

  const emptyItem = normalizeReportEmails(["ops@example.com", "   "]);
  assert.equal(emptyItem.ok, false);
  if (!emptyItem.ok) {
    assert.match(emptyItem.error, /empty/i);
  }

  const none = normalizeReportEmails([]);
  assert.equal(none.ok, false);
  if (!none.ok) {
    assert.match(none.error, /At least one/i);
  }

  // e) whitespace trimming
  const trimmed = normalizeReportEmails(["  ops@example.com  ", "\tother@example.com\n"]);
  assert.equal(trimmed.ok, true);
  if (trimmed.ok) {
    assert.deepEqual(trimmed.emails, ["ops@example.com", "other@example.com"]);
  }

  // f) Resend payload contains both recipients
  assert.ok(two.ok);
  if (two.ok) {
    const resendTo = buildResendToPayload(two.emails);
    assert.deepEqual(resendTo, [
      "haridwar@transjitexpress.com",
      "transjitexpress@gmail.com",
    ]);
    assert.equal(resendTo.length, 2);

    const audit = formatReportRecipientsForAudit(two.emails);
    assert.equal(
      audit,
      "haridwar@transjitexpress.com, transjitexpress@gmail.com",
    );
  }

  // coerce load path (empty ok; legacy string ok)
  assert.deepEqual(coerceReportEmailList([]), []);
  assert.deepEqual(coerceReportEmailList("solo@example.com"), ["solo@example.com"]);
  assert.deepEqual(coerceReportEmailList([" a@b.com ", ""]), ["a@b.com"]);

  console.log("reportEmailRecipients.node.mjs: all assertions passed");
}

main();
