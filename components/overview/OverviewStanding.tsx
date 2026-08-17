"use client";

import type {
  OverviewOpenQueues,
  OverviewPeriodMetrics,
} from "@/components/services/overview.service";

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
  const rows = [
    { label: "Created", value: created },
    { label: "Updated", value: updated },
    { label: "Pending POD", value: pending },
    { label: "Drafts", value: drafts },
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
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-heading text-base font-semibold tracking-tight">
          Where I Stand
        </h3>
        <p className="text-xs text-muted-foreground">
          Fixed windows for today and this month. Pending and drafts are open queues.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StandingBlock
          title="Today's Work"
          loading={loading}
          created={today.createdTotal ?? today.lrsCreated}
          updated={today.lrsUpdated}
          pending={open.pendingPodCount}
          drafts={open.lrDraftsCount}
        />
        <StandingBlock
          title="This Month"
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
