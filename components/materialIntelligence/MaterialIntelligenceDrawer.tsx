"use client";

import { useEffect, useMemo, useState } from "react";
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
  getMaterialIntelligence,
  type MaterialIntelligenceResult,
  type MaterialIntelligenceWindow,
  type MaterialTopConsignee,
} from "@/components/services/materialIntelligence.service";
import {
  MaterialMixDonut,
  materialColor,
} from "@/components/consigneeIntelligence/MaterialMixDonut";
import { MaterialEvolutionChart } from "@/components/consigneeIntelligence/MaterialEvolutionChart";
import { MaterialWeightTrendChart } from "./MaterialWeightTrendChart";
import { MaterialConsigneeTrendChart } from "./MaterialConsigneeTrendChart";

export interface MaterialIntelligenceTarget {
  materialName: string;
}

interface MaterialIntelligenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: MaterialIntelligenceTarget | null;
  /** Open existing Consignee Intelligence for a name from this drawer. */
  onOpenConsignee?: (consigneeName: string) => void;
}

const WINDOW_OPTIONS: { value: MaterialIntelligenceWindow; label: string }[] = [
  { value: "90", label: "90 Days" },
  { value: "180", label: "180 Days" },
  { value: "365", label: "365 Days" },
  { value: "all", label: "All" },
];

