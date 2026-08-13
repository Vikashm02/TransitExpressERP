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
  return error instanceof DOMException && error.name === "AbortError";
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

      if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({
          files: [file],
          title: shareLabel,
          text: shareLabel,
        });
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(url);
      }

      onOpenChange(false);
    } catch (error) {
      if (isShareCancelled(error)) return;
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
