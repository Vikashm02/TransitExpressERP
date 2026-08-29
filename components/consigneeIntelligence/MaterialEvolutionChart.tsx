"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import type { MaterialEvolutionMonth } from "@/components/services/consigneeIntelligence.service";
import { materialColor } from "./MaterialMixDonut";

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  if (!y || !m) return month;
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString(undefined, { month: "short", year: "2-digit" });
}

/** Stacked horizontal bars of monthly material share (%). */
export function MaterialEvolutionChart({
  months,
  className,
}: {
  months: MaterialEvolutionMonth[];
  className?: string;
}) {
  const materials = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const month of months) {
      for (const share of month.shares) {
        if (!seen.has(share.material)) {
          seen.add(share.material);
          order.push(share.material);
        }
      }
    }
    // Keep Other last.
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
            month.shares.map((s) => [s.material, s.percentage] as const)
          );
          return (
            <div key={month.month} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
              <div className="text-xs text-muted-foreground tabular-nums">
                {formatMonthLabel(month.month)}
              </div>
              <div className="flex h-5 w-full overflow-hidden rounded-md bg-muted/60">
                {materials.map((material, index) => {
                  const pct = shareMap.get(material) ?? 0;
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={material}
                      title={`${material}: ${pct}%`}
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
          );
        })}
      </div>
    </div>
  );
}
