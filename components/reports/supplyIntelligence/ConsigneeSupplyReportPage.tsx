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
import { MaterialEvolutionChart } from "@/components/consigneeIntelligence/MaterialEvolutionChart";
import { MaterialWeightTrendChart } from "@/components/materialIntelligence/MaterialWeightTrendChart";
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

export default function ConsigneeSupplyReportPage() {
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
        "Unable to load Consignee Supply. If this persists, ensure migration 057 is applied."
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filters);
    // initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topConsignees = useMemo(() => {
    if (!data) return [];
    return data.topConsignees.items.slice(0, topN === "5" ? 5 : 10);
  }, [data, topN]);

  const evolutionMonths = useMemo(() => {
    if (!data?.consigneeDetail) return [];
    return data.consigneeDetail.shareTrend.map((month) => ({
      month: month.month,
      totalWeight: month.totalWeight,
      shares: month.shares.map((s) => ({
        material: s.material ?? "Unknown",
        weight: s.weight,
        percentage: s.percentage,
      })),
    }));
  }, [data]);

  function selectConsignee(name: string) {
    const next = { ...applied, consignee: name };
    setFilters(next);
    void load(next);
  }

  function selectMaterial(name: string) {
    const next = { ...applied, material: name };
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
          Consignee Supply
        </h1>
        <p className="text-sm text-muted-foreground">
          Supply Intelligence — who receives material, how much (by loading
          weight), and how preferences change over time.
        </p>
        <p className="text-xs text-muted-foreground">
          Cross-view:{" "}
          <Link
            href="/reports/supply-intelligence/material"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Material Supply
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
              valuePresentation="number"
            />
            <StatCard
              title="Total LRs"
              value={data.overview.lrCount}
              valuePresentation="number"
            />
            <StatCard
              title="Unique consignees"
              value={data.overview.uniqueConsignees}
              valuePresentation="number"
            />
            <StatCard
              title="Unique materials"
              value={data.overview.uniqueMaterials}
              valuePresentation="number"
            />
            <StatCard
              title="Avg weight / LR"
              value={
                data.overview.avgWeightPerLr == null
                  ? "—"
                  : formatMt(data.overview.avgWeightPerLr)
              }
              valuePresentation="number"
            />
            <StatCard
              title="Top consignee"
              value={data.overview.topConsignee?.name ?? "—"}
              subtitle={
                data.overview.topConsignee
                  ? formatMt(data.overview.topConsignee.weight)
                  : undefined
              }
              valuePresentation="text"
            />
            <StatCard
              title="Top material"
              value={data.overview.topMaterial?.name ?? "—"}
              subtitle={
                data.overview.topMaterial
                  ? formatMt(data.overview.topMaterial.weight)
                  : undefined
              }
              valuePresentation="text"
            />
            <StatCard
              title="Period"
              value={formatDisplayDate(data.overview.periodFrom)}
              subtitle={`to ${formatDisplayDate(data.overview.periodTo)}`}
              valuePresentation="text"
            />
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-heading text-base font-semibold">
                  Top Consignees
                </h2>
                <p className="text-xs text-muted-foreground">
                  Ranked by transported loading weight
                </p>
              </div>
              <FormSelect
                label="Show"
                id="consignee-top-n"
                value={topN}
                onValueChange={(v) => {
                  if (v === "5" || v === "10") setTopN(v);
                }}
                options={TOP_N_OPTIONS}
                className="w-28"
              />
            </div>

            <SupplyHorizontalBars
              items={topConsignees.map((row) => ({
                label: row.consignee,
                weight: row.weight,
                percentage: row.percentage,
              }))}
            />

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Rank</th>
                    <th className="px-3 py-2 font-medium">Consignee</th>
                    <th className="px-3 py-2 text-right font-medium">Weight</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Weight share
                    </th>
                    <th className="px-3 py-2 text-right font-medium">LRs</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Avg / LR
                    </th>
                    <th className="px-3 py-2 font-medium">Top material</th>
                  </tr>
                </thead>
                <tbody>
                  {topConsignees.map((row) => (
                    <tr key={row.consignee} className="border-b last:border-0">
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
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {row.avgWeightPerLr == null
                          ? "—"
                          : formatMt(row.avgWeightPerLr)}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left text-primary underline-offset-2 hover:underline"
                          onClick={() => selectMaterial(row.topMaterial)}
                        >
                          {row.topMaterial || "—"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.consigneeDetail ? (
            <>
              <section className="space-y-3">
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    Material mix — {data.consigneeDetail.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Share of transported loading weight received by this
                    consignee
                  </p>
                </div>
                {data.consigneeDetail.preference ? (
                  <p className="text-sm text-muted-foreground">
                    Primary material by historical weight:{" "}
                    <span className="font-medium text-foreground">
                      {data.consigneeDetail.preference.topMaterial}
                    </span>{" "}
                    ({data.consigneeDetail.preference.topShare.toFixed(1)}% of
                    weight
                    {data.consigneeDetail.preference.secondMaterial
                      ? `; next: ${data.consigneeDetail.preference.secondMaterial}`
                      : ""}
                    ).{" "}
                    {data.consigneeDetail.preference.distinctMaterials} distinct
                    materials in period.
                  </p>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-[10rem_1fr] sm:items-center">
                  {data.consigneeDetail.materialMix.length > 0 ? (
                    <MaterialMixDonut
                      items={data.consigneeDetail.materialMix}
                    />
                  ) : (
                    <div className="flex size-40 items-center justify-center rounded-full border border-dashed text-xs text-muted-foreground">
                      No mix
                    </div>
                  )}
                  <ul className="space-y-2">
                    {data.consigneeDetail.materialMix.map((item, index) => (
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
                          {item.percentage.toFixed(1)}%
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
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    Material share trend
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Monthly share of loading weight (top materials + Other) ·
                    zero-activity months included
                  </p>
                </div>
                {evolutionMonths.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No monthly share series.
                  </p>
                ) : (
                  <MaterialEvolutionChart months={evolutionMonths} />
                )}
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    Weight trend
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Monthly total loading weight for this consignee filter
                  </p>
                </div>
                {data.weightTrend.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No monthly weight series.
                  </p>
                ) : (
                  <MaterialWeightTrendChart months={data.weightTrend} />
                )}
              </section>
            </>
          ) : (
            <section className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Select a consignee from the ranking (or the Consignee filter) to
              see material mix, preference, and share trends for that party.
            </section>
          )}

          {data.insights.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="font-heading text-base font-semibold">
                  Insights
                </h2>
                <p className="text-xs text-muted-foreground">
                  Historical facts from the selected period only
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
