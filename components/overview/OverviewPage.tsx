"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth/AuthProvider";
import {
  getOverviewSnapshot,
  type OverviewSnapshot,
} from "@/components/services/overview.service";

import OverviewHeader from "./OverviewHeader";
import OverviewSummaryCards from "./OverviewSummaryCards";
import OverviewNeedsAttention from "./OverviewNeedsAttention";
import OverviewDrafts from "./OverviewDrafts";
import OverviewRecentWork from "./OverviewRecentWork";
import OverviewStanding from "./OverviewStanding";
import {
  defaultOverviewPeriod,
  type OverviewPeriodValue,
} from "./OverviewPeriodFilter";

const EMPTY_PERMISSIONS = {
  lr: false,
  pod: false,
  deliveryChallans: false,
  asnCreations: false,
};

const EMPTY_PERIOD = {
  lrsCreated: null,
  lrsUpdated: null,
  podsCreated: null,
  dcsCreated: null,
  asnsCreated: null,
};

const EMPTY_OPEN = {
  lrDraftsCount: null,
  pendingPodCount: null,
};

/**
 * Phase 2a personal Overview — scoped via get_overview_snapshot (auth.uid()).
 * Company / staff selector deferred to Phase 2c.
 */
export default function OverviewPage() {
  const { profile } = useAuth();
  const [period, setPeriod] = useState<OverviewPeriodValue>(() =>
    defaultOverviewPeriod("today")
  );
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getOverviewSnapshot(period.fromDate, period.toDate)
      .then((data) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setSnapshot(null);
          toast.error(
            "Unable to load your overview. Confirm migration 037 is applied."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period.fromDate, period.toDate]);

  const permissions = snapshot?.permissions ?? EMPTY_PERMISSIONS;
  const periodMetrics = snapshot?.period ?? EMPTY_PERIOD;
  const open = snapshot?.open ?? EMPTY_OPEN;

  return (
    <div className="space-y-5">
      <OverviewHeader
        displayName={profile?.displayName || profile?.email || ""}
        period={period}
        onPeriodChange={setPeriod}
      />

      {/* Mobile: Needs Attention first */}
      <div className="space-y-5 lg:hidden">
        <OverviewNeedsAttention
          loading={loading}
          open={open}
          canLr={permissions.lr}
        />
        <OverviewSummaryCards
          loading={loading}
          permissions={permissions}
          period={periodMetrics}
          open={open}
        />
        <OverviewStanding
          loading={loading}
          today={snapshot?.today ?? EMPTY_PERIOD}
          month={snapshot?.month ?? EMPTY_PERIOD}
          open={open}
        />
        <OverviewRecentWork loading={loading} recent={snapshot?.recent ?? []} />
        <OverviewDrafts
          loading={loading}
          drafts={snapshot?.drafts ?? []}
          canLr={permissions.lr}
        />
      </div>

      {/* Desktop: summary → standing → attention / recent / drafts */}
      <div className="hidden space-y-5 lg:block">
        <OverviewSummaryCards
          loading={loading}
          permissions={permissions}
          period={periodMetrics}
          open={open}
        />
        <OverviewStanding
          loading={loading}
          today={snapshot?.today ?? EMPTY_PERIOD}
          month={snapshot?.month ?? EMPTY_PERIOD}
          open={open}
        />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <OverviewNeedsAttention
            loading={loading}
            open={open}
            canLr={permissions.lr}
          />
          <OverviewDrafts
            loading={loading}
            drafts={snapshot?.drafts ?? []}
            canLr={permissions.lr}
          />
        </div>
        <OverviewRecentWork loading={loading} recent={snapshot?.recent ?? []} />
      </div>
    </div>
  );
}
