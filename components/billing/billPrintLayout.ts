/**
 * Pure helpers for the Tax Invoice print (BillPrint.tsx). Only groups and
 * formats values already stored on the bill lines — no new calculation.
 */

/** Printed before the stored bill number (print only; the saved number is unchanged). */
export const BILL_NUMBER_PRINT_PREFIX = "TEL/";

export function printedBillNumber(billNumber: string): string {
  const value = (billNumber ?? "").trim();
  if (!value) return "";
  return value.toUpperCase().startsWith(BILL_NUMBER_PRINT_PREFIX) ? value : `${BILL_NUMBER_PRINT_PREFIX}${value}`;
}

/** "65770/-" for whole rupees, "65770.50/-" otherwise. */
export function rupees(value: number): string {
  const n = Number(value) || 0;
  return `${Number.isInteger(n) ? String(n) : n.toFixed(2)}/-`;
}

/** Rate as printed: "1000" for whole numbers, "1250.50" otherwise. */
export function plainNumber(value: number): string {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export interface SummaryLineInput {
  from: string;
  to: string;
  consignor: string;
  weight: number;
  rate: number;
  freight: number;
}

export interface SummaryRow {
  from: string;
  to: string;
  consignor: string;
  rate: number;
  weight: number;
  freight: number;
  lrCount: number;
}

const key = (value: string) => (value ?? "").trim().toUpperCase();

/** One row per same From + Destination + Consignor + Rate, in first-seen order. */
export function groupBillLines(lines: SummaryLineInput[]): SummaryRow[] {
  const rows = new Map<string, SummaryRow>();
  for (const line of lines) {
    const id = [key(line.from), key(line.to), key(line.consignor), Number(line.rate) || 0].join("|");
    const row = rows.get(id);
    if (row) {
      row.weight += Number(line.weight) || 0;
      row.freight += Number(line.freight) || 0;
      row.lrCount += 1;
    } else {
      rows.set(id, {
        from: line.from ?? "",
        to: line.to ?? "",
        consignor: line.consignor ?? "",
        rate: Number(line.rate) || 0,
        weight: Number(line.weight) || 0,
        freight: Number(line.freight) || 0,
        lrCount: 1,
      });
    }
  }
  // Sums of 2-decimal values: round away float noise (e.g. 65.77000000001).
  return [...rows.values()].map((row) => ({
    ...row,
    weight: Math.round(row.weight * 1000) / 1000,
    freight: Math.round(row.freight * 100) / 100,
  }));
}
