/**
 * Download a CSV built from exactly the rows the caller passes — list pages
 * pass their already searched/filtered rows, so the file matches the screen.
 *
 * - UTF-8 with BOM so Excel shows names and ₹ correctly
 * - cells that start with = + - @ are prefixed with ' so Excel never runs
 *   them as formulas (CSV injection)
 */

type CsvValue = string | number | null | undefined;

function csvCell(value: CsvValue): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(fileName: string, headers: string[], rows: CsvValue[][]): void {
  const blob = new Blob(["﻿" + buildCsv(headers, rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
