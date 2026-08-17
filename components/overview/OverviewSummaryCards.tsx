"use client";

import {
  ClipboardCheck,
  FileEdit,
  FileText,
  Package,
  Truck,
} from "lucide-react";

import StatCard from "@/components/ui/StatCard";
import type {
  OverviewOpenQueues,
  OverviewPeriodMetrics,
  OverviewPermissions,
} from "@/components/services/overview.service";
import { useLanguage } from "@/lib/i18n";

interface OverviewSummaryCardsProps {
  loading: boolean;
  permissions: OverviewPermissions;
  period: OverviewPeriodMetrics;
  open: OverviewOpenQueues;
}

function display(loading: boolean, value: number | null | undefined): string {
  if (loading) return "…";
  if (value === null || value === undefined) return "—";
  return String(value);
}

export default function OverviewSummaryCards({
  loading,
  permissions,
  period,
  open,
}: OverviewSummaryCardsProps) {
  const { t } = useLanguage();

  const dcAsnTotal =
    permissions.deliveryChallans || permissions.asnCreations
      ? (period.dcsCreated ?? 0) + (period.asnsCreated ?? 0)
      : null;

  const cards = [
    permissions.lr
      ? {
          key: "lrs",
          title: t("overview.cards.myLrs"),
          value: display(loading, period.lrsCreated),
          subtitle: t("overview.cards.createdInPeriod"),
          icon: FileText,
        }
      : null,
    permissions.lr
      ? {
          key: "updates",
          title: t("overview.cards.lrUpdates"),
          value: display(loading, period.lrsUpdated),
          subtitle: t("overview.cards.editsInPeriod"),
          icon: FileEdit,
        }
      : null,
    permissions.pod
      ? {
          key: "pods",
          title: t("overview.cards.pods"),
          value: display(loading, period.podsCreated),
          subtitle: t("overview.cards.createdInPeriod"),
          icon: ClipboardCheck,
        }
      : null,
    permissions.lr
      ? {
          key: "pending-pod",
          title: t("overview.cards.pendingPod"),
          value: display(loading, open.pendingPodCount),
          subtitle: t("overview.cards.stillOpen"),
          icon: Package,
        }
      : null,
    permissions.lr
      ? {
          key: "drafts",
          title: t("overview.cards.drafts"),
          value: display(loading, open.lrDraftsCount),
          subtitle: t("overview.cards.openLrDrafts"),
          icon: FileEdit,
        }
      : null,
    permissions.deliveryChallans || permissions.asnCreations
      ? {
          key: "dc-asn",
          title: t("overview.cards.dcAsn"),
          value: display(loading, dcAsnTotal),
          subtitle: t("overview.cards.createdInPeriod"),
          icon: Truck,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    title: string;
    value: string;
    subtitle: string;
    icon: typeof FileText;
  }>;

  if (cards.length === 0) {
    return (
      <div className="erp-panel p-4 text-sm text-muted-foreground">
        {t("overview.cards.noPermissions")}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
      {cards.map((card) => (
        <StatCard
          key={card.key}
          title={card.title}
          value={card.value}
          subtitle={card.subtitle}
          icon={card.icon}
        />
      ))}
    </div>
  );
}
