"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseISO } from "date-fns";
import { toast } from "sonner";
import type { Border } from "exceljs";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import LedgerStatementView from "./LedgerStatementView";
import type { LedgerStatement } from "@/components/services/ledger.service";
import type { CompanyRecord } from "@/components/services/company.service";

type ExportFormat = "pdf" | "excel";

interface LedgerExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "download" always saves a file; "share" tries native Web Share
   * first and falls back to download, mirroring
   * components/billing/ShareBillDialog.tsx. */
  variant: "download" | "share";
  statement: LedgerStatement | null;
  company: CompanyRecord | null;
  /** Current on-screen values (may differ from Billing Party Master —
   * see LedgerPage.tsx) — exported exactly as displayed, never
   * re-fetched from the Master. */
  address: string;
  email: string;
  contactNumber: string;
}

/**
 * Downloads/shares the currently-displayed Ledger statement as a PDF.
 * Reuses the exact proven pipeline from
 * components/billing/ShareBillDialog.tsx: `LedgerStatementView` is
 * rendered off-screen (via `createPortal`) and rasterized with
 * html2canvas (same `onclone` oklch-color-fallback fix), then the tall
 * canvas is sliced into one A4 page per page-height with jsPDF so a
 * long ledger spans multiple pages instead of being squashed onto one.
 * There is no second/competing Ledger design anywhere in this file.
 *
 * Excel (.xlsx) is built with `exceljs` from the same `statement` /
 * `address` / `email` / `contactNumber` props — a real spreadsheet
 * (numeric Debit/Credit/Balance cells, real dates), not an image, and
 * not a second copy of the Ledger's accounting logic: every value is
 * read straight off the `LedgerStatement` already computed by
 * `ledger.service.ts`.
 */
