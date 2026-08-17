"use client";

import Link from "next/link";

import type { OverviewRecentItem } from "@/components/services/overview.service";

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

function moduleLabel(module: string): string {
  switch (module) {
    case "lr":
      return "LR";
    case "pod":
      return "POD";
    case "dc":
      return "Delivery Challan";
    case "asn":
      return "ASN";
    default:
      return module.toUpperCase();
  }
}

function formatWhen(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
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
  return (
    <section className="erp-panel overflow-hidden">
      <div className="border-b border-border/80 px-4 py-3 sm:px-5">
        <h3 className="font-heading text-base font-semibold tracking-tight">
          Recent Work
        </h3>
        <p className="text-xs text-muted-foreground">
          Derived from last create/update timestamps — not a full audit history.
        </p>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
          Loading recent work…
        </p>
      ) : recent.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
          No recent work yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {recent.map((item) => (
            <li key={`${item.module}-${item.action}-${item.id}-${item.at}`}>
              <Link
                href={moduleHref(item.module)}
                className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.reference || `${moduleLabel(item.module)} #${item.id}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {moduleLabel(item.module)} ·{" "}
                    {item.action === "updated" ? "Updated" : "Created"}
                  </p>
                </div>
                <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatWhen(item.at)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