const TOP_N_OPTIONS = [
  { value: "5", label: "Top 5" },
  { value: "10", label: "Top 10" },
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

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-base font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function buildTopDisplay(
  data: MaterialIntelligenceResult,
  topN: 5 | 10
): { rows: MaterialTopConsignee[]; otherWeight: number; otherPct: number; otherLr: number; otherCount: number } {
  const items = data.topConsignees.items;
  const head = items.slice(0, topN);
  const tail = items.slice(topN);
  let otherWeight = tail.reduce((sum, row) => sum + row.weight, 0);
  let otherLr = tail.reduce((sum, row) => sum + row.lrCount, 0);
  let otherCount = tail.length;
  if (data.topConsignees.other) {
    otherWeight += data.topConsignees.other.weight;
    otherLr += data.topConsignees.other.lrCount;
    otherCount += data.topConsignees.other.consigneeCount;
  }
  const total = data.overview.totalWeight;
  const otherPct = total > 0 ? Math.round((otherWeight / total) * 1000) / 10 : 0;
  return { rows: head, otherWeight, otherPct, otherLr, otherCount };
}

export default function MaterialIntelligenceDrawer({
  open,
  onOpenChange,
  target,
  onOpenConsignee,
}: MaterialIntelligenceDrawerProps) {
  const [windowKey, setWindowKey] = useState<MaterialIntelligenceWindow>("90");
  const [topN, setTopN] = useState<"5" | "10">("10");
  const [focusConsignee, setFocusConsignee] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MaterialIntelligenceResult | null>(null);

  useEffect(() => {
    if (!open) {
      setWindowKey("90");
      setTopN("10");
      setFocusConsignee(null);
      setData(null);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !target?.materialName.trim()) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getMaterialIntelligence({
      materialName: target.materialName,
      window: windowKey,
      focusConsignee,
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setData(null);
          setError(
            "Unable to load material intelligence. If this persists, ensure migration 055 is applied."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, target?.materialName, windowKey, focusConsignee]);

  const titleName = target?.materialName.trim() || "Material";

  const topDisplay = useMemo(() => {
    if (!data || data.meta.empty) return null;
    return buildTopDisplay(data, topN === "5" ? 5 : 10);
  }, [data, topN]);

  const focusOptions = useMemo(() => {
    if (!data) return [];
    const names = data.topConsignees.items.map((row) => row.consignee);
    if (
      data.focusConsignee.name &&
      !names.includes(data.focusConsignee.name)
    ) {
      names.unshift(data.focusConsignee.name);
    }
    return names.map((name) => ({ value: name, label: name }));
  }, [data]);

  const evolutionMonths = useMemo(() => {
    if (!data) return [];
    return data.focusConsignee.shareTrend.map((month) => ({
      month: month.month,
      totalWeight: month.totalWeight,
      shares: month.shares,
    }));
  }, [data]);

  function handleConsigneeNameClick(name: string) {
    if (!name || name === "Other") return;
    if (onOpenConsignee) {
      onOpenConsignee(name);
      return;
    }
    setFocusConsignee(name);
  }

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
            Material Intelligence
          </DialogDescription>
          <p className="mt-2 text-xs text-muted-foreground">
            Transported volume by loading weight · exact material name on LR
          </p>
        </DialogHeader>

        <div className="shrink-0 space-y-3 border-b px-5 py-3">
          <FormSelect
            label="Analysis window"
            id="material-intelligence-window"
            value={windowKey}
            onValueChange={(value) => {
              if (
                value === "90" ||
                value === "180" ||
                value === "365" ||
                value === "all"
              ) {
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
              No completed LR history available for this material in the selected
              period.
            </p>
          ) : (
            <div className="space-y-8">
              {/* Overview */}
              <section className="space-y-3">
                <div>
                  <h3 className="font-heading text-base font-semibold">Overview</h3>
                  <p className="text-xs text-muted-foreground">
                    All metrics use the selected analysis window · weight =
                    loading weight
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <StatCard
                    label="Total weight"
                    value={formatMt(data.overview.totalWeight)}
                  />
                  <StatCard
                    label="LR count"
                    value={String(data.overview.lrCount)}
                  />
                  <StatCard
                    label="Avg weight / LR"
                    value={
                      data.overview.avgWeightPerLr == null
                        ? "—"
                        : formatMt(data.overview.avgWeightPerLr)
                    }
                  />
                  <StatCard
                    label="Unique consignees"
                    value={String(data.overview.uniqueConsignees)}
                  />
                  <StatCard
                    label="Period from"
                    value={formatDisplayDate(data.overview.periodFrom)}
                    hint="Analysis window start"
                  />
                  <StatCard
                    label="Period to"
                    value={formatDisplayDate(data.overview.periodTo)}
                    hint="Analysis window end"
                  />
                </div>
              </section>

              {/* Top Consignees */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="font-heading text-base font-semibold">
                      Top Consignees
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Ranked by transported loading weight for this material
                    </p>
                  </div>
                  <FormSelect
                    label="Show"
                    id="material-intelligence-top-n"
                    value={topN}
                    onValueChange={(value) => {
                      if (value === "5" || value === "10") setTopN(value);
                    }}
                    options={TOP_N_OPTIONS}
                    className="w-28"
                  />
                </div>

                {!topDisplay || topDisplay.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No consignee breakdown available.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[28rem] text-left text-sm">
                      <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Rank</th>
                          <th className="px-3 py-2 font-medium">Consignee</th>
                          <th className="px-3 py-2 text-right font-medium">Weight</th>
                          <th className="px-3 py-2 text-right font-medium">Share</th>
                          <th className="px-3 py-2 text-right font-medium">LRs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topDisplay.rows.map((row) => (
                          <tr key={row.consignee} className="border-b last:border-0">
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {row.rank}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="text-left font-medium text-primary underline-offset-2 hover:underline"
                                onClick={() => handleConsigneeNameClick(row.consignee)}
                              >
                                {row.consignee}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatMt(row.weight)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {row.percentage.toFixed(1)}%
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {row.lrCount}
                            </td>
                          </tr>
                        ))}
                        {topDisplay.otherWeight > 0 ? (
                          <tr className="border-b bg-muted/20 last:border-0">
                            <td className="px-3 py-2 text-muted-foreground">—</td>
                            <td className="px-3 py-2 text-muted-foreground">
                              Other
                              {topDisplay.otherCount > 0
                                ? ` (${topDisplay.otherCount})`
                                : ""}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatMt(topDisplay.otherWeight)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {topDisplay.otherPct.toFixed(1)}%
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {topDisplay.otherLr}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Material Weight Trend */}
              <section className="space-y-3">
                <div>
                  <h3 className="font-heading text-base font-semibold">
                    Material Weight Trend
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Monthly loading weight for this material · zero-activity months
                    included
                  </p>
                </div>
                {data.weightTrend.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No monthly weight series available.
                  </p>
                ) : (
                  <MaterialWeightTrendChart months={data.weightTrend} />
                )}
              </section>

              {/* Material × Consignee Trend */}
              <section className="space-y-3">
                <div>
                  <h3 className="font-heading text-base font-semibold">
                    Material × Consignee Trend
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Who drives monthly volume — top 5 consignees by weight + Other
                  </p>
                </div>
                {data.consigneeTrend.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No consignee trend series available.
                  </p>
                ) : (
                  <MaterialConsigneeTrendChart months={data.consigneeTrend} />
                )}
              </section>

              {/* Consignee material mix (focus) */}
              <section className="space-y-3">
                <div>
                  <h3 className="font-heading text-base font-semibold">
                    Consignee Material Mix
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Weight share of all materials received by the focus consignee
                  </p>
                </div>

                {focusOptions.length > 0 ? (
                  <FormSelect
                    label="Focus consignee"
                    id="material-intelligence-focus"
                    value={data.focusConsignee.name || focusOptions[0]?.value || ""}
                    onValueChange={(value) => setFocusConsignee(value)}
                    options={focusOptions}
                    className="max-w-md"
                  />
                ) : null}

                {data.focusConsignee.name ? (
                  <p className="text-xs text-muted-foreground">
                    Focus:{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() =>
                        handleConsigneeNameClick(data.focusConsignee.name)
                      }
                    >
                      {data.focusConsignee.name}
                    </button>
                    {data.focusConsignee.selectedMaterialShare ? (
                      <>
                        {" · "}
                        {titleName} is{" "}
                        {data.focusConsignee.selectedMaterialShare.percentage.toFixed(
                          1
                        )}
                        % of their mix (
                        {formatMt(data.focusConsignee.selectedMaterialShare.weight)}
                        )
                      </>
                    ) : null}
                  </p>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-[10rem_1fr] sm:items-center">
                  {data.focusConsignee.materialMix.length > 0 ? (
                    <MaterialMixDonut items={data.focusConsignee.materialMix} />
                  ) : (
                    <div className="flex size-40 items-center justify-center rounded-full border border-dashed text-xs text-muted-foreground">
                      No mix
                    </div>
                  )}
                  <ul className="space-y-2">
                    {data.focusConsignee.materialMix.length === 0 ? (
                      <li className="text-sm text-muted-foreground">
                        No material mix for this consignee in the window.
                      </li>
                    ) : (
                      data.focusConsignee.materialMix.map((item, index) => (
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
              </section>

              {/* Material share trend for focus consignee */}
              <section className="space-y-3">
                <div>
                  <h3 className="font-heading text-base font-semibold">
                    Material Share Trend
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    How the focus consignee&apos;s material mix (by loading weight)
                    shifts month to month
                  </p>
                </div>
                {evolutionMonths.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Not enough monthly history to show share trend.
                  </p>
                ) : (
                  <MaterialEvolutionChart months={evolutionMonths} />
                )}
              </section>

              {/* Insights */}
              <section className="space-y-3">
                <div>
                  <h3 className="font-heading text-base font-semibold">Insights</h3>
                  <p className="text-xs text-muted-foreground">
                    Derived only when the data supports the statement
                  </p>
                </div>
                {data.insights.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No supported insights for this window yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.insights.map((insight) => (
                      <li
                        key={insight.id}
                        className="rounded-lg border bg-muted/20 px-3 py-2.5 text-sm leading-relaxed"
                      >
                        {insight.message}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Recent LRs */}
              <section className="space-y-3">
                <div>
                  <h3 className="font-heading text-base font-semibold">
                    Relevant LRs
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Latest qualifying LRs for this material in the window
                  </p>
                </div>
                {data.recentLrs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent LRs.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[32rem] text-left text-sm">
                      <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">LR No.</th>
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Consignee</th>
                          <th className="px-3 py-2 font-medium">Material</th>
                          <th className="px-3 py-2 text-right font-medium">Weight</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentLrs.map((lr) => (
                          <tr
                            key={`${lr.lrNumber}-${lr.lrDate}`}
                            className="border-b last:border-0"
                          >
                            <td className="px-3 py-2 font-medium">{lr.lrNumber}</td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {formatDisplayDate(lr.lrDate)}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="text-left text-primary underline-offset-2 hover:underline"
                                onClick={() =>
                                  handleConsigneeNameClick(lr.consignee)
                                }
                              >
                                {lr.consignee}
                              </button>
                            </td>
                            <td className="px-3 py-2">{lr.material}</td>
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
