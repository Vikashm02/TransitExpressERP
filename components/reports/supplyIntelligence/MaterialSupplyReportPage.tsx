"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

import StatCard from "@/components/ui/StatCard";
import FormSelect from "@/components/ui/FormSelect";
import {
  getSupplyIntelligence,
  type SupplyIntelligenceResult,
} from "@/components/services/supplyIntelligence.service";
import {
  MaterialMixDonut,
  materialColor,
} from "@/components/consigneeIntelligence/MaterialMixDonut";
import { MaterialWeightTrendChart } from "@/components/materialIntelligence/MaterialWeightTrendChart";
import { MaterialConsigneeTrendChart } from "@/components/materialIntelligence/MaterialConsigneeTrendChart";
import SupplyIntelligenceFilterBar, {
  type SupplyFilterState,
} from "./SupplyIntelligenceFilterBar";
import { SupplyHorizontalBars } from "./SupplyHorizontalBars";

function formatMt(value: number): string {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 3,
  })} MT`;
}

function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return value;
  }
}

const TOP_N_OPTIONS = [
  { value: "5", label: "Top 5" },
  { value: "10", label: "Top 10" },
];

export default function MaterialSupplyReportPage() {
  const [filters, setFilters] = useState<SupplyFilterState>({
    window: "90",
    fromDate: "",
    toDate: "",
    material: "",
    consignee: "",
  });
  const [applied, setApplied] = useState(filters);
  const [topN, setTopN] = useState<"5" | "10">("10");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SupplyIntelligenceResult | null>(null);

  const load = useCallback(async (next: SupplyFilterState) => {
    setLoading(true);
    try {
      const result = await getSupplyIntelligence({
        window: next.window,
        fromDate: next.fromDate || null,
        toDate: next.toDate || null,
        material: next.material || null,
        consignee: next.consignee || null,
      });
      setData(result);
      setApplied(next);
    } catch (error) {
      console.error(error);
      toast.error(
        "Unable to load Material Supply. If this persists, ensure migration 057 is applied."
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topMaterials = useMemo(() => {
    if (!data) return [];
    return data.topMaterials.items.slice(0, topN === "5" ? 5 : 10);
  }, [data, topN]);

  const consigneeTrendMonths = useMemo(() => {
    if (!data?.materialDetail) return [];
    return data.materialDetail.consigneeTrend.map((month) => ({
      month: month.month,
      totalWeight: month.totalWeight,
      consignees: month.shares.map((s) => ({
        consignee: s.consignee ?? "Unknown",
        weight: s.weight,
        percentage: s.percentage,
      })),
    }));
  }, [data]);

  function selectMaterial(name: string) {
    const next = { ...applied, material: name };
    setFilters(next);
    void load(next);
  }

  function selectConsignee(name: string) {
    const next = { ...applied, consignee: name };
    setFilters(next);
    void load(next);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Reports
        </Link>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Material Supply
        </h1>
        <p className="text-sm text-muted-foreground">
          Supply Intelligence — which materials move most (by loading weight),
          who consumes them, and how that changes month to month.
        </p>
        <p className="text-xs text-muted-foreground">
          Cross-view:{" "}
          <Link
            href="/reports/supply-intelligence/consignee"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Consignee Supply
          </Link>
        </p>
      </div>

      <SupplyIntelligenceFilterBar
        value={filters}
        materials={data?.filterOptions.materials ?? []}
        consignees={data?.filterOptions.consignees ?? []}
        loading={loading}
        onChange={setFilters}
        onApply={() => void load(filters)}
      />

      {loading && !data ? (
        <p className="text-sm text-muted-foreground">Loading supply analytics…</p>
      ) : !data || data.meta.empty ? (
        <p className="text-sm text-muted-foreground">
          No qualifying LRs in the selected period
          {applied.material ? ` for material “${applied.material}”` : ""}
          {applied.consignee ? ` for consignee “${applied.consignee}”` : ""}.
        </p>
      ) : (
        <div className="space-y-8">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              title="Total weight"
              value={formatMt(data.overview.totalWeight)}
              subtitle="Transported loading weight"
            />
            <StatCard title="Total LRs" value={data.overview.lrCount} />
            <StatCard
              title="Unique materials"
              value={data.overview.uniqueMaterials}
            />
            <StatCard
              title="Unique consignees"
              value={data.overview.uniqueConsignees}
            />
            <StatCard
              title="Avg weight / LR"
              value={
                data.overview.avgWeightPerLr == null
                  ? "—"
                  : formatMt(data.overview.avgWeightPerLr)
              }
            />
            <StatCard
              title="Top material"
              value={data.overview.topMaterial?.name ?? "—"}
              subtitle={
                data.overview.topMaterial
                  ? formatMt(data.overview.topMaterial.weight)
                  : undefined
              }
            />
            <StatCard
              title="Top consignee"
              value={data.overview.topConsignee?.name ?? "—"}
              subtitle={
                data.overview.topConsignee
                  ? formatMt(data.overview.topConsignee.weight)
                  : undefined
              }
            />
            <StatCard
              title="Period"
              value={formatDisplayDate(data.overview.periodFrom)}
              subtitle={`to ${formatDisplayDate(data.overview.periodTo)}`}
            />
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="font-heading text-base font-semibold">
                Material portfolio
              </h2>
              <p className="text-xs text-muted-foreground">
                Share of total transported loading weight by material
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr] sm:items-center">
              {data.materialPortfolio.length > 0 ? (
                <MaterialMixDonut items={data.materialPortfolio} />
              ) : (
                <div className="flex size-40 items-center justify-center rounded-full border border-dashed text-xs text-muted-foreground">
                  No mix
                </div>
              )}
              <ul className="space-y-2">
                {data.materialPortfolio.map((item, index) => (
                  <li
                    key={item.material}
                    className="grid grid-cols-[1fr_auto_auto] gap-3 text-sm"
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className="mt-1.5 size-2.5 shrink-0 rounded-sm"
                        style={{ background: materialColor(index) }}
                      />
                      <button
                        type="button"
                        className="text-left text-primary underline-offset-2 hover:underline"
                        onClick={() => selectMaterial(item.material)}
                      >
                        {item.material}
                      </button>
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {item.percentage.toFixed(1)}% of weight
                    </span>
                    <span className="min-w-[5.5rem] text-right tabular-nums">
                      {formatMt(item.weight)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-heading text-base font-semibold">
                  Top Materials
                </h2>
                <p className="text-xs text-muted-foreground">
                  Ranked by transported loading weight
                </p>
              </div>
              <FormSelect
                label="Show"
                id="material-top-n"
                value={topN}
                onValueChange={(v) => {
                  if (v === "5" || v === "10") setTopN(v);
                }}
                options={TOP_N_OPTIONS}
                className="w-28"
              />
            </div>

            <SupplyHorizontalBars
              items={topMaterials.map((row) => ({
                label: row.material,
                weight: row.weight,
                percentage: row.percentage,
              }))}
            />

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Rank</th>
                    <th className="px-3 py-2 font-medium">Material</th>
                    <th className="px-3 py-2 text-right font-medium">Weight</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Weight share
                    </th>
                    <th className="px-3 py-2 text-right font-medium">LRs</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Avg / LR
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Consignees
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topMaterials.map((row) => (
                    <tr key={row.material} className="border-b last:border-0">
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {row.rank}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => selectMaterial(row.material)}
                        >
                          {row.material}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMt(row.weight)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {row.percentage.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.lrCount}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {row.avgWeightPerLr == null
                          ? "—"
                          : formatMt(row.avgWeightPerLr)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.uniqueConsignees}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.materialDetail ? (
            <>
              <section className="space-y-3">
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    Consignee distribution — {data.materialDetail.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Who receives this material (loading weight share)
                  </p>
                </div>
                {data.materialDetail.concentration ? (
                  <p className="text-sm text-muted-foreground">
                    Top consignee{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() =>
                        selectConsignee(
                          data.materialDetail!.concentration!.topConsignee
                        )
                      }
                    >
                      {data.materialDetail.concentration.topConsignee}
                    </button>{" "}
                    holds{" "}
                    {data.materialDetail.concentration.topShare.toFixed(1)}% of
                    weight ({formatMt(data.materialDetail.concentration.topWeight)}
                    ). Top 3:{" "}
                    {data.materialDetail.concentration.top3Share.toFixed(1)}% ·
                    Top 5:{" "}
                    {data.materialDetail.concentration.top5Share.toFixed(1)}% ·{" "}
                    {data.materialDetail.concentration.consigneeCount}{" "}
                    consignees total.
                  </p>
                ) : null}
                <SupplyHorizontalBars
                  items={data.materialDetail.consigneeDistribution.items.map(
                    (row) => ({
                      label: row.consignee,
                      weight: row.weight,
                      percentage: row.percentage,
                    })
                  )}
                />
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[28rem] text-left text-sm">
                    <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Rank</th>
                        <th className="px-3 py-2 font-medium">Consignee</th>
                        <th className="px-3 py-2 text-right font-medium">
                          Weight
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Share
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          LRs
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.materialDetail.consigneeDistribution.items.map(
                        (row) => (
                          <tr
                            key={row.consignee}
                            className="border-b last:border-0"
                          >
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {row.rank}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="text-left font-medium text-primary underline-offset-2 hover:underline"
                                onClick={() => selectConsignee(row.consignee)}
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
                            <td className="px-3 py-2 text-right tabular-nums">
                              {row.lrCount}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    Material weight trend
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Monthly loading weight · zero-activity months included
                  </p>
                </div>
                {(data.materialDetail.weightTrend.length > 0
                  ? data.materialDetail.weightTrend
                  : data.weightTrend
                ).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No monthly weight series.
                  </p>
                ) : (
                  <MaterialWeightTrendChart
                    months={
                      data.materialDetail.weightTrend.length > 0
                        ? data.materialDetail.weightTrend
                        : data.weightTrend
                    }
                  />
                )}
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    Material × Consignee trend
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Top 5 consignees by weight + Other over calendar months
                  </p>
                </div>
                {consigneeTrendMonths.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No consignee trend series.
                  </p>
                ) : (
                  <MaterialConsigneeTrendChart months={consigneeTrendMonths} />
                )}
              </section>
            </>
          ) : (
            <section className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Select a material from the portfolio or ranking to see consignee
              distribution, concentration, and trends for that material.
            </section>
          )}

          {data.insights.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="font-heading text-base font-semibold">
                  Demand signals
                </h2>
                <p className="text-xs text-muted-foreground">
                  Historical facts from the selected period only — not forecasts
                </p>
              </div>
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
            </section>
          ) : null}

          <section className="space-y-3">
            <div>
              <h2 className="font-heading text-base font-semibold">
                Supporting LRs
              </h2>
              <p className="text-xs text-muted-foreground">
                Latest qualifying LRs in this filter
              </p>
            </div>
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
                      <td className="px-3 py-2">{lr.consignee}</td>
                      <td className="px-3 py-2">{lr.material}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMt(lr.loadingWeight)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
