"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, Minus, Plus, Printer } from "lucide-react";

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Committed zoom (1 = 100%). Drives the crisp pdfjs re-render below.
  const [zoom, setZoom] = useState(1);
  // Active pointer positions during gestures (pointerId -> client coords).
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  // Pinch session baseline captured when the second pointer lands.
  const pinchRef = useRef<{ startDistance: number; startZoom: number } | null>(null);
  // True from the second finger down until every finger is up; survives a
  // momentary single-finger lift so the final release still commits.
  const pinchSessionRef = useRef(false);
  // Live visual zoom including in-gesture feedback (mirrors committed zoom).
  const liveZoomRef = useRef(1);
  // Last single-tap for double-tap detection.
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  // Scroll position to restore after a zoom re-render (proportional ratios,
  // plus optional tap point to center for double-tap).
  const zoomRestoreRef = useRef<{
    ratioX: number;
    ratioY: number;
    centerX?: number;
    centerY?: number;
  } | null>(null);
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
          setZoom(1);
          zoomRestoreRef.current = null;
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
  // Render scale follows the committed zoom (base 1.5 × zoom) so zoomed
  // output stays crisp — never a CSS-only upscale of a low-res bitmap.
  useEffect(() => {
    if (!pdfFile) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    // Capture the pending scroll restore before this render replaces pixels.
    const restore = zoomRestoreRef.current;
    zoomRestoreRef.current = null;
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
        const viewport = page.getViewport({ scale: 1.5 * zoom });
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
        restorePreviewScroll(restore);
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
  }, [pdfFile, zoom]);

  function handleRetry() {
    loadedLrIdRef.current = null;
    setError(null);
    setPreviewError(null);
    setZoom(1);
    liveZoomRef.current = 1;
    zoomRestoreRef.current = null;
    pointersRef.current.clear();
    pinchRef.current = null;
    pinchSessionRef.current = false;
    lastTapRef.current = null;
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

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 3;
  const ZOOM_STEP = 0.25;

  function clampZoom(value: number): number {
    if (!Number.isFinite(value)) return MIN_ZOOM;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 20) / 20));
  }

  /**
   * Commit a zoom level: records the current scroll position (plus an
   * optional content point to center, e.g. a double-tap) so the re-render
   * below can preserve the user's viewing position instead of jumping.
   */
  function commitZoom(nextZoom: number, center?: { x: number; y: number }) {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const clamped = clampZoom(nextZoom);
    liveZoomRef.current = clamped;
    if (container && canvas) {
      const { scrollLeft, scrollTop, scrollWidth, scrollHeight } = container;
      const restore: { ratioX: number; ratioY: number; centerX?: number; centerY?: number } = {
        ratioX: scrollWidth > 0 ? scrollLeft / scrollWidth : 0,
        ratioY: scrollHeight > 0 ? scrollTop / scrollHeight : 0,
      };
      if (center) {
        const rect = canvas.getBoundingClientRect();
        restore.centerX = center.x - rect.left + scrollLeft;
        restore.centerY = center.y - rect.top + scrollTop;
      }
      zoomRestoreRef.current = restore;
    }
    setZoom((current) => (current === clamped ? current : clamped));
  }

  /** Applies a committed zoom's recorded scroll position after re-render. */
  function restorePreviewScroll(
    restore: { ratioX: number; ratioY: number; centerX?: number; centerY?: number } | null
  ) {
    const container = containerRef.current;
    if (!container || !restore) return;
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    if (restore.centerX != null && restore.centerY != null) {
      container.scrollLeft = Math.min(maxLeft, Math.max(0, restore.centerX - container.clientWidth / 2));
      container.scrollTop = Math.min(maxTop, Math.max(0, restore.centerY - container.clientHeight / 2));
      return;
    }
    container.scrollLeft = Math.min(maxLeft, Math.max(0, restore.ratioX * container.scrollWidth));
    container.scrollTop = Math.min(maxTop, Math.max(0, restore.ratioY * container.scrollHeight));
  }

  function zoomIn() {
    commitZoom(liveZoomRef.current + ZOOM_STEP);
  }

  function zoomOut() {
    commitZoom(liveZoomRef.current - ZOOM_STEP);
  }

  function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function setContainerTouchAction(value: string) {
    const container = containerRef.current;
    if (container) container.style.touchAction = value;
  }

  function handlePreviewPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!previewReady) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      // Second finger down: (re)begin pinch from the live visual zoom.
      // Disable browser gesture handling for the duration; normal
      // one-finger scroll is restored on release.
      const [first, second] = [...pointersRef.current.values()];
      const distance = pointerDistance(first, second);
      if (distance > 0) {
        pinchRef.current = { startDistance: distance, startZoom: liveZoomRef.current };
        pinchSessionRef.current = true;
        setContainerTouchAction("none");
      }
      lastTapRef.current = null;
    }
  }

  function handlePreviewPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer || pointersRef.current.size !== 2 || !pinchRef.current) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const [first, second] = [...pointersRef.current.values()];
    const distance = pointerDistance(first, second);
    if (distance <= 0) return;
    // Live visual feedback only (cheap CSS width); the crisp pdfjs
    // re-render happens once on release via commitZoom.
    const liveZoom = clampZoom(
      (pinchRef.current.startZoom * distance) / pinchRef.current.startDistance
    );
    liveZoomRef.current = liveZoom;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas && container && container.scrollWidth > 0) {
      const midClientX = (first.x + second.x) / 2;
      const midClientY = (first.y + second.y) / 2;
      const rect = canvas.getBoundingClientRect();
      const anchorX = midClientX - rect.left + container.scrollLeft;
      const anchorY = midClientY - rect.top + container.scrollTop;
      canvas.style.width = `${Math.round(liveZoom * 100)}%`;
      const containerRect = container.getBoundingClientRect();
      container.scrollLeft = Math.max(
        0,
        anchorX * (canvas.scrollWidth / Math.max(1, rect.width)) -
          (midClientX - containerRect.left)
      );
      container.scrollTop = Math.max(
        0,
        anchorY * (canvas.scrollWidth / Math.max(1, rect.width)) -
          (midClientY - containerRect.top)
      );
    }
  }

  function endPreviewPointer(event: React.PointerEvent<HTMLDivElement>) {
    const inPinchSession = pinchSessionRef.current;
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
      setContainerTouchAction("");
    }
    if (!inPinchSession || pointersRef.current.size !== 0) return;
    // Pinch fully ended: commit one crisp re-render at the live zoom.
    pinchSessionRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.width = "";
    commitZoom(liveZoomRef.current);
  }

  function handlePreviewPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    endPreviewPointer(event);
    // Single-finger double-tap toggles 100% <-> 200%, centering the tap.
    if (pointersRef.current.size !== 0 || pinchSessionRef.current) return;
    const now = Date.now();
    const last = lastTapRef.current;
    if (
      last &&
      now - last.time < 300 &&
      Math.hypot(event.clientX - last.x, event.clientY - last.y) < 24
    ) {
      lastTapRef.current = null;
      commitZoom(liveZoomRef.current >= 1.5 ? MIN_ZOOM : 2, { x: event.clientX, y: event.clientY });
      return;
    }
    lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
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
        <div
          className="mr-auto flex items-center gap-1"
          role="group"
          aria-label="Preview zoom"
        >
          <Button
            variant="outline"
            size="icon"
            onClick={zoomOut}
            disabled={!previewReady || zoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span
            className="min-w-12 text-center text-xs font-medium tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={zoomIn}
            disabled={!previewReady || zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
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
      <div
        ref={containerRef}
        className="mx-auto mb-4 w-full max-w-6xl flex-1 overflow-auto bg-white p-2"
        onPointerDown={handlePreviewPointerDown}
        onPointerMove={handlePreviewPointerMove}
        onPointerUp={handlePreviewPointerUp}
        onPointerCancel={handlePreviewPointerUp}
      >
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
          className="mx-auto h-auto"
          style={{ aspectRatio: "297 / 210", width: `${Math.round(zoom * 100)}%` }}
        />
      </div>
    </div>
  );
}
