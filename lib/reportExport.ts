import type { Border } from "exceljs";

/**
 * Shared PDF/Excel/download/share plumbing for the Reports module only.
 * Deliberately a standalone copy of the same proven technique already
 * used by `components/billing/ShareBillDialog.tsx` /
 * `components/ledger/LedgerExportDialog.tsx` (html2canvas + jsPDF
 * multi-page slicing with the same `oklch()` color-token fallback, and
 * the same `navigator.share()`-with-download-fallback flow), rather
 * than importing from those files — so this module can evolve for
 * Reports without ever touching Billing/LR/Ledger's existing,
 * already-approved export code.
 */

export function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "Report";
}

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
}

export async function shareOrDownloadFile(file: File, shareTitle: string) {
  const nav = navigator as Navigator & {
    share?: (data: ShareData) => Promise<void>;
    canShare?: (data: ShareData) => boolean;
  };

  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    await nav.share({ files: [file], title: shareTitle });
  } else {
    downloadFile(file);
  }
}

/**
 * Rasterizes `element` with html2canvas and slices the result into as
 * many A4 pages as needed with jsPDF, so a long report spans multiple
 * pages instead of being squashed onto one — identical technique to
 * ShareBillDialog.tsx / LedgerExportDialog.tsx.
 */
export async function renderElementToPdfFile(element: HTMLElement, fileName: string): Promise<File> {
  const html2canvas = (await import("html2canvas")).default;
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    // The app's global theme defines every color token via `oklch()`,
    // which html2canvas 1.4.1 can't parse. Overriding the root custom
    // properties on the *cloned* document (never the live page) with
    // plain hex equivalents keeps every derived color parseable.
    onclone: (clonedDoc) => {
      const fallbackTokens: Record<string, string> = {
        "--brand": "#14406b",
        "--brand-foreground": "#fafafa",
        "--background": "#ffffff",
        "--foreground": "#262626",
        "--card": "#ffffff",
        "--card-foreground": "#262626",
        "--popover": "#ffffff",
        "--popover-foreground": "#262626",
        "--primary": "#14406b",
        "--primary-foreground": "#fafafa",
        "--secondary": "#f5f5f5",
        "--secondary-foreground": "#262626",
        "--muted": "#f5f5f5",
        "--muted-foreground": "#737373",
        "--accent": "#f5f5f5",
        "--accent-foreground": "#262626",
        "--destructive": "#dc2626",
        "--border": "#e5e5e5",
        "--input": "#e5e5e5",
        "--ring": "#3b82f6",
        "--chart-1": "#dcdcdc",
        "--chart-2": "#8c8c8c",
        "--chart-3": "#6b6b6b",
        "--chart-4": "#545454",
        "--chart-5": "#363636",
        "--success": "#16a34a",
        "--success-foreground": "#fafafa",
        "--warning": "#d97706",
        "--warning-foreground": "#262626",
        "--info": "#2563eb",
        "--info-foreground": "#fafafa",
        "--violet": "#7c3aed",
        "--violet-foreground": "#fafafa",
        "--sidebar": "#14406b",
        "--sidebar-foreground": "#fafafa",
        "--sidebar-primary": "#fafafa",
        "--sidebar-primary-foreground": "#14406b",
        "--sidebar-accent": "#1c4f82",
        "--sidebar-accent-foreground": "#fafafa",
        "--sidebar-border": "rgba(255,255,255,0.12)",
        "--sidebar-ring": "#3b82f6",
      };

      for (const [token, value] of Object.entries(fallbackTokens)) {
        clonedDoc.documentElement.style.setProperty(token, value);
      }
    },
  });

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageHeightPx = (canvas.width * pageHeight) / pageWidth;

  let renderedPx = 0;
  let pageIndex = 0;

  while (renderedPx < canvas.height) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeightPx;

    const ctx = pageCanvas.getContext("2d");
    if (!ctx) break;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);

    const sliceHeightMm = (sliceHeightPx * pageWidth) / canvas.width;

    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pageWidth, sliceHeightMm);

    renderedPx += sliceHeightPx;
    pageIndex += 1;
  }

  const blob = pdf.output("blob");
  return new File([blob], fileName, { type: "application/pdf" });
}

