import {
  validateLorryExpense,
  LORRY_EXPENSE_STATUS_OPTIONS,
  LORRY_EXPENSE_TDS_PERCENTAGE_OPTIONS,
  type LorryExpense,
} from "./lorryExpense.schema";
import { BILL_RATE_TYPE_OPTIONS, LORRY_HIRE_TYPE_OPTIONS } from "@/components/lr/lr.schema";
import type { LRFinancialsCommercialPatch, LRRecord } from "@/components/services/lr.service";
import type { LorryExpenseRecord } from "@/components/services/lorryExpense.service";
import {
  normalizeLrBulkNumberInput,
  type LrBulkNumberFormatConfig,
} from "@/lib/historicalLrBulkNumber";

/**
 * Every field the Financials form collects (LorryExpenseDialog.tsx): the
 * LR's commercial fields (Bill Rate / Lorry Hire — saved on the LR through
 * update_lr_financials, exactly like the form) and the Financials record.
 * "LR Number": enter numeric portion only (e.g. 19305); normalized to the
 * company document format before LR lookup. Dates: YYYY-MM-DD.
 */
export const LORRY_EXPENSE_TEMPLATE_HEADERS = [
  "LR Number",
  "Bill Rate Type",
  "Bill Rate",
  "Guaranteed Weight",
  "Lorry Hire Type",
  "Lorry Hire Rate",
  "Lorry Hire Guaranteed Weight",
  "Driver Advance 1",
  "Driver Advance 1 Date",
  "Driver Advance 2",
  "Driver Advance 2 Date",
  "Diesel Advance",
  "Loading Charges",
  "Unloading Charges",
  "Detention Charges",
  "Hamali",
  "Commission",
  "Other Expense",
  "Broker Name",
  "Beneficiary Name",
  "ST Chalan",
  "TDS %",
  "Other Deduction",
  "Final Amount Paid",
  "Balance Paid On",
  "Expense Status",
  "Remarks",
] as const;

type TemplateHeader = (typeof LORRY_EXPENSE_TEMPLATE_HEADERS)[number];

const SAMPLE_ROW: Record<TemplateHeader, string> = {
  "LR Number": "19305",
  "Bill Rate Type": "Per Ton (Loading)",
  "Bill Rate": "1000",
  "Guaranteed Weight": "",
  "Lorry Hire Type": "Fixed",
  "Lorry Hire Rate": "28000",
  "Lorry Hire Guaranteed Weight": "",
  "Driver Advance 1": "2000",
  "Driver Advance 1 Date": "2026-08-01",
  "Driver Advance 2": "",
  "Driver Advance 2 Date": "",
  "Diesel Advance": "5000",
  "Loading Charges": "500",
  "Unloading Charges": "500",
  "Detention Charges": "",
  Hamali: "300",
  Commission: "200",
  "Other Expense": "0",
  "Broker Name": "Ramesh Transport Co",
  "Beneficiary Name": "Ramesh Kumar",
  "ST Chalan": "",
  "TDS %": "1",
  "Other Deduction": "",
  "Final Amount Paid": "",
  "Balance Paid On": "",
  "Expense Status": "completed",
  Remarks: "",
};

export interface LorryExpenseUploadRow {
  /** 1-based row number as it appears in the Excel sheet (row 1 is the header). */
  excelRow: number;
  values: LorryExpense;
  /** Bill Rate / Lorry Hire to save on the LR (update_lr_financials). */
  commercial: LRFinancialsCommercialPatch;
  /** The LR's commercial fields before this upload, to restore on rollback. */
  priorCommercial: LRFinancialsCommercialPatch;
}

export interface LorryExpenseUploadRowError {
  excelRow: number;
  messages: string[];
}

export interface LorryExpenseUploadParseResult {
  rows: LorryExpenseUploadRow[];
  errors: LorryExpenseUploadRowError[];
}

