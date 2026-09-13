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

export default function LRPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { session, loading: authLoading, profileLoading, hasPermission } = useAuth();
  const loadedLrIdRef = useRef<string | null>(null);

  const [lr, setLR] = useState<LRRecord | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("LR.pdf");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        const lrRecord = await getLR(id as unknown as number);
        if (cancelled) return;
        setLR(lrRecord);

        const file = await generateLrPdfFile(lrRecord);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(file);
        setPdfUrl(objectUrl);
        setFileName(lrPdfFileName(lrRecord.lrNumber, lrRecord.vehicleNumber));
        document.title = file.name.replace(/\.pdf$/i, "");
      } catch {
        // RLS may revoke a previously eligible user between notification tap
        // and the LR lookup. Do not reveal an error page or partial content.
        if (!cancelled) router.replace("/");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authLoading, hasPermission, params.id, profileLoading, router, session]);

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
        <Button variant="outline" onClick={() => router.push("/lr")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to LR Entry
        </Button>
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
        className="mx-auto mb-4 h-full w-full max-w-6xl flex-1 rounded border bg-white"
      />
    </div>
  );
}
