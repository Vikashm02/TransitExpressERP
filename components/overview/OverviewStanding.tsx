"use client";

import type {
  OverviewOpenQueues,
  OverviewPeriodMetrics,
} from "@/components/services/overview.service";
import { useLanguage } from "@/lib/i18n";

interface OverviewStandingProps {
  loading: boolean;
  today: OverviewPeriodMetrics;
  month: OverviewPeriodMetrics;
  open: OverviewOpenQueues;
}

function cell(loading: boolean, value: number | null | undefined): string {
  if (loading) return "…";
  if (value === null || value === undefined) return "—";
  return String(value);
}

function StandingBlock({
  title,
  loading,
  created,
  updated,
  pending,
  drafts,
}: {
  title: string;
  loading: boolean;
  created: number | null | undefined;
  updated: number | null | undefined;
  pending: number | null | undefined;
  drafts: number | null | undefined;
}) {
  const { t } = useLanguage();
  const rows = [
    { label: t("overview.standing.created"), value: created },
    { label: t("overview.standing.updated"), value: updated },
    { label: t("overview.standing.pendingPod"), value: pending },
    { label: t("overview.standing.drafts"), value: drafts },
  ];

  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-4">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="font-heading tabular-nums font-semibold text-foreground">
              {cell(loading, row.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function OverviewStanding({
  loading,
  today,
  month,
  open,
}: OverviewStandingProps) {
  const { t } = useLanguage();

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-heading text-base font-semibold tracking-tight">
          {t("overview.standing.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("overview.standing.subtitle")}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StandingBlock
          title={t("overview.standing.todaysWork")}
          loading={loading}
          created={today.createdTotal ?? today.lrsCreated}
          updated={today.lrsUpdated}
          pending={open.pendingPodCount}
          drafts={open.lrDraftsCount}
        />
        <StandingBlock
          title={t("overview.standing.thisMonth")}
          loading={loading}
          created={month.createdTotal ?? month.lrsCreated}
          updated={month.lrsUpdated}
          pending={open.pendingPodCount}
          drafts={open.lrDraftsCount}
        />
      </div>
    </section>
  );
}
