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
  const dcAsnTotal =
    permissions.deliveryChallans || permissions.asnCreations
      ? (period.dcsCreated ?? 0) + (period.asnsCreated ?? 0)
      : null;

  const cards = [
    permissions.lr
      ? {
          key: "lrs",
          title: "My LRs",
          value: display(loading, period.lrsCreated),
          subtitle: "Created in period",
          icon: FileText,
        }
      : null,
    permissions.lr
      ? {
          key: "updates",
          title: "LR Updates",
          value: display(loading, period.lrsUpdated),
          subtitle: "Edits in period",
          icon: FileEdit,
        }
      : null,
    permissions.pod
      ? {
          key: "pods",
          title: "PODs",
          value: display(loading, period.podsCreated),
          subtitle: "Created in period",
          icon: ClipboardCheck,
        }
      : null,
    permissions.lr
      ? {
          key: "pending-pod",
          title: "Pending POD",
          value: display(loading, open.pendingPodCount),
          subtitle: "Still open",
          icon: Package,
        }
      : null,
    permissions.lr
      ? {
          key: "drafts",
          title: "Drafts",
          value: display(loading, open.lrDraftsCount),
          subtitle: "Open LR drafts",
          icon: FileEdit,
        }
      : null,
    permissions.deliveryChallans || permissions.asnCreations
      ? {
          key: "dc-asn",
          title: "DC / ASN",
          value: display(loading, dcAsnTotal),
          subtitle: "Created in period",
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
        No module permissions are available for overview metrics.
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
