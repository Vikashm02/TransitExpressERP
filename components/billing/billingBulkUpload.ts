import { validateBill, type Bill } from "./billing.schema";
import type { BillLineInput } from "@/components/services/billing.service";
import type { BillingPartyRecord } from "@/components/services/billingParty.service";
import type { LRRecord } from "@/components/services/lr.service";
import type { PodRecord } from "@/components/services/pod.service";
import { computeBillingLine } from "@/lib/calculations/billingCalculations";
import {
  normalizeLrBulkNumberInput,
  type LrBulkNumberFormatConfig,
} from "@/lib/historicalLrBulkNumber";

/**
 * A Bill is created against a SET of LRs (see BillDialog.tsx — a single
 * Bill can include many LRs), so a flat Excel sheet needs one row per
 * (Bill, LR) line, with a "Bill Group" column tying multiple rows
 * together into the same Bill. Rows sharing one non-blank "Bill Group"
 * value become one Bill; a Bill with only one LR is still valid (see the
 * "Sample" sheet, which shows exactly one such row/LR per the required
 * format), and it's the same shape a real multi-LR Bill grows into by
 * adding more rows with the same "Bill Group".
 *
 * "Billing Party Code" is the unique Billing Party Master identifier
 * (`billing_parties.code`). "LR Number": enter numeric portion only
 * (e.g. 19305); normalized to the company document format before LR lookup.
 * Weight/Rate/Freight are never entered — they are always computed by
 * `computeBillingLine()` from the LR's Bill Rate data (+ linked POD where
 * applicable).
 *
 * Each LR must belong to the same Billing Party as the bill: the LR's
 * stored `customer` field holds the Billing Party name set at LR Entry
 * time, so it must match the resolved party's name.
 */
export const BILLING_TEMPLATE_HEADERS = [
  "Bill Group",
  "Bill Date",
  "Billing Party Code",
  "PO Number",
  "LR Number",
] as const;

type TemplateHeader = (typeof BILLING_TEMPLATE_HEADERS)[number];

const SAMPLE_ROW: Record<TemplateHeader, string> = {
  "Bill Group": "BILL-1",
  "Bill Date": "2026-08-05",
  "Billing Party Code": "BP001",
  "PO Number": "PO-2026-001",
  "LR Number": "19305",
};

export interface BillingUploadGroup {
  /** The "Bill Group" value and every Excel row number that contributed to it. */
  billGroup: string;
  excelRows: number[];
  values: Bill;
  lines: BillLineInput[];
}

export interface BillingUploadRowError {
  excelRow: number;
  messages: string[];
}

export interface BillingUploadParseResult {
  groups: BillingUploadGroup[];
  errors: BillingUploadRowError[];
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
  sheet.columns = BILLING_TEMPLATE_HEADERS.map(() => ({ width: 20 }));

