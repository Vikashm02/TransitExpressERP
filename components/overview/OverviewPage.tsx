"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth/AuthProvider";
import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  dashboardHelp,
  teamDashboardHelpCreator,
  teamDashboardHelpTier1,
} from "@/lib/help";
import LearningPageChrome from "@/components/help/LearningPageChrome";
import {
  getOverviewSnapshot,
  type OverviewSnapshot,
} from "@/components/services/overview.service";
import {
  getTeamOverviewSnapshot,
  type TeamOverviewSnapshot,
} from "@/components/services/teamOverview.service";
import { Button } from "@/components/ui/button";

import OverviewHeader from "./OverviewHeader";
import OverviewSummaryCards from "./OverviewSummaryCards";
import OverviewNeedsAttention from "./OverviewNeedsAttention";
import OverviewDrafts from "./OverviewDrafts";
import OverviewRecentWork from "./OverviewRecentWork";
import OverviewStanding from "./OverviewStanding";
import OverviewEfficiencyPanel from "./OverviewEfficiencyPanel";
import TeamOverviewPanel from "./TeamOverviewPanel";
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

type DashboardView = "my" | "team";

/**
 * Dashboard with optional Team view for Creator / Tier 1.
 * My Dashboard: get_overview_snapshot (personal, unchanged).
 * Team Dashboard: get_team_overview_snapshot (server-scoped).
 */
export default function OverviewPage() {
  const { profile, isCreator } = useAuth();
  const { t } = useLanguage();
  // Team Dashboard for Creator OR Tier 1 (admin) — not Creator-only.
  // Server RPC still enforces org vs assigned-team scope.
  const canUseTeam =
    profile?.role === "creator" || profile?.role === "admin";

  const [view, setView] = useState<DashboardView>("my");
  const [period, setPeriod] = useState<OverviewPeriodValue>(() =>
    defaultOverviewPeriod("today")
  );
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [teamSnapshot, setTeamSnapshot] = useState<TeamOverviewSnapshot | null>(
    null
  );

  // Tier 2 (or loss of admin) must not remain on Team view.
  useEffect(() => {
    if (!canUseTeam && view === "team") {
      setView("my");
    }
  }, [canUseTeam, view]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load =
      view === "team" && canUseTeam
        ? getTeamOverviewSnapshot(period.fromDate, period.toDate).then(
            (data) => {
              if (!cancelled) {
                setTeamSnapshot(data);
                setSnapshot(null);
              }
            }
          )
        : getOverviewSnapshot(period.fromDate, period.toDate).then((data) => {
            if (!cancelled) {
              setSnapshot(data);
              setTeamSnapshot(null);
            }
          });

    load
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          if (view === "team") setTeamSnapshot(null);
          else setSnapshot(null);
          toast.error(
            view === "team"
              ? "Unable to load team dashboard."
              : t("overview.loadError")
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period.fromDate, period.toDate, t, view, canUseTeam]);

  const permissions = snapshot?.permissions ?? EMPTY_PERMISSIONS;
  const periodMetrics = snapshot?.period ?? EMPTY_PERIOD;
  const open = snapshot?.open ?? EMPTY_OPEN;

  const pageHelp =
    view === "team" && canUseTeam
      ? isCreator
        ? teamDashboardHelpCreator
        : teamDashboardHelpTier1
      : dashboardHelp;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {canUseTeam ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={view === "my" ? "default" : "outline"}
              className={cn(view === "my" && "pointer-events-none")}
              onClick={() => setView("my")}
            >
              My Dashboard
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "team" ? "default" : "outline"}
              className={cn(view === "team" && "pointer-events-none")}
              onClick={() => setView("team")}
            >
              Team Dashboard
            </Button>
          </div>
        ) : (
          <div />
        )}
        <LearningPageChrome content={pageHelp} />
      </div>

      <OverviewHeader
        displayName={profile?.displayName || profile?.email || ""}
        period={period}
        onPeriodChange={setPeriod}
        titleOverride={
          view === "team" && canUseTeam ? "Team work" : undefined
        }
      />

      {view === "team" && canUseTeam ? (
        <TeamOverviewPanel
          loading={loading}
          snapshot={teamSnapshot}
          isCreator={Boolean(isCreator)}
        />
      ) : (
        <>
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
            <OverviewEfficiencyPanel
              loading={loading}
              canLr={permissions.lr}
              periodFrom={period.fromDate}
              efficiency={snapshot?.efficiency ?? null}
            />
            <OverviewStanding
              loading={loading}
              today={snapshot?.today ?? EMPTY_PERIOD}
              month={snapshot?.month ?? EMPTY_PERIOD}
              open={open}
            />
            <OverviewDrafts
              loading={loading}
              drafts={snapshot?.drafts ?? []}
              canLr={permissions.lr}
            />
            <OverviewRecentWork
              loading={loading}
              recent={snapshot?.recent ?? []}
            />
          </div>

          {/* Desktop */}
          <div className="hidden space-y-5 lg:block">
            <OverviewSummaryCards
              loading={loading}
              permissions={permissions}
              period={periodMetrics}
              open={open}
            />
            <OverviewEfficiencyPanel
              loading={loading}
              canLr={permissions.lr}
              periodFrom={period.fromDate}
              efficiency={snapshot?.efficiency ?? null}
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
            <OverviewRecentWork
              loading={loading}
              recent={snapshot?.recent ?? []}
            />
          </div>
        </>
      )}
    </div>
  );
}
