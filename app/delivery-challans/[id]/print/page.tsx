"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import DeliveryChallanPrint from "@/components/deliveryChallan/DeliveryChallanPrint";
import styles from "@/components/deliveryChallan/DeliveryChallanPrint.module.css";
import {
  getDeliveryChallan,
  type DeliveryChallanRecord,
} from "@/components/services/deliveryChallan.service";

export default function DeliveryChallanPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [challan, setChallan] = useState<DeliveryChallanRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = Number(params.id);

    if (!id || Number.isNaN(id)) {
      setError("Invalid Delivery Challan id.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const record = await getDeliveryChallan(id);
        setChallan(record);
      } catch (err) {
        console.error(err);
        setError("Unable to load this Delivery Challan for printing.");
      } finally {
        setLoading(false);
      }
    })();
  }, [params.id]);

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Loading Delivery Challan…
      </div>
    );
  }

  if (error || !challan) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-destructive">{error || "Delivery Challan not found."}</p>
        <Button variant="outline" onClick={() => router.push("/delivery-challans")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Delivery Challan
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-muted/40 py-6 print:bg-white print:py-0">
      <div className={styles.toolbar}>
        <Button variant="outline" onClick={() => router.push("/delivery-challans")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      </div>

      <DeliveryChallanPrint challan={challan} />
    </div>
  );
}