  const headerRow = sheet.getRow(1);
  BILLING_TEMPLATE_HEADERS.forEach((header, index) => {
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
export async function downloadBillingUploadTemplate(): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Transjit Express TMS";
  workbook.created = new Date();

  writeHeaderRow(workbook.addWorksheet("Upload Data"));

  const sampleSheet = workbook.addWorksheet("Sample");
  writeHeaderRow(sampleSheet);
  const sampleRow = sampleSheet.getRow(2);
  BILLING_TEMPLATE_HEADERS.forEach((header, index) => {
    sampleRow.getCell(index + 1).value = SAMPLE_ROW[header];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "billing-upload-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Reads only the "Upload Data" sheet (the "Sample" sheet is always
 * ignored), groups its rows into Bills by "Bill Group", and validates
 * every row/group against the EXISTING Billing rules:
 *  - `validateBill()` — the exact same schema the Create Bill dialog
 *    already uses.
 *  - "Billing Party Code" must match an existing unique Billing Party
 *    Master code.
 *  - "LR Number" must be an existing, not-yet-billed, billing-ready LR
 *    that belongs to that same Billing Party (LR.customer = party name).
 *  - Every row within one "Bill Group" must share the same Bill Date and
 *    Billing Party Code (a Bill has exactly one of each).
 *  - An LR Number may appear on only one row in the whole file — the
 *    database's own `bill_lrs.lr_id` UNIQUE constraint (migration 014)
 *    already guarantees an LR can belong to at most one Bill, ever.
 *
 * All-or-nothing: if any row fails, `groups` is returned empty so the
 * caller never imports a partial file.
 */
export async function parseAndValidateBillingUpload(
  file: File,
  existingBillingParties: BillingPartyRecord[],
  existingLRs: LRRecord[],
  existingPods: PodRecord[],
  lrNumberConfig: Pick<LrBulkNumberFormatConfig, "prefix" | "prefixLength">,
): Promise<BillingUploadParseResult> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.getWorksheet("Upload Data");

  if (!sheet) {
    return {
      groups: [],
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

  const missingHeaders = BILLING_TEMPLATE_HEADERS.filter((header) => !columnByHeader.has(header));

  if (missingHeaders.length > 0) {
    return {
      groups: [],
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
    billGroup: string;
    billDate: string;
    billingPartyCode: string;
    poNumber: string;
    lrNumber: string;
    messages: string[];
  }

  const parsedRows: ParsedRow[] = [];
  const rowsByLrNumber = new Map<string, number[]>();
  const lrByNumberLower = new Map(
    existingLRs.map((lr) => [lr.lrNumber.trim().toLowerCase(), lr] as const),
  );

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const rawValues = BILLING_TEMPLATE_HEADERS.map((header) => cellValue(row, header));
    const isBlankRow = rawValues.every((value) => value === "");
    if (isBlankRow) return;

    const billGroup = cellValue(row, "Bill Group");
    const billDate = cellValue(row, "Bill Date");
    const billingPartyCode = cellValue(row, "Billing Party Code");
    const poNumber = cellValue(row, "PO Number");
    const rawLrNumber = cellValue(row, "LR Number");

    const messages: string[] = [];

    if (!billGroup) messages.push("Bill Group is required.");
    if (!billDate) messages.push("Bill Date is required.");
    if (billDate && !/^\d{4}-\d{2}-\d{2}$/.test(billDate)) {
      messages.push("Bill Date must be a valid date (YYYY-MM-DD).");
    }

    const matchingBillingParty = billingPartyCode
      ? existingBillingParties.find(
          (party) =>
            party.code === billingPartyCode && party.entryStatus !== "draft",
        ) ?? null
      : null;

    if (!billingPartyCode) {
      messages.push("Billing Party Code is required.");
    } else if (!matchingBillingParty) {
      messages.push(
        `Billing Party Code "${billingPartyCode}" was not found in Billing Party Master. Please add it to Billing Party Master before uploading.`,
      );
    }

    let lrNumber = "";
    const normalized = normalizeLrBulkNumberInput(rawLrNumber, lrNumberConfig);
    if (!normalized.ok) {
      messages.push(normalized.message);
    } else {
      lrNumber = normalized.formatted;
      const matchingLR = lrByNumberLower.get(lrNumber.toLowerCase()) ?? null;

      if (!matchingLR) {
        messages.push(`LR Number "${lrNumber}" was not found in LR Entry.`);
      } else if (matchingLR.status === "Billed") {
        messages.push(`LR "${lrNumber}" has already been billed.`);
      } else {
        if (
          matchingBillingParty &&
          matchingLR.customer.trim().toLowerCase() !== matchingBillingParty.name.trim().toLowerCase()
        ) {
          messages.push(
            `LR "${lrNumber}" belongs to Billing Party "${matchingLR.customer}" and does not match Billing Party Code "${billingPartyCode}" (${matchingBillingParty.name}).`
          );
        }

        const pod = existingPods.find((record) => record.lrNumber === matchingLR.lrNumber);
        const line = computeBillingLine(matchingLR, pod);
        if (!line.ready) {
          messages.push(
            `LR "${lrNumber}" is not ready to bill yet (Bill Rate Type "Per Ton (Unloading)" with no POD Unloading Weight recorded).`
          );
        }
      }

      rowsByLrNumber.set(lrNumber, [...(rowsByLrNumber.get(lrNumber) ?? []), rowNumber]);
    }

    parsedRows.push({
      excelRow: rowNumber,
      billGroup,
      billDate,
      billingPartyCode,
      poNumber,
      lrNumber,
      messages,
    });
  });

  // An LR Number may appear on only one row in the whole file — mirrors
  // the database's own `bill_lrs.lr_id` UNIQUE constraint.
  for (const [lrNumber, rowNumbers] of rowsByLrNumber) {
    if (rowNumbers.length <= 1) continue;

    const message = `LR Number "${lrNumber}" is used by more than one row in this file (rows ${rowNumbers.join(", ")}) — an LR can only be billed once.`;
    for (const parsedRow of parsedRows) {
      if (rowNumbers.includes(parsedRow.excelRow)) parsedRow.messages.push(message);
    }
  }

  // Every row sharing one "Bill Group" must agree on Bill Date and
  // Billing Party Code — a Bill has exactly one of each.
  const rowsByGroup = new Map<string, ParsedRow[]>();
  for (const row of parsedRows) {
    if (!row.billGroup) continue;
    rowsByGroup.set(row.billGroup, [...(rowsByGroup.get(row.billGroup) ?? []), row]);
  }

  for (const [billGroup, groupRows] of rowsByGroup) {
    const distinctDates = new Set(groupRows.map((row) => row.billDate).filter(Boolean));
    const distinctPartyCodes = new Set(groupRows.map((row) => row.billingPartyCode).filter(Boolean));

    if (distinctDates.size > 1) {
      const message = `Bill Group "${billGroup}" has rows with different Bill Date values — every row in the same Bill Group must share one Bill Date.`;
      for (const row of groupRows) row.messages.push(message);
    }

    if (distinctPartyCodes.size > 1) {
      const message = `Bill Group "${billGroup}" has rows with different Billing Party Code values — every row in the same Bill Group must share one Billing Party Code.`;
      for (const row of groupRows) row.messages.push(message);
    }
  }

  const errors: BillingUploadRowError[] = parsedRows
    .filter((row) => row.messages.length > 0)
    .map((row) => ({ excelRow: row.excelRow, messages: row.messages }))
    .sort((a, b) => a.excelRow - b.excelRow);

  if (errors.length > 0) {
    return { groups: [], errors };
  }

  const groups: BillingUploadGroup[] = Array.from(rowsByGroup.entries()).map(([billGroup, groupRows]) => {
    const billingPartyCode = groupRows[0].billingPartyCode;
    const billingParty = existingBillingParties.find((party) => party.code === billingPartyCode);

    // Mirrors BillDialog's own auto-fill: PO Number defaults from the
    // selected Billing Party's own `poNumber` when the row leaves it blank.
    const poNumber = groupRows.find((row) => row.poNumber)?.poNumber ?? billingParty?.poNumber ?? "";

    const lines: BillLineInput[] = groupRows.map((row) => {
      const lr = existingLRs.find(
        (record) => record.lrNumber.trim().toLowerCase() === row.lrNumber.trim().toLowerCase(),
      )!;
      const pod = existingPods.find((record) => record.lrNumber === lr.lrNumber);
      const line = computeBillingLine(lr, pod);

      return {
        lrId: String(lr.id),
        weight: line.weight,
        rate: line.rate,
        freight: line.freight,
      };
    });

    const values: Bill = {
      billNumber: "",
      billDate: groupRows[0].billDate,
      billingPartyId: billingParty?.id ?? 0,
      poNumber,
      lrIds: lines.map((line) => line.lrId),
    };

    return {
      billGroup,
      excelRows: groupRows.map((row) => row.excelRow),
      values,
      lines,
    };
  });

  // Defensive: re-validate the assembled Bill shape with the exact same
  // `validateBill()` the Create Bill dialog uses, in case a group ends up
  // with an empty/invalid Bill after grouping.
  const groupErrors: BillingUploadRowError[] = [];
  for (const group of groups) {
    for (const message of Object.values(validateBill(group.values))) {
      if (message) groupErrors.push({ excelRow: group.excelRows[0], messages: [message] });
    }
  }

  if (groupErrors.length > 0) {
    return { groups: [], errors: groupErrors };
  }

  return { groups, errors: [] };
}
