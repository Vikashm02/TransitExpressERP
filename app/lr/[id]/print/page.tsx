"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";

import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";

import { Button } from "@/components/ui/button";
import { getLR, type LRRecord } from "@/components/services/lr.service";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  generateLrPdfFile,
  lrPdfFileName,
} from "@/components/lr/lrPdfOverlay";

const PRINT_LOAD_TIMEOUT_MS = 25_000;

export default function LRPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { session, loading: authLoading, profileLoading, hasPermission } = useAuth();
  const loadedLrIdRef = useRef<string | null>(null);
  const attemptRef = useRef(0);

  const [lr, setLR] = useState<LRRecord | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("LR.pdf");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (authLoading || profileLoading) return;

    // This route is intentionally outside DashboardLayout, so it performs the
    // same existing LR view-qualified check before fetching any LR/PDF data.
    if (!session || !hasPermission("lr", "view")) {
      router.replace("/");
      return;
    }

    const id = params.id;
    if (!id || loadedLrIdRef.current === id) return;
    loadedLrIdRef.current = id;

    const attempt = ++attemptRef.current;
    let objectUrl: string | null = null;
    let cancelled = false;
    let timedOut = false;
    let timeoutId: number | undefined;
    const isStale = () =>
      cancelled || attempt !== attemptRef.current;

    (async () => {
      try {
        const load = (async () => {
          const lrRecord = await getLR(id as unknown as number);
          if (isStale()) return;
          setLR(lrRecord);

          // The real PDF is generated exactly as today; it feeds Download
          // and is the byte source for the canvas preview below.
          const file = await generateLrPdfFile(lrRecord);
          if (isStale()) return;
          objectUrl = URL.createObjectURL(file);
          if (isStale()) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
            return;
          }
          setPdfFile(file);
          setPdfUrl(objectUrl);
          setFileName(lrPdfFileName(lrRecord.lrNumber, lrRecord.vehicleNumber));
          document.title = file.name.replace(/\.pdf$/i, "");
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
        const canUpdateAfterTimeout =
          !cancelled && attemptRef.current === attempt + 1;
        const canUpdateNormally =
          !cancelled && attemptRef.current === attempt;
        if (timedOut) {
          if (!canUpdateAfterTimeout) return;
        } else if (!canUpdateNormally) return;
        setError("Unable to load this LR for printing. Check your connection and try again.");
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        const canUpdateAfterTimeout =
          !cancelled && attemptRef.current === attempt + 1;
        const canUpdateNormally =
          !cancelled && attemptRef.current === attempt;
        if (timedOut) {
          if (!canUpdateAfterTimeout) return;
        } else if (!canUpdateNormally) return;
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authLoading, hasPermission, params.id, profileLoading, router, session, retryCount]);

  // Renders page 1 of the ACTUAL generated PDF into the preview canvas.
  // Nothing is redrawn manually; the bytes above are the source of truth.
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
        const doc = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy().catch(() => {});
          return;
        }
        const page = await doc.getPage(1);
        if (cancelled) {
          await loadingTask.destroy().catch(() => {});
          return;
        }
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        try {
          renderTask = page.render({ canvas, viewport });
          await renderTask.promise;
        } catch (renderError) {
          if (cancelled) return;
          throw renderError;
        }
        if (cancelled) {
          await loadingTask.destroy().catch(() => {});
          return;
        }
        setPreviewReady(true);
        await doc.cleanup().catch(() => {});
      } catch {
        if (cancelled) return;
        setPreviewError("Unable to display the LR preview. Check your connection and try again.");
      }
    })();
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // Render task already settled; nothing to cancel.
      }
      if (loadingTask) void loadingTask.destroy().catch(() => {});
    };
  }, [pdfFile]);

  function handleRetry() {
    loadedLrIdRef.current = null;
    setError(null);
    setPreviewError(null);
    setPreviewReady(false);
    setPdfFile(null);
    setPdfUrl(null);
    setLR(null);
    setLoading(true);
    setRetryCount((count) => count + 1);
  }

  function handleDownload() {
    if (!pdfUrl) return;
    // Android Chrome ignores clicks on detached anchors, so the link must
    // be in the document. pdfUrl stays owned by the page and is revoked
    // only on cleanup/retry/unmount — never here.
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = fileName.replace(/[/\\:*?"<>|]/g, "-");
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading LR…</div>;
  }

  if (error || !lr) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-destructive">{error || "LR not found."}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/lr")}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to LR Entry
          </Button>
          <Button onClick={handleRetry}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-muted/40">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-2 px-4 py-3 print:hidden">
        <Button variant="outline" onClick={() => router.push("/lr")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Button variant="outline" onClick={handleDownload} disabled={!pdfUrl}>
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
        <Button onClick={handlePrint}>
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
          style={{ aspectRatio: "297 / 210" }}
        />
      </div>
    </div>
  );
}
