"use client";

import { cn } from "@/lib/utils";
import type { MaterialMixItem } from "@/components/services/consigneeIntelligence.service";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
];

export function materialColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!;
}

/** Donut chart from ranked mix (percentages are source of truth). */
export function MaterialMixDonut({
  items,
  className,
}: {
  items: MaterialMixItem[];
  className?: string;
}) {
  const size = 160;
  const stroke = 28;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = items.map((item, index) => {
    const length = (Math.max(0, item.percentage) / 100) * circumference;
    const segment = {
      color: materialColor(index),
      dasharray: `${length} ${circumference - length}`,
      dashoffset: -offset,
    };
    offset += length;
    return segment;
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn("mx-auto size-40 shrink-0", className)}
      role="img"
      aria-label="Material mix donut chart"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
      />
      {segments.map((segment, index) => (
        <circle
          key={index}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={segment.color}
          strokeWidth={stroke}
          strokeDasharray={segment.dasharray}
          strokeDashoffset={segment.dashoffset}
          strokeLinecap="butt"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ))}
    </svg>
  );
}
