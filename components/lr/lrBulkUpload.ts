import {
  validateLR,
  BILLING_PARTY_OPTIONS,
  FREIGHT_TYPE_OPTIONS,
  type LR,
} from "./lr.schema";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import type { MaterialRecord } from "@/components/services/material.service";

/**
 * Fields collected by the LR create flow (same sections as LRForm).
 * Deliberately excludes:
 *  - "LR Number" — auto-generated at save time
 *  - "Status" — always starts as "Open"
 *  - "Unloading Weight" — POD module
 *  - Bill Amount / Lorry Hire Amount / Profit — computed at save
 *  - Bill Rate / Bill Rate Type / Guaranteed Weight / Lorry Hire Rate /
 *    Lorry Hire Type / Lorry Hire Guaranteed Weight — entered only in
 *    Financials (CommercialSection keeps Freight Type only)
 *  - Expense fields — Financials module
 * Combined DC/Invoice columns match DispatchDocumentsSection behavior.
 */
export const LR_TEMPLATE_HEADERS = [
  "LR Date",
  "Booking Branch",
  "Billing Party",
  "GST Payable By",
  "Consignor",
  "Consignor GST",
  "Consignor Address",
  "Consignee",
  "Consignee GST",
  "Consignee Address",
  "Vehicle Number",
  "Vehicle Type",
  "Transporter",
  "Driver Name",
  "Driver Mobile",
  "From",
  "To",
  "Material",
  "Package Type",
  "Packages",
  "Loading Weight",
  "Charged Weight",
  "PO Number",
  "Vendor Code",
  "DC Number / Invoice Number",
  "DC Date / Invoice Date",
  "Invoice Value",
  "E-Way Bill Number",
  "Freight Type",
  "Remarks",
  "Internal Remarks",
] as const;

type TemplateHeader = (typeof LR_TEMPLATE_HEADERS)[number];

const SAMPLE_ROW: Record<TemplateHeader, string> = {
  "LR Date": "2026-08-01",
  "Booking Branch": "Visakhapatnam",
  "Billing Party": "Sample Logistics Pvt Ltd",
  "GST Payable By": "Consignor",
  Consignor: "Sample Textiles Pvt Ltd",
  "Consignor GST": "27AAAAA0000A1Z5",
  "Consignor Address": "123, Industrial Estate, Andheri",
  Consignee: "Sample Buyer Pvt Ltd",
  "Consignee GST": "29BBBBB0000B1Z6",
  "Consignee Address": "45, MG Road, Bengaluru",
  "Vehicle Number": "MH12AB1234",
  "Vehicle Type": "Truck",
  Transporter: "Ramesh Transport Co",
  "Driver Name": "Suresh Kumar",
  "Driver Mobile": "9876543210",
  From: "Mumbai",
  To: "Bengaluru",
  Material: "TMT Steel Bars",
  "Package Type": "TON",
  Packages: "10",
  "Loading Weight": "10",
  "Charged Weight": "10",
  "PO Number": "PO-2026-001",
  "Vendor Code": "VEN-001",
  "DC Number / Invoice Number": "INV-2026-001",
  "DC Date / Invoice Date": "2026-08-01",
  "Invoice Value": "150000",
  "E-Way Bill Number": "EWB123456789012",
  "Freight Type": "To Be Billed",
  Remarks: "",
  "Internal Remarks": "",
};

export interface LRUploadRow {
  /** 1-based row number as it appears in the Excel sheet (row 1 is the header). */
  excelRow: number;
  values: LR;
}

export interface LRUploadRowError {
  excelRow: number;
  messages: string[];
}

export interface LRUploadParseResult {
  rows: LRUploadRow[];
  errors: LRUploadRowError[];
}

function cellToString(value: unknown): string {
  if (value == null) return "";

  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (typeof value === "object") {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") return text.trim();

    const result = (value as { result?: unknown }).result;
    if (result != null) return String(result).trim();

    return "";
  }

  return String(value).trim();
}

function writeHeaderRow(sheet: import("exceljs").Worksheet) {
  sheet.columns = LR_TEMPLATE_HEADERS.map(() => ({ width: 20 }));

  const headerRow = sheet.getRow(1);
  LR_TEMPLATE_HEADERS.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  });
}

/**
 * Builds and downloads the two-sheet `.xlsx` template: "Upload Data"
 * (headers only, for the user to fill in) and "Sample" (headers + one
 * realistic example row). No other sheets are added.
 */
