"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  getDeliveryChallan,
  type DeliveryChallanRecord,
} from "@/components/services/deliveryChallan.service";
import {
  deliveryChallanPdfFileName,
  generateDeliveryChallanPdfFile,
} from "@/components/deliveryChallan/deliveryChallanPdfOverlay";

function isShareCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export default function DeliveryChallanPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [challan, setChallan] = useState<DeliveryChallanRecord | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = Number(params.id);

    if (!id || Number.isNaN(id)) {
      setError("Invalid Delivery Challan id.");
      setLoading(false);
      return;
    }

    let objectUrl: string | null = null;

    (async () => {
      try {
        const record = await getDeliveryChallan(id);
        setChallan(record);

        const file = await generateDeliveryChallanPdfFile(record);
        objectUrl = URL.createObjectURL(file);
        setPdfFile(file);
        setPdfUrl(objectUrl);
        document.title = deliveryChallanPdfFileName(record.lrNumber).replace(
          /\.pdf$/i,
          ""
        );
      } catch (err) {
        console.error(err);
        setError("Unable to load this Delivery Challan for printing.");
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [params.id]);

  function handleDownloadFallback(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleShare() {
    if (!pdfFile) return;

    try {
      setSharing(true);

      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };

      const shareLabel = pdfFile.name.replace(/\.pdf$/i, "");
      const shareData: ShareData = {
        files: [pdfFile],
        title: shareLabel,
        text: shareLabel,
      };

      if (nav.share && (!nav.canShare || nav.canShare({ files: [pdfFile] }))) {
        await nav.share(shareData);
      } else {
        handleDownloadFallback(pdfFile);
      }
    } catch (err) {
      if (isShareCancelled(err)) return;
      console.error(err);
      toast.error("Unable to share Delivery Challan as PDF.");
    } finally {
      setSharing(false);
    }
  }

  function handlePrint() {
    if (!pdfUrl) return;
    const w = window.open(pdfUrl, "_blank");
    if (!w) {
      if (pdfFile) handleDownloadFallback(pdfFile);
      return;
    }
    w.addEventListener("load", () => {
      w.focus();
      w.print();
    });
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Generating Delivery Challan PDF…
      </div>
    );
  }

  if (error || !challan || !pdfUrl || !pdfFile) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-destructive">
          {error || "Delivery Challan not found."}
        </p>
        <Button variant="outline" onClick={() => router.push("/delivery-challans")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Delivery Challan
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-muted/40">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-2 px-4 py-3">
        <Button variant="outline" onClick={() => router.push("/delivery-challans")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Button
          variant="outline"
          disabled={sharing || !pdfFile}
          onClick={handleShare}
        >
          <Share2 className="h-3.5 w-3.5" />
          {sharing ? "Generating..." : "Share"}
        </Button>
        <Button onClick={handlePrint} disabled={sharing}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      </div>
      <iframe
        title={`Delivery Challan ${challan.lrNumber}`}
        src={pdfUrl}
        className="mx-auto mb-4 h-full w-full max-w-6xl flex-1 rounded border bg-white"
      />
    </div>
  );
}
