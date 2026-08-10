"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { downloadFile, shareOrDownloadFile } from "@/lib/reportExport";

export type ReportExportFormat = "pdf" | "excel";

interface ReportExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "download" always saves a file; "share" tries native Web Share
   * first and falls back to download — same pattern as
   * components/ledger/LedgerExportDialog.tsx. */
  variant: "download" | "share";
  title: string;
  shareTitle: string;
  disabled?: boolean;
  buildPdfFile: () => Promise<File>;
  buildExcelFile: () => Promise<File>;
}

/**
 * Generic Download/Share dialog shared by every report page — each
 * report only supplies its own `buildPdfFile`/`buildExcelFile`
 * builders (see lib/reportExport.ts), so the format-selection UI and
 * the download/share mechanics are never duplicated per report.
 */
export default function ReportExportDialog({
  open,
  onOpenChange,
  variant,
  title,
  shareTitle,
  disabled,
  buildPdfFile,
  buildExcelFile,
}: ReportExportDialogProps) {
  const [format, setFormat] = useState<ReportExportFormat>("pdf");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (open) setFormat("pdf");
  }, [open]);

  async function handleConfirm() {
    try {
      setGenerating(true);

      const file = format === "pdf" ? await buildPdfFile() : await buildExcelFile();

      if (variant === "share") {
        await shareOrDownloadFile(file, shareTitle);
      } else {
        downloadFile(file);
      }

      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error(`Unable to ${variant} the report as ${format.toUpperCase()}.`);
    } finally {
      setGenerating(false);
    }
  }

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
              name="report-export-format"
              value="pdf"
              checked={format === "pdf"}
              onChange={() => setFormat("pdf")}
            />
            PDF
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="report-export-format"
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
            disabled={generating || disabled}
            onClick={handleConfirm}
          >
            {generating ? "Generating..." : variant === "download" ? "Download" : "Share"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
