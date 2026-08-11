import { validateCreditNote, type CreditNote } from "./creditNote.schema";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import { GST_PERCENTAGE_OPTIONS, formatGstOption } from "@/lib/gstOptions";

/**
 * The exact Credit Note fields a user fills in on CreditNoteDialog.tsx —
 * "Credit Note Number" is intentionally excluded because it's never
 * typed anywhere in this app; it's always auto-generated at save time
 * from the selected Billing Party's Short Code
 * (`generateCreditNoteNumber()` in creditNote.service.ts), exactly the
 * same rule this upload reuses row-by-row below.
 *
 * "Billing Party Code" is the unique Billing Party Master identifier
 * (`billing_parties.code`) — never the non-unique name.
 */
export const CREDIT_NOTE_TEMPLATE_HEADERS = [
  "Date",
  "Billing Party Code",
  "Total Amount Received",
  "Discount/Deduction",
  "GST %",
  "Remarks",
] as const;

type TemplateHeader = (typeof CREDIT_NOTE_TEMPLATE_HEADERS)[number];

const SAMPLE_ROW: Record<TemplateHeader, string> = {
  Date: "2026-08-05",
  "Billing Party Code": "BP001",
  "Total Amount Received": "45000",
  "Discount/Deduction": "1500",
  "GST %": "0",
  Remarks: "Against Bill dated 01-Aug-2026",
};

export interface CreditNoteUploadRow {
  /** 1-based row number as it appears in the Excel sheet (row 1 is the header). */
  excelRow: number;
  values: CreditNote;
}

export interface CreditNoteUploadRowError {
  excelRow: number;
  messages: string[];
}

export interface CreditNoteUploadParseResult {
  rows: CreditNoteUploadRow[];
  errors: CreditNoteUploadRowError[];
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
  sheet.columns = CREDIT_NOTE_TEMPLATE_HEADERS.map(() => ({ width: 22 }));

  const headerRow = sheet.getRow(1);
  CREDIT_NOTE_TEMPLATE_HEADERS.forEach((header, index) => {
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
export async function downloadCreditNoteUploadTemplate(): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Transjit Express TMS";
  workbook.created = new Date();

  writeHeaderRow(workbook.addWorksheet("Upload Data"));

  const sampleSheet = workbook.addWorksheet("Sample");
  writeHeaderRow(sampleSheet);
  const sampleRow = sampleSheet.getRow(2);
  CREDIT_NOTE_TEMPLATE_HEADERS.forEach((header, index) => {
    sampleRow.getCell(index + 1).value = SAMPLE_ROW[header];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "credit-note-upload-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Reads only the "Upload Data" sheet (the "Sample" sheet is always
 * ignored) and validates every row against the EXISTING Credit Note
 * rules:
 *  - `validateCreditNote()` — the exact same schema CreditNoteDialog.tsx
 *    already uses (including its `deduction <= amount` refinement).
 *  - "Billing Party Code" must match an existing unique Billing Party
 *    Master code.
 *  - "GST %" must be one of the fixed options CreditNoteDialog.tsx's own
 *    dropdown already offers (0/5/12/18/28) — no free-typed GST value is
 *    ever possible through the existing form, so none is accepted here
 *    either.
 * No new business rule, duplicate-check, or second validation path is
 * invented here — Credit Note has no existing uniqueness rule beyond
 * the auto-generated number itself, which this upload never lets the
 * user set.
 *
 * All-or-nothing: if any row fails, `rows` is returned empty so the
 * caller never imports a partial file.
 */
export async function parseAndValidateCreditNoteUpload(
  file: File,
  existingBillingParties: BillingPartyRecord[]
): Promise<CreditNoteUploadParseResult> {
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

  const missingHeaders = CREDIT_NOTE_TEMPLATE_HEADERS.filter((header) => !columnByHeader.has(header));

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
    values: CreditNote;
    messages: string[];
  }

  const parsedRows: ParsedRow[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const rawValues = CREDIT_NOTE_TEMPLATE_HEADERS.map((header) => cellValue(row, header));
    const isBlankRow = rawValues.every((value) => value === "");
    if (isBlankRow) return;

    const noteDate = cellValue(row, "Date");
    const billingPartyCode = cellValue(row, "Billing Party Code");
    const amountRaw = cellValue(row, "Total Amount Received");
    const deductionRaw = cellValue(row, "Discount/Deduction");
    const gstRaw = cellValue(row, "GST %");
    const remarks = cellValue(row, "Remarks");

    const messages: string[] = [];

    const matchingBillingParty = billingPartyCode
      ? existingBillingParties.find((party) => party.code === billingPartyCode) ?? null
      : null;

    if (!billingPartyCode) {
      messages.push("Billing Party Code is required.");
    } else if (!matchingBillingParty) {
      messages.push(`Billing Party Code "${billingPartyCode}" was not found in Billing Party Master.`);
    }

    const amount = amountRaw === "" ? NaN : Number(amountRaw);
    if (amountRaw === "") {
      messages.push("Total Amount Received is required.");
    } else if (Number.isNaN(amount)) {
      messages.push("Total Amount Received must be a number.");
    }

    // Same default the Create Credit Note form already uses when the field is left blank.
    const deduction = deductionRaw === "" ? 0 : Number(deductionRaw);
    if (deductionRaw !== "" && Number.isNaN(deduction)) {
      messages.push("Discount/Deduction must be a number.");
    }

    // Same default the Create Credit Note form already uses (NIL/0%).
    let gstPercentage = 0;
    if (gstRaw !== "") {
      const parsedGst = Number(gstRaw);
      const matchedGst = GST_PERCENTAGE_OPTIONS.find((option) => option === parsedGst);
      if (matchedGst === undefined) {
        messages.push(`GST % must be one of: ${GST_PERCENTAGE_OPTIONS.map((option) => formatGstOption(option)).join(", ")}.`);
      } else {
        gstPercentage = matchedGst;
      }
    }

    const candidate: CreditNote = {
      creditNoteNumber: "",
      noteDate,
      billingPartyId: matchingBillingParty?.id ?? 0,
      amount: Number.isNaN(amount) ? 0 : amount,
      deduction: Number.isNaN(deduction) ? 0 : deduction,
      gstPercentage,
      remarks,
    };

    // Only run the shared schema check once the row's own basic checks
    // above are clean — otherwise a missing Billing Party would also
    // surface as a confusing "billingPartyId" schema error alongside the
    // clearer message already pushed for it.
    if (matchingBillingParty && !Number.isNaN(amount)) {
      for (const message of Object.values(validateCreditNote(candidate))) {
        if (message) messages.push(message);
      }
    }

    parsedRows.push({ excelRow: rowNumber, values: candidate, messages });
  });

  const errors: CreditNoteUploadRowError[] = parsedRows
    .filter((row) => row.messages.length > 0)
    .map((row) => ({ excelRow: row.excelRow, messages: row.messages }))
    .sort((a, b) => a.excelRow - b.excelRow);

  const rows: CreditNoteUploadRow[] =
    errors.length > 0
      ? []
      : parsedRows.map((row) => ({ excelRow: row.excelRow, values: row.values }));

  return { rows, errors };
}
