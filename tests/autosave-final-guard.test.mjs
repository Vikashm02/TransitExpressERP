import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

// Opening Edit on an existing FINAL record must never autosave it as a draft
// (it happened to customer C075 on 14 Nov 2026). Same rule as the LR form.
test("Customer, Billing Party and Financials autosave only new records or drafts", () => {
  const cases = [
    ["components/customer/CustomerListPage.tsx", "editingCustomer"],
    ["components/billingParty/BillingPartyListPage.tsx", "editingBillingParty"],
    ["components/lorryExpense/LorryExpenseListPage.tsx", "editingExpense"],
  ];
  for (const [file, editing] of cases) {
    const src = read(file);
    const guard = new RegExp(`onAutosave=\\{\\s*canContinueDraft && \\(!${editing} \\|\\| isDraftEntry\\(${editing}\\.entryStatus\\)\\)\\s*\\? handleAutosave\\s*: undefined\\s*\\}`);
    assert.match(src, guard, file);
    assert.doesNotMatch(src, /onAutosave=\{canContinueDraft \? handleAutosave : undefined\}/, file);
  }
  assert.match(read("components/lr/LRListPage.tsx"), /dialogMode === "create" \|\| isDraftEntry\(editingLR\?\.entryStatus\)/);
});
