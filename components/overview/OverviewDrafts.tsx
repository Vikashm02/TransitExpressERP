"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OverviewDraftItem } from "@/components/services/overview.service";

interface OverviewDraftsProps {
  loading: boolean;
  drafts: OverviewDraftItem[];
  canLr: boolean;
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

export default function OverviewDrafts({
  loading,
  drafts,
  canLr,
}: OverviewDraftsProps) {
  if (!canLr) return null;

  return (
    <section className="erp-panel overflow-hidden">
      <div className="border-b border-border/80 px-4 py-3 sm:px-5">
        <h3 className="font-heading text-base font-semibold tracking-tight">
          My Drafts
        </h3>
        <p className="text-xs text-muted-foreground">
          Incomplete LRs. Status is Draft — field values are your real data only.
        </p>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">Loading drafts…</p>
      ) : drafts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
          No pending drafts
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
                    {draft.lrNumber || `LR #${draft.id}`}
                  </p>
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-foreground">
                    Incomplete
                  </span>
                </div>
                {draft.vehicleNumber ? (
                  <p className="text-xs text-muted-foreground">
                    Vehicle: {draft.vehicleNumber}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Updated: {formatWhen(draft.updatedAt || draft.createdAt)}
                </p>
              </div>
              <Link
                href="/lr"
                className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
              >
                Resume
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
