import { validatePod, type Pod } from "./pod.schema";
import type { LRRecord } from "@/components/services/lr.service";

/**
 * Fields the POD create flow collects (see PodForm.tsx). Excludes proof
 * upload (Storage) and settlement fields (now Financials-only). Settlement
 * columns are still written as defaults (0 / "") so historical DB shape
 * is preserved without exposing those fields in the template.
 */
export const POD_TEMPLATE_HEADERS = [
  "LR Number",
  "POD Date",
  "Unloading Weight",
  "Unloading Date",
] as const;

type TemplateHeader = (typeof POD_TEMPLATE_HEADERS)[number];

const SAMPLE_ROW: Record<TemplateHeader, string> = {
  "LR Number": "TRJ0001",
  "POD Date": "2026-08-05",
  "Unloading Weight": "9.8",
  "Unloading Date": "2026-08-05",
};

export interface PodUploadRow {
  /** 1-based row number as it appears in the Excel sheet (row 1 is the header). */
  excelRow: number;
  values: Pod;
}

export interface PodUploadRowError {
  excelRow: number;
  messages: string[];
}

export interface PodUploadParseResult {
  rows: PodUploadRow[];
  errors: PodUploadRowError[];
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
  sheet.columns = POD_TEMPLATE_HEADERS.map(() => ({ width: 20 }));

  const headerRow = sheet.getRow(1);
  POD_TEMPLATE_HEADERS.forEach((header, index) => {
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
export async function downloadPodUploadTemplate(): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Transjit Express TMS";
  workbook.created = new Date();

  writeHeaderRow(workbook.addWorksheet("Upload Data"));

  const sampleSheet = workbook.addWorksheet("Sample");
  writeHeaderRow(sampleSheet);
  const sampleRow = sampleSheet.getRow(2);
  POD_TEMPLATE_HEADERS.forEach((header, index) => {
    sampleRow.getCell(index + 1).value = SAMPLE_ROW[header];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pod-entry-upload-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Reads only the "Upload Data" sheet (the "Sample" sheet is always
 * ignored) and validates every row against the EXISTING POD rules:
 * `validatePod()` — the exact same schema the Add/Edit POD form already
 * uses — plus the one existing Master-only restriction the POD form
 * itself already enforces via a selection-only (read-only) input: "LR
 * Number" must be an existing LR (see PodForm.tsx / LRLookup.tsx). There
 * is no existing rule anywhere in this app limiting an LR to a single
 * POD (`pods.lr_number` has no unique constraint and `LRLookup` doesn't
 * filter out already-PODed LRs), so none is invented here either.
 *
 * All-or-nothing: if any row fails, `rows` is returned empty so the
 * caller never imports a partial file.
 */
export async function parseAndValidatePodUpload(
  file: File,
  existingLRs: LRRecord[]
): Promise<PodUploadParseResult> {
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

  const missingHeaders = POD_TEMPLATE_HEADERS.filter((header) => !columnByHeader.has(header));

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
    values: Pod;
    messages: string[];
  }

  const parsedRows: ParsedRow[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const rawValues = POD_TEMPLATE_HEADERS.map((header) => cellValue(row, header));
    const isBlankRow = rawValues.every((value) => value === "");
    if (isBlankRow) return;

    const lrNumber = cellValue(row, "LR Number");
    const podDate = cellValue(row, "POD Date");
    const rawUnloadingWeight = cellValue(row, "Unloading Weight");
    const unloadingDate = cellValue(row, "Unloading Date");

    const messages: string[] = [];

    if (lrNumber && !existingLRs.some((lr) => lr.lrNumber === lrNumber)) {
      messages.push(`LR Number "${lrNumber}" was not found in LR Entry.`);
    }

    if (podDate && !/^\d{4}-\d{2}-\d{2}$/.test(podDate)) {
      messages.push("POD Date must be a valid date (YYYY-MM-DD).");
    }

    if (unloadingDate && !/^\d{4}-\d{2}-\d{2}$/.test(unloadingDate)) {
      messages.push("Unloading Date must be a valid date (YYYY-MM-DD).");
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

    const unloadingWeight = parseNumber(rawUnloadingWeight, "Unloading Weight");

    const candidate: Pod = {
      lrNumber,
      podDate,
      unloadingWeight,
      unloadingDate,
      proofUrl: "",
      stChalan: 0,
      tdsPercentage: 0,
      otherDeduction: 0,
      balancePaidOn: "",
    };

    for (const message of Object.values(validatePod(candidate))) {
      if (message) messages.push(message);
    }

    parsedRows.push({ excelRow: rowNumber, values: candidate, messages });
  });

  const errors: PodUploadRowError[] = parsedRows
    .filter((row) => row.messages.length > 0)
    .map((row) => ({ excelRow: row.excelRow, messages: row.messages }))
    .sort((a, b) => a.excelRow - b.excelRow);

  const rows: PodUploadRow[] =
    errors.length > 0
      ? []
      : parsedRows.map((row) => ({ excelRow: row.excelRow, values: row.values }));

  return { rows, errors };
}
