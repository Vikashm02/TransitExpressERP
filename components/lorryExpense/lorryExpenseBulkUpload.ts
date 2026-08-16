import { validateLorryExpense, type LorryExpense } from "./lorryExpense.schema";
import type { LRRecord } from "@/components/services/lr.service";
import type { LorryExpenseRecord } from "@/components/services/lorryExpense.service";

/**
 * The exact fields the existing Lorry Expenses form actually collects
 * (see LorryExpenseDialog.tsx). "LR Number" is this module's own existing
 * identifier for the LR relationship — the form itself never lets a user
 * type an `lrId` directly; it's always resolved from an LR selected via
 * `LRLookup` (which displays/searches by `lrNumber`), so the same
 * identifier is used here.
 */
export const LORRY_EXPENSE_TEMPLATE_HEADERS = [
  "LR Number",
  "Driver Advance",
  "Loading Charges",
  "Unloading Charges",
  "Hamali",
  "Commission",
  "Other Expense",
] as const;

type TemplateHeader = (typeof LORRY_EXPENSE_TEMPLATE_HEADERS)[number];

const SAMPLE_ROW: Record<TemplateHeader, string> = {
  "LR Number": "TRJ0001",
  "Driver Advance": "2000",
  "Loading Charges": "500",
  "Unloading Charges": "500",
  Hamali: "300",
  Commission: "200",
  "Other Expense": "0",
};

export interface LorryExpenseUploadRow {
  /** 1-based row number as it appears in the Excel sheet (row 1 is the header). */
  excelRow: number;
  values: LorryExpense;
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
  existingLorryExpenses: LorryExpenseRecord[]
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
    messages: string[];
    lrNumber: string;
  }

  const parsedRows: ParsedRow[] = [];
  const rowsByLrNumber = new Map<string, number[]>();

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const rawValues = LORRY_EXPENSE_TEMPLATE_HEADERS.map((header) => cellValue(row, header));
    const isBlankRow = rawValues.every((value) => value === "");
    if (isBlankRow) return;

    const lrNumber = cellValue(row, "LR Number");
    const rawDriverAdvance = cellValue(row, "Driver Advance");
    const rawLoadingCharges = cellValue(row, "Loading Charges");
    const rawUnloadingCharges = cellValue(row, "Unloading Charges");
    const rawHamali = cellValue(row, "Hamali");
    const rawCommission = cellValue(row, "Commission");
    const rawOtherExpense = cellValue(row, "Other Expense");

    const messages: string[] = [];

    const matchingLR = lrNumber ? existingLRs.find((lr) => lr.lrNumber === lrNumber) ?? null : null;

    if (lrNumber && !matchingLR) {
      messages.push(`LR Number "${lrNumber}" was not found in LR Entry.`);
    }

    if (matchingLR && existingLorryExpenses.some((expense) => expense.lrId === matchingLR.id)) {
      messages.push(`LR "${lrNumber}" already has a Financials record — exactly one is allowed per LR.`);
    }

    if (lrNumber) {
      rowsByLrNumber.set(lrNumber, [...(rowsByLrNumber.get(lrNumber) ?? []), rowNumber]);
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

    const driverAdvance = parseNumber(rawDriverAdvance, "Driver Advance");
    const loadingCharges = parseNumber(rawLoadingCharges, "Loading Charges");
    const unloadingCharges = parseNumber(rawUnloadingCharges, "Unloading Charges");
    const hamali = parseNumber(rawHamali, "Hamali");
    const commission = parseNumber(rawCommission, "Commission");
    const otherExpense = parseNumber(rawOtherExpense, "Other Expense");

    const candidate: LorryExpense = {
      lrId: matchingLR?.id ?? 0,
      expenseStatus: "completed",
      driverAdvance,
      driverAdvance1Date: "",
      driverAdvance2: 0,
      driverAdvance2Date: "",
      dieselAdvance: 0,
      loadingCharges,
      unloadingCharges,
      detentionCharges: 0,
      hamali,
      commission,
      otherExpense,
      brokerName: "",
      beneficiaryName: "",
      stChalan: 0,
      tdsPercentage: 0,
      otherDeduction: 0,
      finalAmountPaid: 0,
      balancePaidOn: "",
      remarks: "",
    };

    for (const message of Object.values(validateLorryExpense(candidate))) {
      if (message) messages.push(message);
    }

    parsedRows.push({ excelRow: rowNumber, values: candidate, messages, lrNumber });
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
      : parsedRows.map((row) => ({ excelRow: row.excelRow, values: row.values }));

  return { rows, errors };
}
