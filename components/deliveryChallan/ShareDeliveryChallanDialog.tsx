"use client";

import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DeliveryChallanRecord } from "@/components/services/deliveryChallan.service";
import { generateDeliveryChallanPdfFile } from "@/components/deliveryChallan/deliveryChallanPdfOverlay";
import { sharePdfNatively } from "@/components/services/nativePdfShare.service";

interface ShareDeliveryChallanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  challan: DeliveryChallanRecord | null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained for temporary diagnostic rollback.
function isShareCancelled(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    error.name === "AbortError"
  );
}

/** Download the generated PDF; delay revoke so mobile browsers can start the save. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained for temporary diagnostic rollback.
function downloadPdfFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Shares/downloads a Delivery Challan from the stationery PDF + dynamic overlay.
 * Same generator as the print page — one authoritative PDF.
 */
export default function ShareDeliveryChallanDialog({
  open,
  onOpenChange,
  challan,
}: ShareDeliveryChallanDialogProps) {
  const [generating, setGenerating] = useState(false);
  const [diagnostic, setDiagnostic] = useState<string[] | null>(null);

  async function handleShare() {
    if (!challan) return;

    try {
      setGenerating(true);
      setDiagnostic(null);

      const file = await generateDeliveryChallanPdfFile(challan);
      const shareLabel = file.name.replace(/\.pdf$/i, "");

      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };

      let canShareResult = "not available";
      if (typeof nav.canShare === "function") {
        try {
          canShareResult = String(nav.canShare({ files: [file] }));
        } catch (error) {
          const safeError = error instanceof Error ? error : new Error("Unknown error");
          canShareResult = `exception: ${safeError.name}: ${safeError.message}`;
        }
      }

      let nativeShareResult = "exception: Unknown error";
      try {
        nativeShareResult = String(
          await sharePdfNatively(file, { title: shareLabel, text: shareLabel }),
        );
      } catch (error) {
        const safeError = error instanceof Error ? error : new Error("Unknown error");
        nativeShareResult = `exception: ${safeError.name}: ${safeError.message}`;
      }

      setDiagnostic([
        `Capacitor platform: ${Capacitor.getPlatform()}`,
        `Capacitor native platform: ${String(Capacitor.isNativePlatform())}`,
        `Capacitor Share plugin: ${String(Capacitor.isPluginAvailable("Share"))}`,
        `Capacitor Filesystem plugin: ${String(Capacitor.isPluginAvailable("Filesystem"))}`,
        `navigator.share: ${typeof nav.share}`,
        `navigator.canShare: ${typeof nav.canShare}`,
        `navigator.canShare({ files }): ${canShareResult}`,
        `sharePdfNatively result: ${nativeShareResult}`,
      ]);

      // Temporary device diagnostic: deliberately do not use Web Share or
      // Blob-download fallback after displaying the capability results.
      return;
    } catch (error) {
      console.error(error);
      toast.error("Unable to share Delivery Challan as PDF.");
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
          <DialogTitle>Share Delivery Challan</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Shares the original Delivery Challan stationery PDF with this
          challan&apos;s values filled in (filename e.g. Delivery Challan
          19179.pdf).
        </p>

        {diagnostic && (
          <div className="rounded-md border bg-muted p-3 text-xs">
            <p className="mb-2 font-medium">Temporary share diagnostic</p>
            <ul className="space-y-1 break-words font-mono">
              {diagnostic.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={generating}
            onClick={() => onOpenChange(false)}
          >
            {diagnostic ? "Close" : "Cancel"}
          </Button>
          <Button
            disabled={generating || !challan}
            onClick={handleShare}
          >
            {generating ? "Generating..." : "Share PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
