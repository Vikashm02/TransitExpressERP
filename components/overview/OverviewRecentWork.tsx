"use client";

import Link from "next/link";

import type { OverviewRecentItem } from "@/components/services/overview.service";
import { useLanguage, type Locale } from "@/lib/i18n";

interface OverviewRecentWorkProps {
  loading: boolean;
  recent: OverviewRecentItem[];
}

function moduleHref(module: string): string {
  switch (module) {
    case "lr":
      return "/lr";
    case "pod":
      return "/pod";
    case "dc":
      return "/delivery-challans";
    case "asn":
      return "/asn";
    default:
      return "/";
  }
}

function moduleLabelKey(module: string): string {
  switch (module) {
    case "lr":
      return "overview.module.lr";
    case "pod":
      return "overview.module.pod";
    case "dc":
      return "overview.module.dc";
    case "asn":
      return "overview.module.asn";
    default:
      return "";
  }
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

export default function OverviewRecentWork({
  loading,
  recent,
}: OverviewRecentWorkProps) {
  const { t, locale } = useLanguage();

  return (
    <section className="erp-panel overflow-hidden">
      <div className="border-b border-border/80 px-4 py-3 sm:px-5">
        <h3 className="font-heading text-base font-semibold tracking-tight">
          {t("overview.recent.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("overview.recent.subtitle")}
        </p>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
          {t("overview.recent.loading")}
        </p>
      ) : recent.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
          {t("overview.recent.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {recent.map((item) => {
            const labelKey = moduleLabelKey(item.module);
            const label = labelKey ? t(labelKey) : item.module.toUpperCase();
            return (
              <li key={`${item.module}-${item.action}-${item.id}-${item.at}`}>
                <Link
                  href={moduleHref(item.module)}
                  className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.reference || `${label} #${item.id}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {label} ·{" "}
                      {item.action === "updated"
                        ? t("overview.recent.updated")
                        : t("overview.recent.created")}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatWhen(item.at, locale)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
