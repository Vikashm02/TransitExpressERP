"use client";

import { useLanguage } from "@/lib/i18n";

import OverviewPeriodFilter, {
  type OverviewPeriodValue,
} from "./OverviewPeriodFilter";

interface OverviewHeaderProps {
  displayName: string;
  period: OverviewPeriodValue;
  onPeriodChange: (next: OverviewPeriodValue) => void;
  /** Optional label above greeting (defaults to My Work). */
  titleOverride?: string;
}

function greetingKeyForHour(hour: number): string {
  if (hour < 12) return "overview.greeting.morning";
  if (hour < 17) return "overview.greeting.afternoon";
  return "overview.greeting.evening";
}

export default function OverviewHeader({
  displayName,
  period,
  onPeriodChange,
  titleOverride,
}: OverviewHeaderProps) {
  const { t } = useLanguage();
  const trimmed = displayName.trim();
  const name = trimmed || t("overview.greeting.fallbackName");
  const greeting = t(greetingKeyForHour(new Date().getHours()));

  return (
    <div className="overflow-hidden erp-panel">
      <div className="border-b border-border/80 bg-gradient-to-r from-primary/[0.07] via-card to-highlight/[0.08] px-4 py-4 sm:px-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {titleOverride ?? t("overview.myWork")}
        </p>
        <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          {greeting}, {name}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("overview.subtitle")}
        </p>
      </div>

      <div className="p-4 sm:p-5">
        <OverviewPeriodFilter value={period} onChange={onPeriodChange} />
      </div>
    </div>
  );
}
