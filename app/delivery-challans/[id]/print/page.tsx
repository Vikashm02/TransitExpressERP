"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";

import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";

import { Button } from "@/components/ui/button";
import {
  getDeliveryChallan,
  type DeliveryChallanRecord,
} from "@/components/services/deliveryChallan.service";
import {
  deliveryChallanPdfFileName,
  generateDeliveryChallanPdfFile,
} from "@/components/deliveryChallan/deliveryChallanPdfOverlay";
import { sharePdfNatively } from "@/components/services/nativePdfShare.service";

const PRINT_LOAD_TIMEOUT_MS = 25_000;

function isShareCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export default function DeliveryChallanPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const loadedChallanIdRef = useRef<string | null>(null);
  const attemptRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [challan, setChallan] = useState<DeliveryChallanRecord | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const id = Number(params.id);

    if (!id || Number.isNaN(id)) {
      setError("Invalid Delivery Challan id.");
      setLoading(false);
      return;
    }

    const idKey = String(id);
    if (loadedChallanIdRef.current === idKey) return;
    loadedChallanIdRef.current = idKey;

    const attempt = ++attemptRef.current;
    let cancelled = false;
    let timedOut = false;
    let timeoutId: number | undefined;
    const isStale = () => cancelled || attempt !== attemptRef.current;

    (async () => {
      try {
        const load = (async () => {
          const record = await getDeliveryChallan(id);
          if (isStale()) return;
          setChallan(record);

          // The existing generator remains the source of truth for the DC PDF.
          const file = await generateDeliveryChallanPdfFile(record);
          if (isStale()) return;
          setPdfFile(file);
          document.title = deliveryChallanPdfFileName(record.lrNumber).replace(/\.pdf$/i, "");
        })();
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            timedOut = true;
            attemptRef.current += 1;
            reject(new Error("Print load timed out."));
          }, PRINT_LOAD_TIMEOUT_MS);
        });
        await Promise.race([load, timeout]);
      } catch {
        const canUpdateAfterTimeout = !cancelled && attemptRef.current === attempt + 1;
        const canUpdateNormally = !cancelled && attemptRef.current === attempt;
        if (timedOut ? !canUpdateAfterTimeout : !canUpdateNormally) return;
        setError("Unable to load this Delivery Challan for printing. Check your connection and try again.");
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        const canUpdateAfterTimeout = !cancelled && attemptRef.current === attempt + 1;
        const canUpdateNormally = !cancelled && attemptRef.current === attempt;
        if (timedOut ? !canUpdateAfterTimeout : !canUpdateNormally) return;
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [params.id, retryCount]);

  // Render the existing generated PDF through the bundled PDF.js worker so the
  // preview never depends on Android WebView rendering a blob URL in an iframe.
  useEffect(() => {
    if (!pdfFile) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
        if (cancelled) return;
        const bytes = await pdfFile.arrayBuffer();
        if (cancelled) return;
        loadingTask = pdfjs.getDocument({ data: bytes });
        const document = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy().catch(() => {});
          return;
        }
        const page = await document.getPage(1);
        if (cancelled) {
          await loadingTask.destroy().catch(() => {});
          return;
        }
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        renderTask = page.render({ canvas, viewport });
        await renderTask.promise;
        if (cancelled) {
          await loadingTask.destroy().catch(() => {});
          return;
        }
        setPreviewReady(true);
        await document.cleanup().catch(() => {});
      } catch {
        if (!cancelled) {
          setPreviewError("Unable to display the Delivery Challan preview. Check your connection and try again.");
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // Render task already settled.
      }
      if (loadingTask) void loadingTask.destroy().catch(() => {});
    };
  }, [pdfFile]);

  function handleRetry() {
    loadedChallanIdRef.current = null;
    setError(null);
    setPreviewError(null);
    setPreviewReady(false);
    setPdfFile(null);
    setChallan(null);
    setLoading(true);
    setRetryCount((count) => count + 1);
  }

  function handleDownloadFallback(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
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

      if (await sharePdfNatively(pdfFile, { title: shareLabel, text: shareLabel })) {
        return;
      }

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
    window.print();
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Generating Delivery Challan PDF…</div>;
  }

  if (error || !challan || !pdfFile) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-destructive">{error || "Delivery Challan not found."}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/delivery-challans")}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Delivery Challan
          </Button>
          <Button onClick={handleRetry}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-muted/40">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-2 px-4 py-3 print:hidden">
        <Button variant="outline" onClick={() => router.push("/delivery-challans")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Button variant="outline" disabled={sharing || !pdfFile} onClick={handleShare}>
          <Share2 className="h-3.5 w-3.5" />
          {sharing ? "Generating..." : "Share"}
        </Button>
        <Button onClick={handlePrint} disabled={sharing || !previewReady}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      </div>
      <div className="mx-auto mb-4 w-full max-w-6xl flex-1 overflow-auto bg-white p-2">
        {!previewReady && !previewError && (
          <p className="p-8 text-center text-sm text-muted-foreground">Preparing preview…</p>
        )}
        {previewError && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm text-destructive">{previewError}</p>
            <Button onClick={handleRetry}>Retry</Button>
          </div>
        )}
        <canvas
          ref={canvasRef}
          hidden={!previewReady}
          className="mx-auto h-auto w-full"
          style={{ aspectRatio: "279.4 / 215.9" }}
        />
      </div>
    </div>
  );
}
