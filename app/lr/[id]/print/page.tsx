"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";

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

          const file = await generateLrPdfFile(lrRecord);
          if (isStale()) return;
          objectUrl = URL.createObjectURL(file);
          if (isStale()) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
            return;
          }
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

  function handleRetry() {
    loadedLrIdRef.current = null;
    setError(null);
    setPdfUrl(null);
    setLR(null);
    setLoading(true);
    setRetryCount((count) => count + 1);
  }

  function handlePdfError() {
    setError("Unable to display the PDF. Please try again.");
  }

  function handleDownload() {
    if (!pdfUrl) return;
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = fileName;
    link.click();
  }

  function handlePrint() {
    if (!pdfUrl) return;
    // Print the generated PDF artifact (not an HTML recreation).
    const w = window.open(pdfUrl, "_blank");
    if (!w) {
      handleDownload();
      return;
    }
    w.addEventListener("load", () => {
      w.focus();
      w.print();
    });
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Generating LR PDF…</div>;
  }

  if (error || !lr || !pdfUrl) {
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
      <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-2 px-4 py-3">
        <Button variant="outline" onClick={() => router.push("/lr")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Button variant="outline" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
        <Button onClick={handlePrint}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      </div>
      <iframe
        title={`Lorry Receipt ${lr.lrNumber}`}
        src={pdfUrl}
        onError={handlePdfError}
        className="mx-auto mb-4 h-full w-full max-w-6xl flex-1 rounded border bg-white"
      />
    </div>
  );
}
