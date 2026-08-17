"use client";

import { useState } from "react";
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

interface ShareDeliveryChallanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  challan: DeliveryChallanRecord | null;
}

function isShareCancelled(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    error.name === "AbortError"
  );
}

/** Download the generated PDF; delay revoke so mobile browsers can start the save. */
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

  async function handleShare() {
    if (!challan) return;

    try {
      setGenerating(true);

      const file = await generateDeliveryChallanPdfFile(challan);
      const shareLabel = file.name.replace(/\.pdf$/i, "");

      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };

      const canFileShare =
        typeof nav.share === "function" &&
        (typeof nav.canShare !== "function" || nav.canShare({ files: [file] }));

      if (canFileShare) {
        try {
          await nav.share!({
            files: [file],
            title: shareLabel,
            text: shareLabel,
          });
          onOpenChange(false);
          return;
        } catch (shareError) {
          if (isShareCancelled(shareError)) return;
          // Share can fail on some mobile browsers even when canShare is true —
          // keep the PDF via download instead of surfacing a hard error.
          console.error(shareError);
        }
      }

      downloadPdfFile(file);
      onOpenChange(false);
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

        <DialogFooter>
          <Button
            variant="outline"
            disabled={generating}
            onClick={() => onOpenChange(false)}
          >
            Cancel
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
