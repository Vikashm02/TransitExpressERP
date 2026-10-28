/**
 * Module exports: each list page declares its export as an ordered list of
 * columns that mirrors that module's Add/Edit form (same labels, same order),
 * followed by "Created By" / "Created On" where the module stores them.
 * Rows passed in are the page's searched/filtered rows, so the file always
 * matches the screen.
 */

import { downloadCsv } from "@/lib/csvExport";

type CsvValue = string | number | null | undefined;

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

export function exportCsv<T>(fileBaseName: string, columns: ExportColumn<T>[], rows: T[]): void {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadCsv(
    `${fileBaseName}-${stamp}.csv`,
    columns.map((column) => column.header),
    rows.map((row) => columns.map((column) => column.value(row)))
  );
}

/** "2026-10-27 22:35" in India time; blank when missing or invalid. */
export function formatCreatedOn(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** Staff display name for a user id; "" when not recorded (older rows). */
export function staffNameResolver(staff: { id: string; displayName: string }[]) {
  const names = new Map(staff.map((user) => [user.id, user.displayName]));
  return (userId: string | null | undefined): string =>
    userId ? names.get(userId) ?? "Unknown user" : "";
}

/** Common trailing columns for modules that store who created the record. */
export function createdColumns<T>(
  createdBy: (row: T) => string,
  createdAt: (row: T) => string | null | undefined
): ExportColumn<T>[] {
  return [
    { header: "Created By", value: createdBy },
    { header: "Created On", value: (row) => formatCreatedOn(createdAt(row)) },
  ];
}

/** Trailing column for modules that only store when the record was created. */
export function createdOnColumn<T>(createdAt: (row: T) => string | null | undefined): ExportColumn<T> {
  return { header: "Created On", value: (row) => formatCreatedOn(createdAt(row)) };
}
