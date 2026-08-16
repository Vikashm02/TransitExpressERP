"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  ClipboardCheck,
  ReceiptIndianRupee,
  Wallet,
  PackageX,
  X,
} from "lucide-react";

import StatCard from "@/components/ui/StatCard";
import { Button } from "@/components/ui/button";
import FormDatePicker from "@/components/ui/FormDatePicker";
import { getLRs, type LRRecord } from "@/components/services/lr.service";
import { getPods, type PodRecord } from "@/components/services/pod.service";
import { getOverallOutstanding } from "@/components/services/ledger.service";

function inDateRange(date: string, fromDate: string, toDate: string): boolean {
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

/**
 * "Pending Billing" has no established definition anywhere else in the
 * app (left exactly as-is, per instructions — to be revisited during
 * Reports work), so it is intentionally NOT filtered here and stays a
 * static placeholder.
 */
export default function DashboardCards() {
  const [loading, setLoading] = useState(true);
  const [lrs, setLrs] = useState<LRRecord[]>([]);
  const [pods, setPods] = useState<PodRecord[]>([]);

  const [outstandingLoading, setOutstandingLoading] = useState(true);
  const [outstanding, setOutstanding] = useState<number | null>(null);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    let cancelled = false;

    Promise.all([getLRs(), getPods()])
      .then(([lrData, podData]) => {
        if (cancelled) return;
        setLrs(lrData);
        setPods(podData);
      })
      .catch((error) => {
        console.error(error);
        toast.error("Unable to load dashboard statistics.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Outstanding is Bill/Credit Note driven (not LR driven), so it is
  // refetched only when the date range changes.
  useEffect(() => {
    let cancelled = false;
    setOutstandingLoading(true);

    getOverallOutstanding(fromDate || undefined, toDate || undefined)
      .then((value) => {
        if (!cancelled) setOutstanding(value);
      })
      .catch((error) => {
        console.error(error);
        toast.error("Unable to load outstanding amount.");
      })
      .finally(() => {
        if (!cancelled) setOutstandingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate]);

  const filteredLRs = useMemo(() => {
    return lrs.filter((lr) => inDateRange(lr.lrDate, fromDate, toDate));
  }, [lrs, fromDate, toDate]);

  // Pending POD: an LR for which POD has not yet been entered — the
  // existing LR <-> POD relationship (matched by lrNumber), exactly as
  // used in BillDialog.tsx / PodListPage.tsx.
  const pendingPodCount = useMemo(
    () => filteredLRs.filter((lr) => !pods.some((pod) => pod.lrNumber === lr.lrNumber)).length,
    [filteredLRs, pods]
  );

  // Unbilled LRs: an LR not yet included in any bill — reuses the LR
  // module's own status field, which is set to "Billed" exactly when a
  // Bill includes it (see BillingListPage.tsx's markLRsBilled and the
  // identical "unbilled" definition already used by the LR Summary Report).
  const unbilledCount = useMemo(
    () => filteredLRs.filter((lr) => lr.status !== "Billed").length,
    [filteredLRs]
  );

  const cards = [
    {
      title: "Total LRs",
      value: loading ? "…" : String(filteredLRs.length),
      icon: FileText,
    },
    {
      title: "Pending POD",
      value: loading ? "…" : String(pendingPodCount),
      icon: ClipboardCheck,
    },
    {
      title: "Pending Billing",
      value: "₹0",
      icon: ReceiptIndianRupee,
    },
    {
      title: "Unbilled LRs",
      value: loading ? "…" : String(unbilledCount),
      icon: PackageX,
    },
    {
      title: "Outstanding",
      value: outstandingLoading ? "…" : outstanding === null ? "—" : `₹ ${outstanding.toFixed(2)}`,
      icon: Wallet,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="overflow-hidden erp-panel">
        <div className="border-b border-border/80 bg-gradient-to-r from-primary/[0.07] via-card to-highlight/[0.08] px-4 py-4 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Operations snapshot
          </p>
          <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            Dashboard
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Live operational counts for LRs, POD, billing, and outstanding receivables.
          </p>
        </div>

        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex items-end gap-1 sm:w-48">
            <FormDatePicker
              label="From Date"
              value={fromDate}
              onChange={setFromDate}
              className="flex-1"
            />

            {fromDate && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="Clear From Date"
                onClick={() => setFromDate("")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex items-end gap-1 sm:w-48">
            <FormDatePicker
              label="To Date"
              value={toDate}
              onChange={setToDate}
              className="flex-1"
            />

            {toDate && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="Clear To Date"
                onClick={() => setToDate("")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-5">
        {cards.map((card) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            icon={card.icon}
          />
        ))}
      </div>
    </div>
  );
}
