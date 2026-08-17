"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OverviewDraftItem } from "@/components/services/overview.service";
import { useLanguage, type Locale } from "@/lib/i18n";

interface OverviewDraftsProps {
  loading: boolean;
  drafts: OverviewDraftItem[];
  canLr: boolean;
}

function formatWhen(iso: string, locale: Locale): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OverviewDrafts({
  loading,
  drafts,
  canLr,
}: OverviewDraftsProps) {
  const { t, locale } = useLanguage();

  if (!canLr) return null;

  return (
    <section className="erp-panel overflow-hidden">
      <div className="border-b border-border/80 px-4 py-3 sm:px-5">
        <h3 className="font-heading text-base font-semibold tracking-tight">
          {t("overview.drafts.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("overview.drafts.subtitle")}
        </p>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
          {t("overview.drafts.loading")}
        </p>
      ) : drafts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
          {t("overview.drafts.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {drafts.map((draft) => (
            <li
              key={draft.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {draft.lrNumber ||
                      `${t("overview.module.lr")} #${draft.id}`}
                  </p>
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-foreground">
                    {t("overview.drafts.incomplete")}
                  </span>
                </div>
                {draft.vehicleNumber ? (
                  <p className="text-xs text-muted-foreground">
                    {t("overview.drafts.vehicle")}: {draft.vehicleNumber}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {t("overview.drafts.updated")}:{" "}
                  {formatWhen(draft.updatedAt || draft.createdAt, locale)}
                </p>
              </div>
              <Link
                href="/lr"
                className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
              >
                {t("overview.drafts.resume")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
