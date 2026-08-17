"use client";

import { useLanguage } from "@/lib/i18n";
import type {
  OverviewEfficiency,
} from "@/components/services/overview.service";
import {
  ageBucketTone,
  completionTone,
  qualityTone,
  toneBarClass,
  toneSoftBgClass,
  toneTextClass,
} from "./overviewEfficiencyThresholds";
import { cn } from "@/lib/utils";

interface OverviewEfficiencyPanelProps {
  loading: boolean;
  canLr: boolean;
  /** Selected period from date (YYYY-MM-DD) — for tracking notice. */
  periodFrom: string;
  efficiency: OverviewEfficiency | null;
}

function formatAvgMinutes(avgSeconds: number | null): number | null {
  if (avgSeconds === null || !Number.isFinite(avgSeconds)) return null;
  return Math.max(0, Math.round(avgSeconds / 60));
}

function AgeRows({
  loading,
  today,
  days12,
  days37,
  days7Plus,
  oldestDays,
  oldestLabel,
}: {
  loading: boolean;
  today: number;
  days12: number;
  days37: number;
  days7Plus: number;
  oldestDays: number | null;
  oldestLabel: string;
}) {
  const { t } = useLanguage();
  const rows: Array<{
    key: "today" | "days_1_2" | "days_3_7" | "days_7_plus";
    label: string;
    value: number;
  }> = [
    { key: "today", label: t("overview.efficiency.bucket.today"), value: today },
    { key: "days_1_2", label: t("overview.efficiency.bucket.days12"), value: days12 },
    { key: "days_3_7", label: t("overview.efficiency.bucket.days37"), value: days37 },
    {
      key: "days_7_plus",
      label: t("overview.efficiency.bucket.days7Plus"),
      value: days7Plus,
    },
  ];

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const tone = ageBucketTone(row.key);
        return (
          <div
            key={row.key}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn("h-2 w-2 shrink-0 rounded-full", toneBarClass(tone))}
                aria-hidden
              />
              <span className="text-muted-foreground">{row.label}</span>
            </div>
            <span className={cn("font-heading tabular-nums font-semibold", toneTextClass(tone))}>
              {loading ? "…" : row.value}
            </span>
          </div>
        );
      })}
      <p className="pt-1 text-xs text-muted-foreground">
        {oldestLabel}{" "}
        <span className="font-medium text-foreground">
          {loading
            ? "…"
            : oldestDays === null
              ? t("overview.efficiency.noData")
              : t("overview.efficiency.daysCount", { days: oldestDays })}
        </span>
      </p>
    </div>
  );
}

/**
 * Operational efficiency block for personal Overview.
 * Period: completion + quality use selected creation window.
 * Draft / pending POD ages are open queues (all ages).
 */
export default function OverviewEfficiencyPanel({
  loading,
  canLr,
  periodFrom,
  efficiency,
}: OverviewEfficiencyPanelProps) {
  const { t, locale } = useLanguage();

  if (!canLr) return null;

  const draft = efficiency?.draftAge;
  const pending = efficiency?.pendingPodAge;
  const completion = efficiency?.completion;
  const quality = efficiency?.quality;

  const avgMinutes = formatAvgMinutes(completion?.avgSeconds ?? null);
  const completionToneValue = completionTone(avgMinutes);
  const qualityScore = quality?.qualityScore ?? null;
  const qualityToneValue = qualityTone(qualityScore);
  const hasQualityData = (quality?.lrsCreated ?? 0) > 0;
  const hasCompletionData = (completion?.completedCount ?? 0) > 0;

  const trackingStarted = quality?.trackingStartedAt
    ? new Date(quality.trackingStartedAt)
    : null;
  const periodFromDate = periodFrom ? new Date(`${periodFrom}T00:00:00`) : null;
  const showTrackingNotice =
    trackingStarted &&
    periodFromDate &&
    !Number.isNaN(trackingStarted.getTime()) &&
    !Number.isNaN(periodFromDate.getTime()) &&
    periodFromDate < trackingStarted;

  const trackingLabel = trackingStarted
    ? trackingStarted.toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-heading text-base font-semibold tracking-tight">
          {t("overview.efficiency.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("overview.efficiency.subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Average completion */}
        <div
          className={cn(
            "rounded-lg border border-border/70 p-4",
            toneSoftBgClass(hasCompletionData ? completionToneValue : "neutral")
          )}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("overview.efficiency.completion.title")}
          </p>
          {loading ? (
            <p className="mt-2 font-heading text-2xl font-semibold">…</p>
          ) : hasCompletionData && avgMinutes !== null ? (
            <>
              <p
                className={cn(
                  "mt-2 font-heading text-2xl font-semibold tabular-nums",
                  toneTextClass(completionToneValue)
                )}
              >
                {avgMinutes}{" "}
                <span className="text-base font-medium">
                  {t("overview.efficiency.completion.minutes")}
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("overview.efficiency.completion.basedOn", {
                  count: completion?.completedCount ?? 0,
                })}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("overview.efficiency.noData")}
            </p>
          )}
        </div>

        {/* Quality */}
        <div
          className={cn(
            "rounded-lg border border-border/70 p-4",
            toneSoftBgClass(hasQualityData ? qualityToneValue : "neutral")
          )}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("overview.efficiency.quality.title")}
          </p>
          {loading ? (
            <p className="mt-2 font-heading text-2xl font-semibold">…</p>
          ) : hasQualityData && qualityScore !== null ? (
            <>
              <p
                className={cn(
                  "mt-2 font-heading text-2xl font-semibold tabular-nums",
                  toneTextClass(qualityToneValue)
                )}
              >
                {qualityScore}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("overview.efficiency.quality.editsOverLrs", {
                  edits: quality?.totalEdits ?? 0,
                  lrs: quality?.lrsCreated ?? 0,
                })}
              </p>
              {quality?.editRate !== null && quality?.editRate !== undefined ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("overview.efficiency.quality.editRate", {
                    rate: quality.editRate,
                  })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("overview.efficiency.noData")}
            </p>
          )}
        </div>
      </div>

      {showTrackingNotice ? (
        <p className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("overview.efficiency.quality.trackingNotice", { date: trackingLabel })}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="erp-panel p-4">
          <h4 className="text-sm font-semibold text-foreground">
            {t("overview.efficiency.draftAge.title")}
          </h4>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("overview.efficiency.draftAge.subtitle")}
          </p>
          <AgeRows
            loading={loading}
            today={draft?.today ?? 0}
            days12={draft?.days12 ?? 0}
            days37={draft?.days37 ?? 0}
            days7Plus={draft?.days7Plus ?? 0}
            oldestDays={draft?.oldestDays ?? null}
            oldestLabel={t("overview.efficiency.draftAge.oldest")}
          />
        </div>

        <div className="erp-panel p-4">
          <h4 className="text-sm font-semibold text-foreground">
            {t("overview.efficiency.podAge.title")}
          </h4>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("overview.efficiency.podAge.subtitle")}
          </p>
          <AgeRows
            loading={loading}
            today={pending?.today ?? 0}
            days12={pending?.days12 ?? 0}
            days37={pending?.days37 ?? 0}
            days7Plus={pending?.days7Plus ?? 0}
            oldestDays={pending?.oldestDays ?? null}
            oldestLabel={t("overview.efficiency.podAge.oldest")}
          />
          {!loading && pending ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("overview.efficiency.podAge.total")}:{" "}
              <span className="font-medium text-foreground">{pending.total}</span>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
