"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getLR, type LRRecord } from "@/components/services/lr.service";
import {
  generateLrPdfFile,
  lrPdfFileName,
} from "@/components/lr/lrPdfOverlay";

export default function LRPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [lr, setLR] = useState<LRRecord | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("LR.pdf");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = params.id;

    if (!id) {
      setError("Invalid LR id.");
      setLoading(false);
      return;
    }

    let objectUrl: string | null = null;

    (async () => {
      try {
        // `LRRecord.id` is typed as `number` in lr.service.ts, but the live
        // `lrs` table's primary key is actually a UUID string.
        const lrRecord = await getLR(id as unknown as number);
        setLR(lrRecord);

        const file = await generateLrPdfFile(lrRecord);
        objectUrl = URL.createObjectURL(file);
        setPdfUrl(objectUrl);
        setFileName(lrPdfFileName(lrRecord.lrNumber));
        document.title = file.name.replace(/\.pdf$/i, "");
      } catch (err) {
        console.error(err);
        setError("Unable to load this LR for printing.");
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [params.id]);

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
