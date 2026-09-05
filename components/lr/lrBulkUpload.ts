import {
  validateLR,
  BILLING_PARTY_OPTIONS,
  FREIGHT_TYPE_OPTIONS,
  BOOKING_BRANCH_OPTIONS,
  type LR,
} from "./lr.schema";
import type { LrBillingPartyLookupRow } from "@/components/services/billingParty.service";
import type { LrCustomerLookupRow } from "@/components/services/customer.service";
import type { LrMaterialLookupRow } from "@/components/services/material.service";
import {
  normalizeLrBulkNumberInput,
  validateHistoricalLrCreateNumber,
  type LrBulkNumberFormatConfig,
} from "@/lib/historicalLrBulkNumber";
import {
  masterAmbiguousMessage,
  masterNotFoundMessage,
  resolveUniqueMasterByName,
} from "@/lib/bulkMasterResolve";

/**
 * Fields collected by the LR create flow (same sections as LRForm).
 * "LR Number" is required for historical bulk import (numeric portion only).
 * Deliberately excludes:
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
  "LR Number",
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
  "LR Number": "19305",
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

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    // Excel often stores whole numbers as floats (19305 → 19305 or 19305.0).
    if (Number.isInteger(value)) return String(value);
    if (Number.isInteger(Math.round(value)) && Math.abs(value - Math.round(value)) < 1e-9) {
      return String(Math.round(value));
    }
    return String(value);
  }

  if (typeof value === "object") {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") return text.trim();

    const result = (value as { result?: unknown }).result;
    if (result != null) return cellToString(result);

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
 * Master-data (deterministic name match, same as LR form masters):
 *  - "Billing Party" → Billing Party Master (finalized; name equality)
 *  - "Consignor" / "Consignee" → Customer Master (finalized; name equality)
 *  - "Material" → Material Master (material name equality)
 *  - "Booking Branch" → company DEFAULT_BRANCH_OPTIONS (form select list)
 * Ambiguous duplicate names are rejected (never fuzzy-guessed).
 * Inactive masters are allowed when the LR form lookup allows them
 * (customer/billing-party RPCs do not filter status=Active).
 *
 * Historical bulk import also requires "LR Number" (numeric portion).
 * Numbers are normalized with company prefix/padding and must be strictly
 * older than company_settings.lr_running_number and not already present.
 * This path does NOT call allocate_next_lr_number / advance the sequence.
 *
 * All-or-nothing: if any row fails, `rows` is returned empty so the
 * caller never imports a partial file.
 */
