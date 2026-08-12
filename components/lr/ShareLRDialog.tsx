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
import type { LRRecord } from "@/components/services/lr.service";
import { generateLrPdfFile } from "@/components/lr/lrPdfOverlay";

interface ShareLRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lr: LRRecord | null;
}

/**
 * Shares/downloads an LR from the original stationery PDF + dynamic overlay.
 * Final artifact is the PDF itself (not an HTML/CSS recreation).
 */
export default function ShareLRDialog({ open, onOpenChange, lr }: ShareLRDialogProps) {
  const [generating, setGenerating] = useState(false);

  async function handleShare() {
    if (!lr) return;

    try {
      setGenerating(true);

      const file = await generateLrPdfFile(lr);

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
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(url);
      }

      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error("Unable to share LR as PDF.");
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

        <p className="text-sm text-muted-foreground">
          Downloads the original LR stationery PDF with this LR Entry&apos;s
          dynamic values filled in (filename e.g. LR 19182.pdf).
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
            disabled={generating || !lr}
            onClick={handleShare}
          >
            {generating ? "Generating..." : "Share PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
