"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import FormSelect from "@/components/ui/FormSelect";
import { cn } from "@/lib/utils";
import {
  getConsigneeIntelligence,
  type ConsigneeIntelligenceResult,
  type ConsigneeIntelligenceWindow,
} from "@/components/services/consigneeIntelligence.service";
import { MaterialMixDonut, materialColor } from "./MaterialMixDonut";
import { MaterialEvolutionChart } from "./MaterialEvolutionChart";
import { DemandTrendChart } from "./DemandTrendChart";

export interface ConsigneeIntelligenceTarget {
  consigneeName: string;
  consigneeGst?: string | null;
}

interface ConsigneeIntelligenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ConsigneeIntelligenceTarget | null;
}

const WINDOW_OPTIONS: { value: ConsigneeIntelligenceWindow; label: string }[] = [
  { value: "90", label: "90 Days" },
  { value: "180", label: "180 Days" },
  { value: "365", label: "365 Days" },
  { value: "all", label: "All" },
];

function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return value;
  }
}

function formatMt(value: number): string {
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })} MT`;
}

function formatDays(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value} day${value === 1 ? "" : "s"}`;
}

export default function ConsigneeIntelligenceDrawer({
  open,
  onOpenChange,
  target,
}: ConsigneeIntelligenceDrawerProps) {
  const [windowKey, setWindowKey] = useState<ConsigneeIntelligenceWindow>("90");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ConsigneeIntelligenceResult | null>(null);

  useEffect(() => {
    if (!open) {
      setWindowKey("90");
      setData(null);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !target?.consigneeName.trim()) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getConsigneeIntelligence({
      consigneeName: target.consigneeName,
      consigneeGst: target.consigneeGst,
      window: windowKey,
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setData(null);
          setError(
            "Unable to load consignee intelligence. If this persists, ensure the analytics migration is applied."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, target?.consigneeName, target?.consigneeGst, windowKey]);

  const titleName = target?.consigneeName.trim() || "Consignee";
  const gst = data?.identity.gst || target?.consigneeGst || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={cn(
          "fixed inset-y-0 right-0 left-auto top-0 flex h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l p-0 sm:max-w-xl md:max-w-2xl",
          "data-open:zoom-in-100 data-closed:zoom-out-100 data-open:slide-in-from-right data-closed:slide-out-to-right"
        )}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle className="font-heading text-lg font-semibold tracking-tight">
            {titleName}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Consignee Intelligence
          </DialogDescription>
          {gst ? (
            <p className="mt-1 text-xs text-muted-foreground">GST: {gst}</p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Showing LRs for this exact consignee name.
          </p>
        </DialogHeader>

        <div className="shrink-0 border-b px-5 py-3">
          <FormSelect
            label="Analysis window"
            id="consignee-intelligence-window"
            value={windowKey}
            onValueChange={(value) => {
              if (value === "90" || value === "180" || value === "365" || value === "all") {
                setWindowKey(value);
              }
            }}
            options={WINDOW_OPTIONS}
            className="max-w-xs"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading intelligence…</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !data || data.meta.empty ? (
            <p className="text-sm text-muted-foreground">
              No completed LR history available for this consignee in the selected
              period.
            </p>
          ) : (
            <div className="space-y-8">
              {/* Material Trend — Current Mix */}
              <section className="space-y-3">
                <div>
                  <h3 className="font-heading text-base font-semibold">Material Trend</h3>
                  <p className="text-xs text-muted-foreground">
                    Material mix based on loading weight · ranked by SUM(loading weight)
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-[10rem_1fr] sm:items-center">
                  {data.materialMix.length > 0 && data.meta.totalWeight > 0 ? (
                    <MaterialMixDonut items={data.materialMix} />
                  ) : (
                    <div className="flex size-40 items-center justify-center rounded-full border border-dashed text-xs text-muted-foreground">
                      No weight
                    </div>
                  )}

                  <ul className="space-y-2">
                    {data.materialMix.length === 0 ? (
                      <li className="text-sm text-muted-foreground">
                        No material breakdown available.
                      </li>
                    ) : (
                      data.materialMix.map((item, index) => (
                        <li
                          key={item.material}
                          className="grid grid-cols-[1fr_auto_auto] items-start gap-3 text-sm"
                        >
                          <span className="flex min-w-0 items-start gap-2">
                            <span
                              className="mt-1.5 inline-block size-2.5 shrink-0 rounded-sm"
                              style={{ background: materialColor(index) }}
                            />
                            <span className="break-words">{item.material}</span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {item.percentage.toFixed(1)}%
                          </span>
                          <span className="min-w-[5.5rem] text-right tabular-nums">
                            {formatMt(item.weight)}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>

                {data.materialMix.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {data.meta.lrCount} LR{data.meta.lrCount === 1 ? "" : "s"} ·{" "}
                    {formatMt(data.meta.totalWeight)} total loading weight
                  </p>
                ) : null}
              </section>

              {/* Work Frequency */}
              <section className="space-y-3">
                <div>
                  <h3 className="font-heading text-base font-semibold">Work Frequency</h3>
                  <p className="text-xs text-muted-foreground">
                    Based on consecutive LR dates in the selected window
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <FreqStat
                    label="Last LR"
                    value={formatDisplayDate(data.frequency.lastLrDate)}
                  />
                  <FreqStat
                    label="Days since last"
                    value={formatDays(data.frequency.daysSinceLast)}
                  />
                  <FreqStat
                    label="Typical interval"
                    value={
                      data.frequency.insufficientHistory
                        ? "Insufficient history"
                        : formatDays(
                            data.frequency.typicalInterval != null
                              ? Math.round(data.frequency.typicalInterval)
                              : null
                          )
                    }
                  />
                  <FreqStat
                    label="Estimated next"
                    value={
                      data.frequency.insufficientHistory
                        ? "Insufficient history"
                        : formatDisplayDate(data.frequency.estimatedNext)
                    }
                    hint={
                      data.frequency.insufficientHistory
                        ? undefined
                        : "Estimate — not a guarantee"
                    }
                  />
                </div>

                {!data.frequency.insufficientHistory ? (
                  <p className="text-xs text-muted-foreground">
                    Average interval:{" "}
                    {formatDays(
                      data.frequency.averageInterval != null
                        ? Math.round(data.frequency.averageInterval)
                        : null
                    )}
                    {" · "}
                    Median interval:{" "}
                    {formatDays(
                      data.frequency.medianInterval != null
                        ? Math.round(data.frequency.medianInterval)
                        : null
                    )}
                  </p>
                ) : null}
              </section>

              {/* Material Evolution */}
              <section className="space-y-3">
                <div>
                  <h3 className="font-heading text-base font-semibold">
                    Material Evolution
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Monthly share of loading weight (top materials + Other)
                  </p>
                </div>
                {data.materialEvolution.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Not enough monthly history to show evolution.
                  </p>
                ) : (
                  <MaterialEvolutionChart months={data.materialEvolution} />
                )}
              </section>

              {/* Demand Trend */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="font-heading text-base font-semibold">
                      Demand Trend
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Monthly LR count and loading weight
                    </p>
                  </div>
                  <span className="rounded-md border px-2 py-1 text-xs font-medium">
                    {data.demand.direction}
                  </span>
                </div>
                {data.demand.months.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No monthly demand series available.
                  </p>
                ) : (
                  <DemandTrendChart months={data.demand.months} />
                )}
              </section>

              {/* Recent LRs */}
              <section className="space-y-3">
                <div>
                  <h3 className="font-heading text-base font-semibold">Recent LRs</h3>
                  <p className="text-xs text-muted-foreground">
                    Last 10 qualifying LRs in this window
                  </p>
                </div>
                {data.recentLrs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent LRs.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[28rem] text-left text-sm">
                      <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">LR No.</th>
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Material</th>
                          <th className="px-3 py-2 text-right font-medium">Weight</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentLrs.map((lr) => (
                          <tr key={`${lr.lrNumber}-${lr.lrDate}`} className="border-b last:border-0">
                            <td className="px-3 py-2 font-medium tabular-nums">
                              {lr.lrNumber}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {formatDisplayDate(lr.lrDate)}
                            </td>
                            <td className="px-3 py-2 break-words">{lr.material || "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatMt(lr.loadingWeight)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FreqStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium break-words">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
