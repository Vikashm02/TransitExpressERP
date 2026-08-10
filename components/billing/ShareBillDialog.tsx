"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import BillPrint from "./BillPrint";
import { getBill, type BillDetail } from "@/components/services/billing.service";
import { getCompany, type CompanyRecord } from "@/components/services/company.service";

type ShareFormat = "pdf" | "jpg";

interface ShareBillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billId: number | null;
}

/**
 * Shares/downloads a Bill as PDF or JPG. Reuses the existing `BillPrint`
 * component exactly (rendered off-screen and rasterized) — there is
 * intentionally no second Bill layout anywhere in this file. Mirrors
 * `components/lr/ShareLRDialog.tsx`'s exact approach: same html2canvas +
 * jsPDF pipeline, same `onclone` oklch-color-fallback fix (the app's
 * global theme uses `oklch()`, which html2canvas 1.4.1 can't parse), and
 * the same off-screen `createPortal` to `document.body`.
 *
 * Unlike an LR (always one fixed-size page), a Bill's LR table can grow
 * to any number of rows, so a PDF here is sliced into as many A4 pages as
 * the captured content needs, instead of forcing everything onto one
 * page (which would squish or clip the table/footer/signature).
 */
export default function ShareBillDialog({ open, onOpenChange, billId }: ShareBillDialogProps) {
  const [format, setFormat] = useState<ShareFormat>("pdf");
  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [generating, setGenerating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !billId) return;

    setDetail(null);

    let cancelled = false;

    Promise.all([getBill(billId), getCompany()])
      .then(([billDetail, companyRecord]) => {
        if (cancelled) return;
        setDetail(billDetail);
        setCompany(companyRecord);
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [open, billId]);

  async function handleShare() {
    if (!detail || !captureRef.current) return;

    try {
      setGenerating(true);

      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(captureRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        // See components/lr/ShareLRDialog.tsx for the full explanation:
        // the app's global theme defines every color token via `oklch()`,
        // which html2canvas's color parser can't read. Overriding the
        // root custom properties on the *cloned* document (never the
        // live page) with plain hex equivalents keeps every derived
        // color parseable.
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

      const fileName = `Bill-${detail.bill.billNumber || detail.bill.id}.${format}`;
      let file: File;

      if (format === "jpg") {
        const blob: Blob = await new Promise((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Unable to generate JPG."))), "image/jpeg", 0.95)
        );
        file = new File([blob], fileName, { type: "image/jpeg" });
      } else {
        const { jsPDF } = await import("jspdf");
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        // A Bill's captured height varies with its LR count, so it's
        // sliced into one PDF page per A4-page-worth of canvas pixels
        // (at the canvas's own px-per-mm ratio) rather than squeezing
        // the whole tall capture onto a single page.
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
          ctx.drawImage(
            canvas,
            0,
            renderedPx,
            canvas.width,
            sliceHeightPx,
            0,
            0,
            canvas.width,
            sliceHeightPx
          );

          const sliceHeightMm = (sliceHeightPx * pageWidth) / canvas.width;

          if (pageIndex > 0) pdf.addPage();
          pdf.addImage(
            pageCanvas.toDataURL("image/jpeg", 0.95),
            "JPEG",
            0,
            0,
            pageWidth,
            sliceHeightMm
          );

          renderedPx += sliceHeightPx;
          pageIndex += 1;
        }

        const blob = pdf.output("blob");
        file = new File([blob], fileName, { type: "application/pdf" });
      }

      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };

      if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({ files: [file], title: `Bill ${detail.bill.billNumber}` });
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      }

      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error(`Unable to share Bill as ${format.toUpperCase()}.`);
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
          <DialogTitle>Share Bill</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="share-bill-format"
              value="pdf"
              checked={format === "pdf"}
              onChange={() => setFormat("pdf")}
            />
            PDF
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="share-bill-format"
              value="jpg"
              checked={format === "jpg"}
              onChange={() => setFormat("jpg")}
            />
            JPG
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
            disabled={generating || !detail}
            onClick={handleShare}
          >
            {generating ? "Generating..." : "Share"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Off-screen render of the existing print template — captured as-is,
       * never redesigned. Portaled directly to <body> (instead of nesting
       * under the dashboard layout/sidebar) so html2canvas has the shortest
       * possible ancestor chain to walk when computing styles. */}
      {mounted &&
        detail &&
        createPortal(
          <div style={{ position: "fixed", top: 0, left: "-10000px", zIndex: -1 }}>
            <div ref={captureRef}>
              <BillPrint
                bill={detail.bill}
                billingParty={detail.billingParty}
                lines={detail.lines}
                company={company}
              />
            </div>
          </div>,
          document.body
        )}
    </Dialog>
  );
}