function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "Ledger";
}
export default function LedgerExportDialog({
  open,
  onOpenChange,
  variant,
  statement,
  company,
  address,
  email,
  contactNumber,
}: LedgerExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [generating, setGenerating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) setFormat("pdf");
  }, [open]);

  async function buildPdfFile(): Promise<File> {
    if (!captureRef.current || !statement) {
      throw new Error("Nothing to export.");
    }

    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(captureRef.current, {
      scale: 2,
      backgroundColor: "#ffffff",
      // Same fix as ShareLRDialog.tsx / ShareBillDialog.tsx: the app's
      // global theme defines every color token via `oklch()`, which
      // html2canvas's color parser can't read. Overriding the root
      // custom properties on the *cloned* document (never the live
      // page) with plain hex equivalents keeps every derived color
      // parseable.
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

    // A Ledger's captured height varies with its transaction count, so
    // it's sliced into one PDF page per A4-page-worth of canvas pixels
    // (at the canvas's own px-per-mm ratio) rather than squeezing the
    // whole tall capture onto a single page — same technique as
    // ShareBillDialog.tsx.
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
    const safeName = sanitizeFileNameSegment(statement.billingParty.name);
    const fileName = `Ledger-${safeName}-${statement.fromDate}-to-${statement.toDate}.pdf`;

    return new File([blob], fileName, { type: "application/pdf" });
  }

  async function buildExcelFile(): Promise<File> {
    if (!statement) {
      throw new Error("Nothing to export.");
    }

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = company?.companyName || "Ledger";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Ledger Statement", {
      pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 },
    });

    sheet.columns = [
      { key: "date", width: 14 },
      { key: "particulars", width: 24 },
      { key: "reference", width: 20 },
      { key: "debit", width: 16 },
      { key: "credit", width: 16 },
      { key: "balance", width: 16 },
    ];

    const amountFormat = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
    const dateFormat = "dd mmm yyyy";
    const toDateValue = (value: string) => {
      try {
        return parseISO(value);
      } catch {
        return value;
      }
    };

    let rowIndex = 1;

    sheet.mergeCells(rowIndex, 1, rowIndex, 6);
    const titleCell = sheet.getCell(rowIndex, 1);
    titleCell.value = "Ledger Statement";
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center" };
    rowIndex += 2;

    const addInfoRow = (label: string, value: string | Date, numFmt?: string) => {
      const row = sheet.getRow(rowIndex);
      row.getCell(1).value = label;
      row.getCell(1).font = { bold: true };
      sheet.mergeCells(rowIndex, 2, rowIndex, 6);
      const valueCell = row.getCell(2);
      valueCell.value = value;
      if (numFmt) valueCell.numFmt = numFmt;
      rowIndex += 1;
    };

    addInfoRow("Account Of", statement.billingParty.name);
    addInfoRow("Address", address || "-");
    addInfoRow("Email", email || "-");
    addInfoRow("Contact Number", contactNumber || "-");
    addInfoRow("From Date", toDateValue(statement.fromDate), dateFormat);
    addInfoRow("To Date", toDateValue(statement.toDate), dateFormat);
    rowIndex += 1;

    addInfoRow("Opening Balance", "");
    sheet.getCell(rowIndex - 1, 2).value = statement.openingBalance;
    sheet.getCell(rowIndex - 1, 2).numFmt = amountFormat;
    rowIndex += 1;

    const thinBorder: Partial<Border> = { style: "thin", color: { argb: "FF999999" } };
    const headerRowIndex = rowIndex;
    const headerRow = sheet.getRow(headerRowIndex);
    ["Date", "Particulars", "Reference", "Debit", "Credit", "Balance"].forEach((label, colIndex) => {
      const cell = headerRow.getCell(colIndex + 1);
      cell.value = label;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
    });
    rowIndex += 1;

    // Freezes everything at/above the transaction-table header so it
    // stays visible while scrolling through a long ledger.
    sheet.views = [{ state: "frozen", ySplit: headerRowIndex }];

    for (const row of statement.rows) {
      const dataRow = sheet.getRow(rowIndex);
      dataRow.getCell(1).value = toDateValue(row.date);
      dataRow.getCell(1).numFmt = dateFormat;
      dataRow.getCell(2).value = row.particulars;
      dataRow.getCell(3).value = row.reference;
      dataRow.getCell(4).value = row.debit;
      dataRow.getCell(4).numFmt = amountFormat;
      dataRow.getCell(5).value = row.credit;
      dataRow.getCell(5).numFmt = amountFormat;
      dataRow.getCell(6).value = row.runningBalance;
      dataRow.getCell(6).numFmt = amountFormat;

      for (let col = 1; col <= 6; col += 1) {
        const cell = dataRow.getCell(col);
        cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
        if (col >= 4) cell.alignment = { horizontal: "right" };
      }

      rowIndex += 1;
    }

    if (statement.rows.length === 0) {
      sheet.mergeCells(rowIndex, 1, rowIndex, 6);
      const emptyCell = sheet.getCell(rowIndex, 1);
      emptyCell.value = "No transactions found for this Billing Party in the selected period.";
      emptyCell.alignment = { horizontal: "center" };
      emptyCell.font = { italic: true, color: { argb: "FF777777" } };
      rowIndex += 1;
    }

    rowIndex += 1;

    const addTotalRow = (label: string, value: number, bold = false) => {
      const row = sheet.getRow(rowIndex);
      sheet.mergeCells(rowIndex, 1, rowIndex, 3);
      const labelCell = row.getCell(1);
      labelCell.value = label;
      labelCell.font = { bold: true };
      const valueCell = row.getCell(4);
      valueCell.value = value;
      valueCell.numFmt = amountFormat;
      valueCell.alignment = { horizontal: "right" };
      if (bold) valueCell.font = { bold: true };
      rowIndex += 1;
    };

    addTotalRow("Total Debit", statement.totalDebit);
    addTotalRow("Total Credit", statement.totalCredit);
    addTotalRow("Closing Balance", statement.closingBalance, true);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const safeName = sanitizeFileNameSegment(statement.billingParty.name);
    const fileName = `Ledger-${safeName}-${statement.fromDate}-to-${statement.toDate}.xlsx`;

    return new File([blob], fileName, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  function downloadFile(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleConfirm() {
    if (!statement) return;

    try {
      setGenerating(true);

      const file = format === "pdf" ? await buildPdfFile() : await buildExcelFile();

      if (variant === "share") {
        const nav = navigator as Navigator & {
          share?: (data: ShareData) => Promise<void>;
          canShare?: (data: ShareData) => boolean;
        };

        if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
          await nav.share({ files: [file], title: `Ledger - ${statement.billingParty.name}` });
        } else {
          downloadFile(file);
        }
      } else {
        downloadFile(file);
      }

      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error(`Unable to ${variant} the ledger as ${format.toUpperCase()}.`);
    } finally {
      setGenerating(false);
    }
  }

  const title = variant === "download" ? "Download Ledger" : "Share Ledger";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !generating && onOpenChange(next)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="ledger-export-format"
              value="pdf"
              checked={format === "pdf"}
              onChange={() => setFormat("pdf")}
            />
            PDF
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="ledger-export-format"
              value="excel"
              checked={format === "excel"}
              onChange={() => setFormat("excel")}
            />
            Excel (.xlsx)
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={generating}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={generating || !statement}
            onClick={handleConfirm}
          >
            {generating ? "Generating..." : variant === "download" ? "Download" : "Share"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Off-screen render of the existing Ledger statement view —
       * captured as-is, never redesigned. Portaled directly to <body>
       * so html2canvas has the shortest possible ancestor chain to walk
       * when computing styles. */}
      {mounted &&
        statement &&
        createPortal(
          <div style={{ position: "fixed", top: 0, left: "-10000px", zIndex: -1 }}>
            <div ref={captureRef}>
              <LedgerStatementView
                statement={statement}
                company={company}
                address={address}
                email={email}
                contactNumber={contactNumber}
              />
            </div>
          </div>,
          document.body
        )}
    </Dialog>
  );
}
