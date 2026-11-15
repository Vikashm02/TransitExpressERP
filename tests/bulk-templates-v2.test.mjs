import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const headers = (file, name) => {
  const src = read(file);
  const block = src.slice(src.indexOf(`export const ${name} = [`), src.indexOf("] as const;", src.indexOf(`export const ${name} = [`)));
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};

test("Financials template covers rates and every Financials field", () => {
  const h = headers("components/lorryExpense/lorryExpenseBulkUpload.ts", "LORRY_EXPENSE_TEMPLATE_HEADERS");
  for (const col of ["LR Number", "Bill Rate Type", "Bill Rate", "Guaranteed Weight", "Lorry Hire Type", "Lorry Hire Rate",
    "Lorry Hire Guaranteed Weight", "Driver Advance 1", "Driver Advance 1 Date", "Driver Advance 2", "Driver Advance 2 Date",
    "Diesel Advance", "Detention Charges", "Broker Name", "Beneficiary Name", "ST Chalan", "TDS %", "Other Deduction",
    "Final Amount Paid", "Balance Paid On", "Expense Status", "Remarks"]) assert.ok(h.includes(col), col);
  const dialog = read("components/lorryExpense/LorryExpenseBulkUploadDialog.tsx");
  assert.ok(dialog.indexOf("updateLRFinancials(row.values.lrId, row.commercial)") < dialog.indexOf("createLorryExpense(row.values)"));
  assert.match(dialog, /updateLRFinancials\(row\.values\.lrId, row\.priorCommercial\)/);
});

test("Bill template has Bill Number; old numbers kept, running number moves past them", async () => {
  assert.ok(headers("components/billing/billingBulkUpload.ts", "BILLING_TEMPLATE_HEADERS").includes("Bill Number"));
  const { formatInvoiceNumber, invoiceNumberValue } = await import("../lib/invoiceNumber.ts");
  assert.equal(formatInvoiceNumber(2475, { prefix: "", prefixLength: 4 }), "2475");
  assert.equal(formatInvoiceNumber(75, { prefix: "", prefixLength: 4 }), "0075");
  assert.equal(invoiceNumberValue("2475", { prefix: "" }), 2475);
  assert.equal(invoiceNumberValue("TEST", { prefix: "" }), null);
  const dialog = read("components/billing/BillingBulkUploadDialog.tsx");
  assert.match(dialog, /let nextRunningNumber = Math\.max\(company\.invoiceRunningNumber \?\? 0, highestUploaded\);/);
  assert.match(dialog, /let billNumber = group\.values\.billNumber;\s+if \(!billNumber\) \{/);
});

test("LR template: Material Description, master links, and no PO Date", () => {
  const h = headers("components/lr/lrBulkUpload.ts", "LR_TEMPLATE_HEADERS");
  assert.ok(h.includes("Material Description"));
  assert.ok(!h.includes("PO Date"), "a PO Date would make the database create old POs in PO Master");
  const src = read("components/lr/lrBulkUpload.ts");
  assert.match(src, /billingPartyId = resolved\.match\.id;/);
  assert.match(src, /consignorId = resolved\.match\.id;/);
  assert.match(src, /consigneeId = resolved\.match\.id;/);
});

test("Billing Party and Vehicle templates match their forms", () => {
  assert.ok(headers("components/billingParty/billingPartyBulkUpload.ts", "BILLING_PARTY_TEMPLATE_HEADERS").includes("Vendor Code"));
  const v = headers("components/vehicle/vehicleBulkUpload.ts", "VEHICLE_TEMPLATE_HEADERS");
  for (const col of ["Transporter", "Driver Name", "Driver Mobile"]) assert.ok(v.includes(col), col);
});
