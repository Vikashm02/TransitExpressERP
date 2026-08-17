"use client";

import OverviewPeriodFilter, {
  type OverviewPeriodValue,
} from "./OverviewPeriodFilter";

interface OverviewHeaderProps {
  displayName: string;
  period: OverviewPeriodValue;
  onPeriodChange: (next: OverviewPeriodValue) => void;
}

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function OverviewHeader({
  displayName,
  period,
  onPeriodChange,
}: OverviewHeaderProps) {
  const name = displayName.trim() || "there";
  const greeting = greetingForHour(new Date().getHours());

  return (
    <div className="overflow-hidden erp-panel">
      <div className="border-b border-border/80 bg-gradient-to-r from-primary/[0.07] via-card to-highlight/[0.08] px-4 py-4 sm:px-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          My work
        </p>
        <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          {greeting}, {name}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your operational activity for the selected period. Open drafts and
          pending POD stay visible until finished.
        </p>
      </div>

      <div className="p-4 sm:p-5">
        <OverviewPeriodFilter value={period} onChange={onPeriodChange} />
      </div>
    </div>
  );
}
