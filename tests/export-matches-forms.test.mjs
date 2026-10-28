import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Every field label on a module's Add/Edit form must appear as an export
// column header, so exports stay in step when forms change.
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const labelsOf = (src) =>
  [...src.matchAll(/label=(?:"([^"]+)"|\{"([^"]+)"\})/g)].map((m) => m[1] ?? m[2]);

const MODULES = [
  { name: "Customers", forms: ["components/customer/CustomerForm.tsx"], page: "components/customer/CustomerListPage.tsx" },
  { name: "Billing Parties", forms: ["components/billingParty/BillingPartyForm.tsx"], page: "components/billingParty/BillingPartyListPage.tsx" },
  { name: "Materials", forms: ["components/material/MaterialForm.tsx"], page: "components/material/MaterialListPage.tsx" },
  { name: "Drivers", forms: ["components/driver/DriverForm.tsx"], page: "components/driver/DriverListPage.tsx", alias: { Photo: "Photo (link)" } },
  { name: "Transporters", forms: ["components/transporter/TransporterForm.tsx"], page: "components/transporter/TransporterListPage.tsx" },
  { name: "Vehicles", forms: ["components/vehicle/VehicleForm.tsx"], page: "components/vehicle/VehicleListPage.tsx" },
  { name: "POD", forms: ["components/pod/PodForm.tsx"], page: "components/pod/PodListPage.tsx",
    alias: { "Proof of POD": "Proof of POD (link)" }, skip: ["POD proof upload area"] },
  { name: "ASN", forms: ["components/asn/AsnDialog.tsx"], page: "components/asn/AsnListPage.tsx",
    alias: { "Weightment Slip": "Weightment Slip (link)", "Challan Copy Slip": "Challan Copy Slip (link)", "LR Copy Slip": "LR Copy Slip (link)" } },
  { name: "Credit Notes", forms: ["components/creditNote/CreditNoteDialog.tsx"], page: "components/creditNote/CreditNoteListPage.tsx", alias: { GST: "GST (%)" } },
  { name: "Debit Notes", forms: ["components/debitNote/DebitNoteDialog.tsx"], page: "components/debitNote/DebitNoteListPage.tsx", alias: { GST: "GST (%)" } },
  { name: "Delivery Challans", forms: ["components/deliveryChallan/DeliveryChallanDialog.tsx"], page: "components/deliveryChallan/DeliveryChallanListPage.tsx" },
  { name: "Bills", forms: ["components/billing/BillDialog.tsx"], page: "components/billing/BillingListPage.tsx", alias: { "Next Bill Number": "Bill Number" } },
  { name: "PO Master", forms: ["components/purchaseOrder/PurchaseOrderListPage.tsx"], page: "components/purchaseOrder/PurchaseOrderListPage.tsx" },
  { name: "Financials", forms: ["components/lorryExpense/LorryExpenseDialog.tsx"], page: "components/lorryExpense/LorryExpenseListPage.tsx", alias: { TDS: "TDS (%)" } },
  { name: "Bids", forms: ["components/bid/BidForm.tsx"], page: "components/bid/BidListPage.tsx",
    // Calculated read-only figures on the form are not stored data.
    skip: ["Effective Market Vehicle Cost", "Derived Market Cost / MT", "Expected Load / Vehicle", "Market Cost / MT",
      "Equivalent Bid Rate / MT", "Revenue / Vehicle", "Expected Profit / Vehicle", "Expected Profit / MT", "Margin %",
      "Total Bid Quantity", "Estimated Loads", "Approx. Vehicles Required", "Estimated Total Revenue",
      "Estimated Total Market Cost", "Estimated Total Gross Profit", "Equivalent Winning ₹ / MT"] },
  { name: "LR", page: "components/lr/LRListPage.tsx",
    forms: ["components/lr/sections/LRHeader.tsx", "components/lr/sections/VehicleSection.tsx", "components/lr/sections/MaterialSection.tsx",
      "components/lr/sections/DispatchDocumentsSection.tsx", "components/lr/sections/CommercialSection.tsx", "components/lr/sections/RemarksSection.tsx"],
    skip: ["Search recommended descriptions"] },
];

for (const mod of MODULES) {
  test(`${mod.name}: export has every form field`, () => {
    const page = read(mod.page);
    const missing = [];
    for (const form of mod.forms) {
      for (const label of labelsOf(read(form))) {
        if (mod.skip?.includes(label)) continue;
        const header = mod.alias?.[label] ?? label;
        if (!page.includes(`header: "${header}"`)) missing.push(label);
      }
    }
    assert.deepEqual([...new Set(missing)], [], `${mod.name} export is missing form fields`);
  });
}

test("LR export includes PO, parties' addresses and created by/on", () => {
  const page = read("components/lr/LRListPage.tsx");
  for (const h of ["PO Number", "PO Date", "Consignor Address", "Consignee Address", "Material Description", "E-Way Bill Number"]) {
    assert.ok(page.includes(`header: "${h}"`), h);
  }
  assert.match(page, /createdColumns<LRRecord>/);
});

test("modules that store the creator export Created By; others export Created On", () => {
  for (const p of ["components/lr/LRListPage.tsx", "components/pod/PodListPage.tsx", "components/deliveryChallan/DeliveryChallanListPage.tsx",
    "components/asn/AsnListPage.tsx", "components/bid/BidListPage.tsx"]) {
    assert.match(read(p), /createdColumns</, p);
  }
  for (const p of ["components/customer/CustomerListPage.tsx", "components/vehicle/VehicleListPage.tsx", "components/billing/BillingListPage.tsx",
    "components/lorryExpense/LorryExpenseListPage.tsx", "components/creditNote/CreditNoteListPage.tsx"]) {
    assert.match(read(p), /createdOnColumn/, p);
  }
});
