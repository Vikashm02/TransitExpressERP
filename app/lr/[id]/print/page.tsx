"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import LRPrint from "@/components/lr/LRPrint";
import styles from "@/components/lr/LRPrint.module.css";
import { getLR, type LRRecord } from "@/components/services/lr.service";
import { getCompany, type CompanyRecord } from "@/components/services/company.service";

export default function LRPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [lr, setLR] = useState<LRRecord | null>(null);
  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = params.id;

    if (!id) {
      setError("Invalid LR id.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        // `LRRecord.id` is typed as `number` in lr.service.ts, but the live
        // `lrs` table's primary key is actually a UUID string — a
        // pre-existing mismatch left untouched here. Supabase's `.eq()`
        // filter works fine with the raw string id regardless of the
        // declared parameter type.
        const [lrRecord, companyRecord] = await Promise.all([
          getLR(id as unknown as number),
          getCompany(),
        ]);
        setLR(lrRecord);
        setCompany(companyRecord);
      } catch (err) {
        console.error(err);
        setError("Unable to load this LR for printing.");
      } finally {
        setLoading(false);
      }
    })();
  }, [params.id]);

  if (loading) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading LR…</div>;
  }

  if (error || !lr) {
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
    <div className="bg-muted/40 py-6 print:bg-white print:py-0">
      <div className={styles.toolbar}>
        <Button variant="outline" onClick={() => router.push("/lr")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      </div>

      <LRPrint lr={lr} company={company} />
    </div>
  );
}
