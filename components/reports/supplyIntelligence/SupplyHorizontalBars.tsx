"use client";

import { cn } from "@/lib/utils";
import { materialColor } from "@/components/consigneeIntelligence/MaterialMixDonut";

export interface SupplyBarItem {
  label: string;
  weight: number;
  percentage: number;
}

function formatMt(value: number): string {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 3,
  })} MT`;
}

/** Horizontal bars for top consignees / materials by transported weight. */
export function SupplyHorizontalBars({
  items,
  className,
}: {
  items: SupplyBarItem[];
  className?: string;
}) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.weight), 1);

  return (
    <div className={cn("space-y-2.5", className)}>
      {items.map((item, index) => (
        <div key={item.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium">{item.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatMt(item.weight)} · {item.percentage.toFixed(1)}% of weight
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (item.weight / max) * 100)}%`,
                background: materialColor(index),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
