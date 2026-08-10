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
import LRPrint from "./LRPrint";
import type { LRRecord } from "@/components/services/lr.service";
import { getCompany, type CompanyRecord } from "@/components/services/company.service";

type ShareFormat = "pdf" | "jpg";

interface ShareLRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lr: LRRecord | null;
}

/**
 * Shares/downloads an LR as PDF or JPG. Reuses the existing `LRPrint`
 * component exactly (rendered off-screen and rasterized) — there is
 * intentionally no second LR layout anywhere in this file.
 */
export default function ShareLRDialog({ open, onOpenChange, lr }: ShareLRDialogProps) {
  const [format, setFormat] = useState<ShareFormat>("pdf");
  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [generating, setGenerating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    getCompany()
      .then(setCompany)
      .catch(() => setCompany(null));
  }, [open]);

  async function handleShare() {
    if (!lr || !captureRef.current) return;

    try {
      setGenerating(true);

      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(captureRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        // The app's global theme (app/globals.css `:root`) defines every
        // color token via modern `oklch()` CSS, which html2canvas's color
        // parser can't read and throws on — even for invisible 0-width
        // borders/outlines inherited via the global `* { border-color;
        // outline-color }` reset. Since every themed color ultimately
        // derives from these root custom properties, overriding just the
        // properties themselves (with plain hex equivalents) on the
        // cloned <html> is enough for every derived color to resolve to a
        // parseable value. This only edits html2canvas's own disposable
        // clone — the live page and its real theme are never touched.
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

      const fileName = `LR-${lr.lrNumber || lr.id}.${format}`;
      let file: File;

      if (format === "jpg") {
        const blob: Blob = await new Promise((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Unable to generate JPG."))), "image/jpeg", 0.95)
        );
        file = new File([blob], fileName, { type: "image/jpeg" });
      } else {
        const { jsPDF } = await import("jspdf");
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imageData = canvas.toDataURL("image/jpeg", 0.95);
        pdf.addImage(imageData, "JPEG", 0, 0, pageWidth, pageHeight);
        const blob = pdf.output("blob");
        file = new File([blob], fileName, { type: "application/pdf" });
      }

      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };

      if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({ files: [file], title: `Lorry Receipt ${lr.lrNumber}` });
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
      toast.error(`Unable to share LR as ${format.toUpperCase()}.`);
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
          <DialogTitle>Share Lorry Receipt</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="share-format"
              value="pdf"
              checked={format === "pdf"}
              onChange={() => setFormat("pdf")}
            />
            PDF
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="share-format"
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
            disabled={generating || !lr}
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
        lr &&
        createPortal(
          <div style={{ position: "fixed", top: 0, left: "-10000px", zIndex: -1 }}>
            <div ref={captureRef}>
              <LRPrint lr={lr} company={company} />
            </div>
          </div>,
          document.body
        )}
    </Dialog>
  );
}
