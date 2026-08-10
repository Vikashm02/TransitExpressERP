"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Pencil, Printer, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import BillPrint from "@/components/billing/BillPrint";
import EditBillDialog from "@/components/billing/EditBillDialog";
import ShareBillDialog from "@/components/billing/ShareBillDialog";
import styles from "@/components/billing/BillPrint.module.css";
import { getBill, type BillDetail } from "@/components/services/billing.service";
import { getCompany, type CompanyRecord } from "@/components/services/company.service";

/** `useSearchParams` (for `?autoprint=1`) requires a Suspense boundary
 * around any client component that calls it, or the production build
 * fails with "Missing Suspense boundary with useSearchParams". */
export default function BillPrintPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-center text-sm text-muted-foreground">Loading bill…</div>}
    >
      <BillPrintPageContent />
    </Suspense>
  );
}

function BillPrintPageContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get("autoprint") === "1";

  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const billId = Number(params.id);

  async function loadBill() {
    if (!billId || Number.isNaN(billId)) {
      setError("Invalid Bill id.");
      setLoading(false);
      return;
    }

    try {
      const [billDetail, companyRecord] = await Promise.all([getBill(billId), getCompany()]);
      setDetail(billDetail);
      setCompany(companyRecord);
    } catch (err) {
      console.error(err);
      setError("Unable to load this bill for printing.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    if (autoPrint && detail && !loading) {
      window.print();
    }
  }, [autoPrint, detail, loading]);

  if (loading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading bill…</div>;
  }

  if (error || !detail) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-destructive">{error || "Bill not found."}</p>
        <Button variant="outline" onClick={() => router.push("/billing")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Billing
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-muted/40 py-6 print:bg-white print:py-0">
      <div className={styles.toolbar}>
        <Button variant="outline" onClick={() => router.push("/billing")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Button variant="outline" onClick={() => setEditOpen(true)}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
        <Button variant="outline" onClick={() => setShareOpen(true)}>
          <Share2 className="h-3.5 w-3.5" />
          Share
        </Button>
      </div>

      <BillPrint
        bill={detail.bill}
        billingParty={detail.billingParty}
        lines={detail.lines}
        company={company}
      />

      <EditBillDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        bill={detail.bill}
        onSaved={loadBill}
      />

      <ShareBillDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        billId={detail.bill.id}
      />
    </div>
  );
}
