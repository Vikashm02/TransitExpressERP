"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import type { MaterialConsigneeTrendMonth } from "@/components/services/materialIntelligence.service";
import { materialColor } from "@/components/consigneeIntelligence/MaterialMixDonut";

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  if (!y || !m) return month;
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString(undefined, { month: "short", year: "2-digit" });
}

/** Stacked monthly bars: top consignees' share of selected material weight. */
export function MaterialConsigneeTrendChart({
  months,
  className,
}: {
  months: MaterialConsigneeTrendMonth[];
  className?: string;
}) {
  const consignees = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const month of months) {
      for (const share of month.consignees) {
        if (!seen.has(share.consignee)) {
          seen.add(share.consignee);
          order.push(share.consignee);
        }
      }
    }
    order.sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return 0;
    });
    return order;
  }, [months]);

  if (months.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {consignees.map((name, index) => (
          <span key={name} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-sm"
              style={{ background: materialColor(index) }}
            />
            <span className="max-w-[10rem] truncate">{name}</span>
          </span>
        ))}
      </div>

      <div className="space-y-2">
        {months.map((month) => {
          const shareMap = new Map(
            month.consignees.map((s) => [s.consignee, s.percentage] as const)
          );
          const weightMap = new Map(
            month.consignees.map((s) => [s.consignee, s.weight] as const)
          );
          return (
            <div
              key={month.month}
              className="grid grid-cols-[4.5rem_1fr] items-center gap-2"
            >
              <div className="text-xs text-muted-foreground tabular-nums">
                {formatMonthLabel(month.month)}
              </div>
              <div className="flex h-5 w-full overflow-hidden rounded-md bg-muted/60">
                {month.totalWeight <= 0 ? null : (
                  consignees.map((name, index) => {
                    const pct = shareMap.get(name) ?? 0;
                    if (pct <= 0) return null;
                    const wt = weightMap.get(name) ?? 0;
                    return (
                      <div
                        key={name}
                        title={`${name}: ${wt} MT (${pct}%)`}
                        style={{
                          width: `${pct}%`,
                          background: materialColor(index),
                        }}
                        className="h-full min-w-0"
                      />
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
