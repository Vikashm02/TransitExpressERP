"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getAsn, type AsnRecord } from "@/components/services/asn.service";
import { generateAsnPdfFile } from "@/components/asn/asnPdf";

function isShareCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export default function AsnPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [asn, setAsn] = useState<AsnRecord | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = Number(params.id);

    if (!id || Number.isNaN(id)) {
      setError("Invalid ASN id.");
      setLoading(false);
      return;
    }

    let objectUrl: string | null = null;

    (async () => {
      try {
        const record = await getAsn(id);
        setAsn(record);
        const file = await generateAsnPdfFile(record);
        objectUrl = URL.createObjectURL(file);
        setPdfFile(file);
        setPdfUrl(objectUrl);
        document.title = file.name.replace(/\.pdf$/i, "");
      } catch (err) {
        console.error(err);
        setError("Unable to load this ASN for printing.");
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [params.id]);

  function handleDownload() {
    if (!pdfFile || !pdfUrl) return;
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = pdfFile.name;
    link.click();
  }

  async function handleShare() {
    if (!pdfFile) return;
    try {
      setSharing(true);
      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };
      const title = pdfFile.name.replace(/\.pdf$/i, "");
      if (nav.share && (!nav.canShare || nav.canShare({ files: [pdfFile] }))) {
        await nav.share({ files: [pdfFile], title, text: title });
      } else {
        handleDownload();
      }
    } catch (err) {
      if (isShareCancelled(err)) return;
      console.error(err);
      toast.error("Unable to share ASN as PDF.");
    } finally {
      setSharing(false);
    }
  }

  function handlePrint() {
    if (!pdfUrl) return;
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
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Generating ASN PDF…
      </div>
    );
  }

  if (error || !asn || !pdfUrl || !pdfFile) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-destructive">{error || "ASN not found."}</p>
        <Button variant="outline" onClick={() => router.push("/asn")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to ASN Creation
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-muted/40">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-2 px-4 py-3">
        <Button variant="outline" onClick={() => router.push("/asn")}>
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
        <Button variant="outline" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
        <Button onClick={handlePrint} disabled={sharing}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      </div>
      <iframe
        title={`ASN ${asn.asnNumber}`}
        src={pdfUrl}
        className="mx-auto mb-4 h-full w-full max-w-6xl flex-1 rounded border bg-white"
      />
    </div>
  );
}
