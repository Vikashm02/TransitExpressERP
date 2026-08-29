"use client";

import { cn } from "@/lib/utils";
import type { MaterialWeightTrendMonth } from "@/components/services/materialIntelligence.service";

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-");
  if (!y || !m) return month;
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString(undefined, { month: "short", year: "2-digit" });
}

function formatMtShort(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  });
}

function formatPct(month: MaterialWeightTrendMonth): string | null {
  if (month.percentageChange == null) return null;
  const sign = month.percentageChange > 0 ? "+" : "";
  return `${sign}${month.percentageChange.toFixed(1)}%`;
}

/** Monthly transported loading-weight bars with MoM change. */
export function MaterialWeightTrendChart({
  months,
  className,
}: {
  months: MaterialWeightTrendMonth[];
  className?: string;
}) {
  if (months.length === 0) return null;

  const maxWeight = Math.max(...months.map((m) => m.weight), 1);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex h-36 items-end gap-2">
        {months.map((month) => (
          <div
            key={month.month}
            className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
          >
            <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
              {formatMtShort(month.weight)}
            </span>
            <div
              className={cn(
                "w-full max-w-10 rounded-t-sm",
                month.weight > 0 ? "bg-[var(--chart-1)]" : "bg-muted"
              )}
              style={{
                height:
                  month.weight > 0
                    ? `${Math.max(4, (month.weight / maxWeight) * 104)}px`
                    : "2px",
              }}
              title={`${formatMtShort(month.weight)} MT`}
            />
            <span className="truncate text-[10px] text-muted-foreground">
              {formatMonthLabel(month.month)}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium tabular-nums",
                month.change == null
                  ? "text-muted-foreground"
                  : month.change > 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : month.change < 0
                      ? "text-red-700 dark:text-red-400"
                      : "text-muted-foreground"
              )}
            >
              {month.comparisonAvailable
                ? formatPct(month) ??
                  (month.change != null
                    ? `${month.change > 0 ? "+" : ""}${formatMtShort(month.change)}`
                    : "—")
                : "—"}
            </span>
          </div>
        ))}
      </div>

      <ul className="space-y-2 text-sm">
        {months.map((month) => (
          <li
            key={`row-${month.month}`}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0"
          >
            <span className="font-medium">{formatMonthLabel(month.month)}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatMtShort(month.weight)} MT · {month.lrCount} LR
              {month.lrCount === 1 ? "" : "s"}
              {month.comparisonAvailable && month.change != null ? (
                <>
                  {" · "}
                  <span
                    className={
                      month.change > 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : month.change < 0
                          ? "text-red-700 dark:text-red-400"
                          : undefined
                    }
                  >
                    {month.change > 0 ? "↑ " : month.change < 0 ? "↓ " : ""}
                    {month.change > 0 ? "+" : ""}
                    {formatMtShort(month.change)} MT
                    {formatPct(month) ? ` (${formatPct(month)})` : ""}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {" · "}First period in window
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
