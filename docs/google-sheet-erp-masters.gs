/**
 * ERP masters → this Google Sheet (read-only).
 *
 * Adds an "ERP" menu with "Refresh ERP masters". Each click replaces the
 * tabs "ERP Customers" and "ERP Billing Parties" with the latest lists from
 * the ERP, so your XLOOKUPs always check against what is really in the
 * masters. It can only READ from the ERP; it never changes ERP data.
 *
 * One-time setup (Extensions → Apps Script):
 *   1. Paste this whole file into Code.gs and save.
 *   2. Project Settings → Script Properties → add
 *        ERP_MASTERS_URL   = https://qaktijgujtbardyjptbu.supabase.co/functions/v1/masters-for-sheet
 *        ERP_SHEET_TOKEN   = the same secret you saved in Supabase as MASTERS_SHEET_TOKEN
 *   3. Reload the sheet → menu ERP → Refresh ERP masters (approve the
 *      Google permission prompt the first time).
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu("ERP").addItem("Refresh ERP masters", "refreshErpMasters").addToUi();
}

function refreshErpMasters() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("ERP_MASTERS_URL");
  const token = props.getProperty("ERP_SHEET_TOKEN");
  if (!url || !token) {
    SpreadsheetApp.getUi().alert("Set ERP_MASTERS_URL and ERP_SHEET_TOKEN in Project Settings → Script Properties first.");
    return;
  }

  const res = UrlFetchApp.fetch(url, { method: "get", headers: { "x-sheet-token": token }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    SpreadsheetApp.getUi().alert("Could not refresh from the ERP (" + res.getResponseCode() + "): " + res.getContentText());
    return;
  }
  const data = JSON.parse(res.getContentText());

  writeTab_("ERP Customers",
    ["Code", "Name", "City", "GST", "Status", "Entry"],
    data.customers.map(function (c) { return [c.code, c.name, c.city, c.gst, c.status, c.entry_status]; }));
  writeTab_("ERP Billing Parties",
    ["Code", "Name", "Short Code", "City", "GST", "PO Number", "Vendor Code", "Payment Cycle (Days)", "Status", "Entry"],
    data.billingParties.map(function (b) {
      return [b.code, b.name, b.short_code, b.city, b.gst, b.po_number, b.vendor_code, b.payment_cycle_days, b.status, b.entry_status];
    }));

  SpreadsheetApp.getActive().toast(
    data.customers.length + " customers, " + data.billingParties.length + " billing parties (as of " +
      new Date(data.refreshedAt).toLocaleString() + ")", "ERP masters refreshed", 6);
}

/** Replace a tab's contents; names are written as plain text (no auto-formatting). */
function writeTab_(name, header, rows) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clearContents();
  const values = [header].concat(rows.map(function (r) { return r.map(function (v) { return v == null ? "" : String(v); }); }));
  const range = sheet.getRange(1, 1, values.length, header.length);
  range.setNumberFormat("@").setValues(values);
  sheet.getRange(1, 1, 1, header.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
}