export interface ReportExcelColumn<T> {
  header: string;
  width?: number;
  /** Excel number format string, e.g. '"₹"#,##0.00' — omit for text columns. */
  numFmt?: string;
  align?: "left" | "right" | "center";
  value: (row: T) => string | number;
}

export interface ReportExcelOptions<T> {
  title: string;
  /** Rendered as bold-label / plain-value rows above the table. */
  infoRows: { label: string; value: string }[];
  columns: ReportExcelColumn<T>[];
  rows: T[];
  /** One cell per column — `null` leaves that column's totals cell blank. */
  totalsRow?: (string | number | null)[];
  fileName: string;
}

const REPORT_AMOUNT_FORMAT = '"₹"#,##0.00;[Red]-"₹"#,##0.00';

export { REPORT_AMOUNT_FORMAT };

/**
 * Builds a real `.xlsx` file (via `exceljs`, dynamically imported so it
 * stays out of the initial bundle) with a title, an info block, a
 * bordered/shaded-header data table with real numeric cells, and an
 * optional bold totals row — the same structure already proven by
 * `components/ledger/LedgerExportDialog.tsx`'s Excel export, generalized
 * here so both Report pages can share it without duplicating the
 * `exceljs` plumbing a second time.
 */
export async function buildReportExcelFile<T>(options: ReportExcelOptions<T>): Promise<File> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Transjit Express TMS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Report", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 },
  });

  const columnCount = options.columns.length;

  sheet.columns = options.columns.map((column) => ({ width: column.width ?? 20 }));

  const thinBorder: Partial<Border> = { style: "thin", color: { argb: "FF999999" } };

  let rowIndex = 1;

  sheet.mergeCells(rowIndex, 1, rowIndex, columnCount);
  const titleCell = sheet.getCell(rowIndex, 1);
  titleCell.value = options.title;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center" };
  rowIndex += 2;

  for (const info of options.infoRows) {
    const row = sheet.getRow(rowIndex);
    row.getCell(1).value = info.label;
    row.getCell(1).font = { bold: true };
    sheet.mergeCells(rowIndex, 2, rowIndex, columnCount);
    row.getCell(2).value = info.value;
    rowIndex += 1;
  }

  rowIndex += 1;

  const headerRowIndex = rowIndex;
  const headerRow = sheet.getRow(headerRowIndex);
  options.columns.forEach((column, colIndex) => {
    const cell = headerRow.getCell(colIndex + 1);
    cell.value = column.header;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
  });
  rowIndex += 1;

  // Freezes everything at/above the data-table header so it stays
  // visible while scrolling through a long report.
  sheet.views = [{ state: "frozen", ySplit: headerRowIndex }];

  for (const row of options.rows) {
    const dataRow = sheet.getRow(rowIndex);

    options.columns.forEach((column, colIndex) => {
      const cell = dataRow.getCell(colIndex + 1);
      cell.value = column.value(row);
      if (column.numFmt) cell.numFmt = column.numFmt;
      cell.alignment = { horizontal: column.align ?? "left" };
      cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
    });

    rowIndex += 1;
  }

  if (options.rows.length === 0) {
    sheet.mergeCells(rowIndex, 1, rowIndex, columnCount);
    const emptyCell = sheet.getCell(rowIndex, 1);
    emptyCell.value = "No data found for the selected filters.";
    emptyCell.alignment = { horizontal: "center" };
    emptyCell.font = { italic: true, color: { argb: "FF777777" } };
    rowIndex += 1;
  }

  if (options.totalsRow) {
    const totalsRow = sheet.getRow(rowIndex);
    options.totalsRow.forEach((value, colIndex) => {
      if (value === null) return;
      const cell = totalsRow.getCell(colIndex + 1);
      cell.value = value;
      cell.font = { bold: true };
      const column = options.columns[colIndex];
      if (column?.numFmt) cell.numFmt = column.numFmt;
      cell.alignment = { horizontal: column?.align ?? "left" };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  return new File([blob], options.fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
