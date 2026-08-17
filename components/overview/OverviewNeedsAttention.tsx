"use client";

import Link from "next/link";
import { ClipboardList, FilePenLine } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OverviewOpenQueues } from "@/components/services/overview.service";
import { useLanguage } from "@/lib/i18n";

interface OverviewNeedsAttentionProps {
  loading: boolean;
  open: OverviewOpenQueues;
  canLr: boolean;
}

export default function OverviewNeedsAttention({
  loading,
  open,
  canLr,
}: OverviewNeedsAttentionProps) {
  const { t } = useLanguage();

  if (!canLr) return null;

  const items = [
    {
      key: "pending-pod",
      title: t("overview.cards.pendingPod"),
      count: open.pendingPodCount,
      href: "/pod",
      action: t("overview.attention.view"),
      icon: ClipboardList,
      hint: t("overview.attention.pendingPodHint"),
    },
    {
      key: "drafts",
      title: t("overview.attention.lrDrafts"),
      count: open.lrDraftsCount,
      href: "/lr",
      action: t("overview.attention.resumeDrafts"),
      icon: FilePenLine,
      hint: t("overview.attention.draftsHint"),
    },
  ];

  return (
    <section className="erp-panel overflow-hidden">
      <div className="border-b border-border/80 px-4 py-3 sm:px-5">
        <h3 className="font-heading text-base font-semibold tracking-tight">
          {t("overview.attention.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("overview.attention.subtitle")}
        </p>
      </div>

      <ul className="divide-y divide-border/70">
        {items.map((item) => {
          const count = loading ? null : item.count;
          const Icon = item.icon;
          return (
            <li
              key={item.key}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 rounded-md bg-muted/60 p-2 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.hint}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="font-heading text-xl font-semibold tabular-nums">
                  {count === null || count === undefined ? "…" : count}
                </span>
                <Link
                  href={item.href}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  {item.action}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
