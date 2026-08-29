"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import type {
  ProductDemandInsight,
  ProductDemandMonth,
} from "@/components/services/consigneeIntelligence.service";
import { materialColor } from "./MaterialMixDonut";

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  if (!y || !m) return month;
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString(undefined, { month: "short", year: "2-digit" });
}

export function ProductDemandChart({
  months,
  insights,
  className,
}: {
  months: ProductDemandMonth[];
  insights: ProductDemandInsight[];
  className?: string;
}) {
  const materials = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const month of months) {
      for (const item of month.materials) {
        if (!seen.has(item.material)) {
          seen.add(item.material);
          order.push(item.material);
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
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {materials.map((material, index) => (
          <span key={material} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-sm"
              style={{ background: materialColor(index) }}
            />
            <span className="max-w-[10rem] truncate">{material}</span>
          </span>
        ))}
      </div>

      <div className="space-y-2">
        {months.map((month) => {
          const shareMap = new Map(
            month.materials.map((s) => [s.material, s] as const)
          );
          return (
            <div key={month.month} className="space-y-1">
              <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
                <div className="text-xs text-muted-foreground tabular-nums">
                  {formatMonthLabel(month.month)}
                </div>
                <div className="flex h-5 w-full overflow-hidden rounded-md bg-muted/60">
                  {materials.map((material, index) => {
                    const share = shareMap.get(material);
                    const pct = share?.percentage ?? 0;
                    if (pct <= 0) return null;
                    return (
                      <div
                        key={material}
                        title={`${material}: ${share?.lrCount ?? 0}/${month.lrCount} (${pct}%)`}
                        style={{
                          width: `${pct}%`,
                          background: materialColor(index),
                        }}
                        className="h-full min-w-0"
                      />
                    );
                  })}
                </div>
              </div>
              <ul className="ml-[4.5rem] space-y-0.5 text-[11px] text-muted-foreground">
                {month.lrCount === 0 ? (
                  <li>No LRs in this month</li>
                ) : (
                  month.materials.map((item) => (
                    <li key={`${month.month}-${item.material}`} className="flex justify-between gap-2">
                      <span className="min-w-0 break-words">{item.material}</span>
                      <span className="shrink-0 tabular-nums">
                        {item.lrCount}/{month.lrCount} · {item.percentage.toFixed(1)}%
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          );
        })}
      </div>

      {insights.length > 0 ? (
        <ul className="space-y-1.5 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
          {insights.map((insight) => (
            <li key={`${insight.material}-${insight.message}`}>
              {insight.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