export async function parseAndValidateLRUpload(
  file: File,
  existingBillingParties: LrBillingPartyLookupRow[],
  existingMaterials: LrMaterialLookupRow[],
  existingCustomers: LrCustomerLookupRow[],
  lrNumberConfig: LrBulkNumberFormatConfig,
  existingLrNumbers: string[],
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
    formattedLrNumber: string | null;
  }

  const parsedRows: ParsedRow[] = [];
  const existingLrNumbersLower = new Set(
    existingLrNumbers.map((value) => value.trim().toLowerCase()).filter(Boolean),
  );
  const rowsByFormattedLr = new Map<string, number[]>();

  // Same eligibility as LR form lookups: finalized only (RPC already filters).
  const billingParties = existingBillingParties.filter((p) => p.entryStatus !== "draft");
  const customers = existingCustomers.filter((c) => c.entryStatus !== "draft");
  const materials = existingMaterials;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const rawValues = LR_TEMPLATE_HEADERS.map((header) => cellValue(row, header));
    const isBlankRow = rawValues.every((value) => value === "");
    if (isBlankRow) return;

    const rawLrNumber = cellValue(row, "LR Number");
    const lrDate = cellValue(row, "LR Date");
    const bookingBranchRaw = cellValue(row, "Booking Branch");
    const customerRaw = cellValue(row, "Billing Party");
    const rawBillingParty = cellValue(row, "GST Payable By");
    const consignorRaw = cellValue(row, "Consignor");
    const consignorGST = cellValue(row, "Consignor GST").toUpperCase();
    const consignorAddress = cellValue(row, "Consignor Address");
    const consigneeRaw = cellValue(row, "Consignee");
    const consigneeGST = cellValue(row, "Consignee GST").toUpperCase();
    const consigneeAddress = cellValue(row, "Consignee Address");
    const vehicleNumber = cellValue(row, "Vehicle Number").toUpperCase();
    const vehicleType = cellValue(row, "Vehicle Type");
    const transporter = cellValue(row, "Transporter");
    const driverName = cellValue(row, "Driver Name");
    const driverMobile = cellValue(row, "Driver Mobile");
    const from = cellValue(row, "From");
    const to = cellValue(row, "To");
    const materialRaw = cellValue(row, "Material");
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
    let formattedLrNumber: string | null = null;

    const normalized = normalizeLrBulkNumberInput(rawLrNumber, lrNumberConfig);
    if (!normalized.ok) {
      messages.push(normalized.message);
    } else {
      formattedLrNumber = normalized.formatted;
      const historicalError = validateHistoricalLrCreateNumber({
        numeric: normalized.numeric,
        formatted: normalized.formatted,
        runningNumber: lrNumberConfig.runningNumber,
        existingLrNumbersLower,
      });
      if (historicalError) {
        messages.push(historicalError);
      }
      const priorRows = rowsByFormattedLr.get(normalized.formatted) ?? [];
      priorRows.push(rowNumber);
      rowsByFormattedLr.set(normalized.formatted, priorRows);
    }

    if (lrDate && !/^\d{4}-\d{2}-\d{2}$/.test(lrDate)) {
      messages.push("LR Date must be a valid date (YYYY-MM-DD).");
    }

    if (dcInvoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(dcInvoiceDate)) {
      messages.push("DC Date / Invoice Date must be a valid date (YYYY-MM-DD).");
    }

    // Booking Branch — same closed list as LR form FormSelect.
    let bookingBranch = bookingBranchRaw;
    if (bookingBranchRaw) {
      const branchMatch = BOOKING_BRANCH_OPTIONS.find(
        (option) => option.toLowerCase() === bookingBranchRaw.toLowerCase(),
      );
      if (!branchMatch) {
        messages.push(
          `Booking Branch "${bookingBranchRaw}" is not a valid branch. Allowed: ${BOOKING_BRANCH_OPTIONS.join(", ")}.`,
        );
      } else {
        bookingBranch = branchMatch;
      }
    }

    // Billing Party Master → stored on LR.customer (same as LRHeader).
    let customer = customerRaw;
    if (customerRaw) {
      const resolved = resolveUniqueMasterByName(
        customerRaw,
        billingParties,
        (party) => party.name,
      );
      if (!resolved.ok) {
        messages.push(
          resolved.reason === "ambiguous"
            ? masterAmbiguousMessage("Billing Party", customerRaw, "Billing Party Master")
            : masterNotFoundMessage("Billing Party", customerRaw, "Billing Party Master"),
        );
      } else {
        customer = resolved.match.name;
      }
    }

    // Consignor / Consignee → Customer Master (same as PartySection).
    let consignor = consignorRaw;
    if (consignorRaw) {
      const resolved = resolveUniqueMasterByName(consignorRaw, customers, (c) => c.name);
      if (!resolved.ok) {
        messages.push(
          resolved.reason === "ambiguous"
            ? masterAmbiguousMessage("Consignor", consignorRaw, "Customer Master")
            : masterNotFoundMessage("Consignor", consignorRaw, "Customer Master"),
        );
      } else {
        consignor = resolved.match.name;
      }
    }

    let consignee = consigneeRaw;
    if (consigneeRaw) {
      const resolved = resolveUniqueMasterByName(consigneeRaw, customers, (c) => c.name);
      if (!resolved.ok) {
        messages.push(
          resolved.reason === "ambiguous"
            ? masterAmbiguousMessage("Consignee", consigneeRaw, "Customer Master")
            : masterNotFoundMessage("Consignee", consigneeRaw, "Customer Master"),
        );
      } else {
        consignee = resolved.match.name;
      }
    }

    // Material Master — selection-only in MaterialSection.
    let material = materialRaw;
    if (materialRaw) {
      const resolved = resolveUniqueMasterByName(
        materialRaw,
        materials,
        (item) => item.materialName,
      );
      if (!resolved.ok) {
        messages.push(
          resolved.reason === "ambiguous"
            ? masterAmbiguousMessage("Material", materialRaw, "Material Master")
            : masterNotFoundMessage("Material", materialRaw, "Material Master"),
        );
      } else {
        material = resolved.match.materialName;
      }
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
      lrNumber: formattedLrNumber ?? "",
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

    parsedRows.push({
      excelRow: rowNumber,
      values: candidate,
      messages,
      formattedLrNumber,
    });
  });

  // In-file duplicate LR numbers (after normalization).
  for (const [formatted, rowNumbers] of rowsByFormattedLr) {
    if (rowNumbers.length < 2) continue;
    const rowsLabel =
      rowNumbers.length === 2
        ? `Rows ${rowNumbers[0]} and ${rowNumbers[1]}`
        : `Rows ${rowNumbers.join(", ")}`;
    const message = `${rowsLabel}: ${formatted} is duplicated in the uploaded file.`;
    for (const excelRow of rowNumbers) {
      const target = parsedRows.find((row) => row.excelRow === excelRow);
      if (target && !target.messages.includes(message)) {
        target.messages.push(message);
      }
    }
  }

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