function cellToString(value: unknown): string {
  if (value == null) return "";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
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
  sheet.columns = LORRY_EXPENSE_TEMPLATE_HEADERS.map(() => ({ width: 20 }));

  const headerRow = sheet.getRow(1);
  LORRY_EXPENSE_TEMPLATE_HEADERS.forEach((header, index) => {
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
export async function downloadLorryExpenseUploadTemplate(): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Transjit Express TMS";
  workbook.created = new Date();

  writeHeaderRow(workbook.addWorksheet("Upload Data"));

  const sampleSheet = workbook.addWorksheet("Sample");
  writeHeaderRow(sampleSheet);
  const sampleRow = sampleSheet.getRow(2);
  LORRY_EXPENSE_TEMPLATE_HEADERS.forEach((header, index) => {
    sampleRow.getCell(index + 1).value = SAMPLE_ROW[header];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "lorry-expenses-upload-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Reads only the "Upload Data" sheet (the "Sample" sheet is always
 * ignored) and validates every row against the EXISTING Lorry Expenses
 * rules: `validateLorryExpense()` — the exact same schema the Add/Edit
 * form already uses — plus the module's own real uniqueness rule:
 * `lorry_expenses.lr_id` is UNIQUE (exactly one Lorry Expenses record per
 * LR — see migration 017), so an LR Number that already has a record, or
 * that appears on more than one row in the file, is rejected. No new
 * business rule is invented here.
 *
 * All-or-nothing: if any row fails, `rows` is returned empty so the
 * caller never imports a partial file.
 */
export async function parseAndValidateLorryExpenseUpload(
  file: File,
  existingLRs: LRRecord[],
  existingLorryExpenses: LorryExpenseRecord[],
  lrNumberConfig: Pick<LrBulkNumberFormatConfig, "prefix" | "prefixLength">,
): Promise<LorryExpenseUploadParseResult> {
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

  const missingHeaders = LORRY_EXPENSE_TEMPLATE_HEADERS.filter((header) => !columnByHeader.has(header));

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
    values: LorryExpense;
    commercial: LRFinancialsCommercialPatch;
    priorCommercial: LRFinancialsCommercialPatch;
    messages: string[];
    lrNumber: string;
  }

  const parsedRows: ParsedRow[] = [];
  const rowsByLrNumber = new Map<string, number[]>();
  const lrByNumberLower = new Map(
    existingLRs.map((lr) => [lr.lrNumber.trim().toLowerCase(), lr] as const),
  );

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const rawValues = LORRY_EXPENSE_TEMPLATE_HEADERS.map((header) => cellValue(row, header));
    const isBlankRow = rawValues.every((value) => value === "");
    if (isBlankRow) return;

    const rawLrNumber = cellValue(row, "LR Number");
    const messages: string[] = [];
    let lrNumber = "";
    let matchingLR: LRRecord | null = null;

    const normalized = normalizeLrBulkNumberInput(rawLrNumber, lrNumberConfig);
    if (!normalized.ok) {
      messages.push(normalized.message);
    } else {
      lrNumber = normalized.formatted;
      matchingLR = lrByNumberLower.get(lrNumber.toLowerCase()) ?? null;
      if (!matchingLR) {
        messages.push(`LR Number "${lrNumber}" was not found in LR Entry.`);
      }
      rowsByLrNumber.set(lrNumber, [...(rowsByLrNumber.get(lrNumber) ?? []), rowNumber]);
    }

    if (
      matchingLR &&
      existingLorryExpenses.some((expense) => String(expense.lrId) === String(matchingLR.id))
    ) {
      messages.push(`LR "${lrNumber}" already has a Financials record — exactly one is allowed per LR.`);
    }

    function parseNumber(header: TemplateHeader): number {
      const raw = cellValue(row, header);
      if (!raw) return 0;
      const parsed = Number(raw.replace(/,/g, ""));
      if (Number.isNaN(parsed)) {
        messages.push(`${header} must be a number.`);
        return 0;
      }
      if (parsed < 0) messages.push(`${header} cannot be negative.`);
      return parsed;
    }

    function parseDate(header: TemplateHeader): string {
      const raw = cellValue(row, header);
      if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        messages.push(`${header} must be a valid date (YYYY-MM-DD).`);
      }
      return raw;
    }

    function parseOption<T extends string>(header: TemplateHeader, options: readonly T[], fallback: T): T {
      const raw = cellValue(row, header);
      if (!raw) return fallback;
      const match = options.find((option) => option.toLowerCase() === raw.toLowerCase());
      if (!match) messages.push(`${header} must be one of: ${options.join(", ")}.`);
      return match ?? fallback;
    }

    const commercial: LRFinancialsCommercialPatch = {
      billRateType: parseOption("Bill Rate Type", BILL_RATE_TYPE_OPTIONS, "Fixed"),
      billRate: parseNumber("Bill Rate"),
      guaranteedWeight: parseNumber("Guaranteed Weight"),
      lorryHireType: parseOption("Lorry Hire Type", LORRY_HIRE_TYPE_OPTIONS, "Fixed"),
      lorryHireRate: parseNumber("Lorry Hire Rate"),
      lorryHireGuaranteedWeight: parseNumber("Lorry Hire Guaranteed Weight"),
    };
    // Same rules as update_lr_financials (and the Financials form).
    if (commercial.billRateType === "Guaranteed Weight" && commercial.guaranteedWeight <= 0) {
      messages.push("Guaranteed Weight is required when Bill Rate Type is Guaranteed Weight.");
    }
    if (commercial.lorryHireType === "Guaranteed Weight" && commercial.lorryHireGuaranteedWeight <= 0) {
      messages.push("Lorry Hire Guaranteed Weight is required when Lorry Hire Type is Guaranteed Weight.");
    }

    const tdsPercentage = parseNumber("TDS %");
    if (!(LORRY_EXPENSE_TDS_PERCENTAGE_OPTIONS as readonly number[]).includes(tdsPercentage)) {
      messages.push(`TDS % must be one of: ${LORRY_EXPENSE_TDS_PERCENTAGE_OPTIONS.join(", ")}.`);
    }

    const candidate: LorryExpense = {
      lrId: matchingLR ? String(matchingLR.id) : "",
      expenseStatus: parseOption("Expense Status", LORRY_EXPENSE_STATUS_OPTIONS, "completed"),
      entryStatus: "final",
      driverAdvance: parseNumber("Driver Advance 1"),
      driverAdvance1Date: parseDate("Driver Advance 1 Date"),
      driverAdvance2: parseNumber("Driver Advance 2"),
      driverAdvance2Date: parseDate("Driver Advance 2 Date"),
      dieselAdvance: parseNumber("Diesel Advance"),
      loadingCharges: parseNumber("Loading Charges"),
      unloadingCharges: parseNumber("Unloading Charges"),
      detentionCharges: parseNumber("Detention Charges"),
      hamali: parseNumber("Hamali"),
      commission: parseNumber("Commission"),
      otherExpense: parseNumber("Other Expense"),
      brokerName: cellValue(row, "Broker Name"),
      beneficiaryName: cellValue(row, "Beneficiary Name"),
      stChalan: parseNumber("ST Chalan"),
      tdsPercentage,
      otherDeduction: parseNumber("Other Deduction"),
      finalAmountPaid: parseNumber("Final Amount Paid"),
      balancePaidOn: parseDate("Balance Paid On"),
      remarks: cellValue(row, "Remarks"),
    };

    const priorCommercial: LRFinancialsCommercialPatch = {
      billRate: Number(matchingLR?.billRate ?? 0),
      billRateType: (matchingLR?.billRateType ?? "Fixed") as LRFinancialsCommercialPatch["billRateType"],
      guaranteedWeight: Number(matchingLR?.guaranteedWeight ?? 0),
      lorryHireRate: Number(matchingLR?.lorryHireRate ?? 0),
      lorryHireType: (matchingLR?.lorryHireType ?? "Fixed") as LRFinancialsCommercialPatch["lorryHireType"],
      lorryHireGuaranteedWeight: Number(matchingLR?.lorryHireGuaranteedWeight ?? 0),
    };

    for (const message of Object.values(validateLorryExpense(candidate))) {
      if (message) messages.push(message);
    }

    parsedRows.push({ excelRow: rowNumber, values: candidate, commercial, priorCommercial, messages, lrNumber });
  });

  // In-file duplicate LR numbers: every row sharing a non-blank LR number
  // is invalid, since only one Lorry Expenses record is allowed per LR.
  for (const [lrNumber, rowNumbers] of rowsByLrNumber) {
    if (rowNumbers.length <= 1) continue;

    const message = `LR Number "${lrNumber}" is used by more than one row in this file (rows ${rowNumbers.join(", ")}).`;
    for (const parsedRow of parsedRows) {
      if (rowNumbers.includes(parsedRow.excelRow)) parsedRow.messages.push(message);
    }
  }

  const errors: LorryExpenseUploadRowError[] = parsedRows
    .filter((row) => row.messages.length > 0)
    .map((row) => ({ excelRow: row.excelRow, messages: row.messages }))
    .sort((a, b) => a.excelRow - b.excelRow);

  const rows: LorryExpenseUploadRow[] =
    errors.length > 0
      ? []
      : parsedRows.map((row) => ({
          excelRow: row.excelRow,
          values: row.values,
          commercial: row.commercial,
          priorCommercial: row.priorCommercial,
        }));

  return { rows, errors };
}