export async function downloadLRUploadTemplate(): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Transjit Express TMS";
  workbook.created = new Date();

  writeHeaderRow(workbook.addWorksheet("Upload Data"));

  const sampleSheet = workbook.addWorksheet("Sample");
  writeHeaderRow(sampleSheet);
  const sampleRow = sampleSheet.getRow(2);
  LR_TEMPLATE_HEADERS.forEach((header, index) => {
    sampleRow.getCell(index + 1).value = SAMPLE_ROW[header];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "lr-entry-upload-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Reads only the "Upload Data" sheet (the "Sample" sheet is always
 * ignored) and validates every row against the EXISTING LR Entry rules:
 * `validateLR()` — the exact same schema the LR form already uses — plus
 * the two existing Master-only restrictions the LR form itself already
 * enforces via selection-only (read-only) inputs:
 *  - "Billing Party" must be an existing Billing Party Master name
 *    (see LRHeader.tsx — selection only, never free-typed).
 *  - "Material" must be an existing Material Master material name
 *    (see MaterialSection.tsx — selection only, never free-typed).
 * No new business rule or second validation path is invented here.
 * "LR Number" is intentionally never generated here — the caller
 * (LRBulkUploadDialog) generates/reserves it the same way LRListPage's
 * `handleSubmit` already does, immediately before each `createLR()` call.
 *
 * All-or-nothing: if any row fails, `rows` is returned empty so the
 * caller never imports a partial file.
 */
export async function parseAndValidateLRUpload(
  file: File,
  existingBillingParties: BillingPartyRecord[],
  existingMaterials: MaterialRecord[]
): Promise<LRUploadParseResult> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.getWorksheet("Upload Data");

  if (!sheet) {
    return {
      rows: [],
      errors: [
        {
          excelRow: 1,
          messages: ['Could not find an "Upload Data" sheet in this file. Please use the downloaded template.'],
        },
      ],
    };
  }

  const columnByHeader = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const header = cellToString(cell.value);
    if (header) columnByHeader.set(header, colNumber);
  });

  const missingHeaders = LR_TEMPLATE_HEADERS.filter((header) => !columnByHeader.has(header));

  if (missingHeaders.length > 0) {
    return {
      rows: [],
      errors: [
        {
          excelRow: 1,
          messages: [`Missing required column(s): ${missingHeaders.join(", ")}. Please use the downloaded template.`],
        },
      ],
    };
  }

  function cellValue(row: import("exceljs").Row, header: TemplateHeader): string {
    const colNumber = columnByHeader.get(header);
    return colNumber ? cellToString(row.getCell(colNumber).value) : "";
  }

  interface ParsedRow {
    excelRow: number;
    values: LR;
    messages: string[];
  }

  const parsedRows: ParsedRow[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const rawValues = LR_TEMPLATE_HEADERS.map((header) => cellValue(row, header));
    const isBlankRow = rawValues.every((value) => value === "");
    if (isBlankRow) return;

    const lrDate = cellValue(row, "LR Date");
    const bookingBranch = cellValue(row, "Booking Branch");
    const customer = cellValue(row, "Billing Party");
    const rawBillingParty = cellValue(row, "GST Payable By");
    const consignor = cellValue(row, "Consignor");
    const consignorGST = cellValue(row, "Consignor GST").toUpperCase();
    const consignorAddress = cellValue(row, "Consignor Address");
    const consignee = cellValue(row, "Consignee");
    const consigneeGST = cellValue(row, "Consignee GST").toUpperCase();
    const consigneeAddress = cellValue(row, "Consignee Address");
    const vehicleNumber = cellValue(row, "Vehicle Number").toUpperCase();
    const vehicleType = cellValue(row, "Vehicle Type");
    const transporter = cellValue(row, "Transporter");
    const driverName = cellValue(row, "Driver Name");
    const driverMobile = cellValue(row, "Driver Mobile");
    const from = cellValue(row, "From");
    const to = cellValue(row, "To");
    const material = cellValue(row, "Material");
    const packageType = cellValue(row, "Package Type");
    const rawPackages = cellValue(row, "Packages");
    const rawLoadingWeight = cellValue(row, "Loading Weight");
    const rawChargedWeight = cellValue(row, "Charged Weight");
    const poNumber = cellValue(row, "PO Number");
    const vendorCode = cellValue(row, "Vendor Code");
    const dcInvoiceNumber = cellValue(row, "DC Number / Invoice Number");
    const dcInvoiceDate = cellValue(row, "DC Date / Invoice Date");
    const rawInvoiceValue = cellValue(row, "Invoice Value");
    const ewayBillNumber = cellValue(row, "E-Way Bill Number");
    const rawFreightType = cellValue(row, "Freight Type");
    const remarks = cellValue(row, "Remarks");
    const internalRemarks = cellValue(row, "Internal Remarks");

    const messages: string[] = [];

    if (lrDate && !/^\d{4}-\d{2}-\d{2}$/.test(lrDate)) {
      messages.push("LR Date must be a valid date (YYYY-MM-DD).");
    }

    if (dcInvoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(dcInvoiceDate)) {
      messages.push("DC Date / Invoice Date must be a valid date (YYYY-MM-DD).");
    }

    // Billing Party — selection-only in the existing LR form (LRHeader.tsx);
    // must match an existing Billing Party Master record by name.
    if (customer && !existingBillingParties.some((party) => party.name.toLowerCase() === customer.toLowerCase())) {
      messages.push(`Billing Party "${customer}" was not found in Billing Party Master.`);
    }

    // Material — selection-only in the existing LR form (MaterialSection.tsx);
    // must match an existing Material Master record by name.
    if (material && !existingMaterials.some((item) => item.materialName.toLowerCase() === material.toLowerCase())) {
      messages.push(`Material "${material}" was not found in Material Master.`);
    }

    let billingParty: LR["billingParty"] = "Consignor";
    if (rawBillingParty) {
      const matched = BILLING_PARTY_OPTIONS.find(
        (option) => option.toLowerCase() === rawBillingParty.toLowerCase()
      );
      if (!matched) {
        messages.push(`GST Payable By must be one of: ${BILLING_PARTY_OPTIONS.join(", ")}.`);
      } else {
        billingParty = matched;
      }
    }

    // Same default the LR form itself falls back to when Company Settings
    // don't specify a default Freight Type (see LRDialog.tsx).
    let freightType: LR["freightType"] = "To Be Billed";
    if (rawFreightType) {
      const matched = FREIGHT_TYPE_OPTIONS.find(
        (option) => option.toLowerCase() === rawFreightType.toLowerCase()
      );
      if (!matched) {
        messages.push(`Freight Type must be one of: ${FREIGHT_TYPE_OPTIONS.join(", ")}.`);
      } else {
        freightType = matched;
      }
    }

    function parseNumber(raw: string, label: string): number {
      if (!raw) return 0;
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) {
        messages.push(`${label} must be a number.`);
        return 0;
      }
      return parsed;
    }

    const packages = parseNumber(rawPackages, "Packages");
    const loadingWeight = parseNumber(rawLoadingWeight, "Loading Weight");
    const chargedWeight = parseNumber(rawChargedWeight, "Charged Weight");
    const invoiceValue = parseNumber(rawInvoiceValue, "Invoice Value");

    const candidate: LR = {
      lrNumber: "",
      lrDate,
      bookingBranch,
      customer,
      billingParty,

      consignor,
      consignorGST,
      consignorAddress,

      consignee,
      consigneeGST,
      consigneeAddress,

      vehicleNumber,
      vehicleType,
      transporter,
      driverName,
      driverMobile,
      from,
      to,

      material,
      materialDescription: "",
      packageType,
      packages,
      loadingWeight,
      unloadingWeight: 0,
      chargedWeight,

      poNumber,
      vendorCode,
      dcNumber: dcInvoiceNumber,
      dcDate: dcInvoiceDate,
      invoiceNumber: dcInvoiceNumber,
      invoiceDate: dcInvoiceDate,
      invoiceValue,
      ewayBillNumber,

      // Billing / hire are Financials-only; defaults match new LR dialog.
      billRate: 0,
      billRateType: "Fixed",
      guaranteedWeight: 0,
      lorryHireRate: 0,
      lorryHireType: "Fixed",
      lorryHireGuaranteedWeight: 0,
      freightType,

      driverAdvance: 0,
      dieselAdvance: 0,
      stChallan: 0,
      loadingCharges: 0,
      unloadingCharges: 0,
      hamali: 0,
      commission: 0,
      otherExpense: 0,

      remarks,
      internalRemarks,

      status: "Open",
      entryStatus: "final",
    };

    for (const message of Object.values(validateLR(candidate))) {
      if (message) messages.push(message);
    }

    parsedRows.push({ excelRow: rowNumber, values: candidate, messages });
  });

  const errors: LRUploadRowError[] = parsedRows
    .filter((row) => row.messages.length > 0)
    .map((row) => ({ excelRow: row.excelRow, messages: row.messages }))
    .sort((a, b) => a.excelRow - b.excelRow);

  const rows: LRUploadRow[] =
    errors.length > 0
      ? []
      : parsedRows.map((row) => ({ excelRow: row.excelRow, values: row.values }));

  return { rows, errors };
}
