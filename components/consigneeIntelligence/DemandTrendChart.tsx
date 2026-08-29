"use client";

import { cn } from "@/lib/utils";
import type { DemandMonth } from "@/components/services/consigneeIntelligence.service";

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  if (!y || !m) return month;
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString(undefined, { month: "short" });
}

export function DemandTrendChart({
  months,
  className,
}: {
  months: DemandMonth[];
  className?: string;
}) {
  if (months.length === 0) return null;

  const maxCount = Math.max(...months.map((m) => m.lrCount), 1);
  const maxWeight = Math.max(...months.map((m) => m.weight), 1);

  return (
    <div className={cn("space-y-4", className)}>
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Monthly LRs</p>
        <div className="flex h-28 items-end gap-1.5">
          {months.map((month) => (
            <div
              key={`lr-${month.month}`}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              <div
                className="w-full max-w-8 rounded-t-sm bg-[var(--chart-1)]"
                style={{
                  height: `${Math.max(4, (month.lrCount / maxCount) * 88)}px`,
                }}
                title={`${month.lrCount} LRs`}
              />
              <span className="truncate text-[10px] text-muted-foreground">
                {formatMonthLabel(month.month)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Monthly loading weight (MT)</p>
        <div className="flex h-28 items-end gap-1.5">
          {months.map((month) => (
            <div
              key={`wt-${month.month}`}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              <div
                className="w-full max-w-8 rounded-t-sm bg-[var(--chart-2)]"
                style={{
                  height: `${Math.max(4, (month.weight / maxWeight) * 88)}px`,
                }}
                title={`${month.weight.toFixed(3)} MT`}
              />
              <span className="truncate text-[10px] text-muted-foreground">
                {formatMonthLabel(month.month)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
