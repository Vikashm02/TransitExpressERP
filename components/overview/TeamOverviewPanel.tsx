"use client";

import Link from "next/link";
import {
  FileText,
  Lock,
  PackageCheck,
  Users,
  UserCheck,
  Clock,
} from "lucide-react";

import StatCard from "@/components/ui/StatCard";
import StatusBadge from "@/components/ui/StatusBadge";
import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import {
  organizationalRoleLabel,
  type AppUserRole,
} from "@/components/services/appUser.service";
import type { TeamOverviewSnapshot } from "@/components/services/teamOverview.service";

interface TeamOverviewPanelProps {
  loading: boolean;
  snapshot: TeamOverviewSnapshot | null;
  isCreator: boolean;
}

function displayNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

export default function TeamOverviewPanel({
  loading,
  snapshot,
  isCreator,
}: TeamOverviewPanelProps) {
  const summary = snapshot?.summary;
  const period = snapshot?.period;
  const open = snapshot?.open;
  const members = snapshot?.members ?? [];
  const trends = snapshot?.trends ?? [];

  const columns: DataTableColumn<(typeof members)[number]>[] = [
    {
      key: "displayName",
      header: "Staff",
      sortable: true,
      className: "font-medium",
    },
    {
      key: "role",
      header: "Tier",
      render: (row) => (
        <StatusBadge
          status={row.role === "admin" ? "Active" : "Pending"}
          label={organizationalRoleLabel(row.role as AppUserRole)}
        />
      ),
    },
    {
      key: "approvalStatus",
      header: "Status",
      render: (row) => (
        <StatusBadge
          status={row.isLocked ? "Error" : row.approvalStatus}
          label={
            row.isLocked
              ? "Locked"
              : row.approvalStatus.charAt(0).toUpperCase() +
                row.approvalStatus.slice(1)
          }
        />
      ),
    },
    {
      key: "drafts",
      header: "Drafts",
      render: (row) => (
        <span className="tabular-nums">{displayNum(row.drafts)}</span>
      ),
    },
    {
      key: "pendingPods",
      header: "Pending PODs",
      render: (row) => (
        <span className="tabular-nums">{displayNum(row.pendingPods)}</span>
      ),
    },
    {
      key: "completedCount",
      header: "Completed",
      render: (row) => (
        <span className="tabular-nums">{displayNum(row.completedCount)}</span>
      ),
    },
    {
      key: "lrsCreated",
      header: "LRs created",
      render: (row) => (
        <span className="tabular-nums">{displayNum(row.lrsCreated)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-semibold text-foreground">
            Team summary
          </h3>
          <p className="text-sm text-muted-foreground">
            {isCreator
              ? "Organization-wide operational view (Tier 1 + Tier 2)."
              : "Assigned Tier 2 staff only."}
            {snapshot?.scope === "assigned_team" && !loading
              ? " Scope enforced by the server."
              : null}
          </p>
        </div>
        <Link
          href="/staff"
          className="text-sm font-medium text-primary hover:underline"
        >
          View Staff
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={Users}
          title="Team members"
          value={loading ? "…" : summary?.teamMembers ?? 0}
        />
        {isCreator ? (
          <StatCard
            icon={UserCheck}
            title="Tier 1"
            value={loading ? "…" : summary?.tier1Count ?? 0}
          />
        ) : null}
        <StatCard
          icon={Users}
          title="Tier 2"
          value={loading ? "…" : summary?.tier2Count ?? 0}
        />
        <StatCard
          icon={UserCheck}
          title="Active / approved"
          value={loading ? "…" : summary?.activeApproved ?? 0}
        />
        <StatCard
          icon={Clock}
          title="Pending approval"
          value={loading ? "…" : summary?.pendingApproval ?? 0}
        />
        <StatCard
          icon={Lock}
          title="Locked"
          value={loading ? "…" : summary?.locked ?? 0}
        />
      </div>

      <div>
        <h3 className="mb-3 font-heading text-base font-semibold text-foreground">
          Team workload
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard
            icon={FileText}
            title="Drafts"
            value={loading ? "…" : displayNum(open?.lrDraftsCount)}
          />
          <StatCard
            icon={PackageCheck}
            title="Pending PODs"
            value={loading ? "…" : displayNum(open?.pendingPodCount)}
          />
          <StatCard
            title="LRs created"
            value={loading ? "…" : displayNum(period?.lrsCreated)}
          />
          <StatCard
            title="PODs created"
            value={loading ? "…" : displayNum(period?.podsCreated)}
          />
          <StatCard
            title="Completed LRs"
            value={loading ? "…" : displayNum(snapshot?.completedCount)}
            subtitle="Finalized in selected period"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-3 font-heading text-base font-semibold text-foreground">
          Team member breakdown
        </h3>
        <DataTable
          columns={columns}
          data={members}
          loading={loading}
          rowKey={(row) => row.userId}
          emptyTitle={
            isCreator
              ? "No Tier 1 or Tier 2 users yet"
              : "No Tier 2 staff assigned to you yet"
          }
          emptyIcon={Users}
        />
      </div>

      <div>
        <h3 className="mb-3 font-heading text-base font-semibold text-foreground">
          Trends (by week)
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Calendar weeks within the selected period. Same create / completed
          definitions as the personal overview.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : trends.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trend rows for this period.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Week</th>
                  <th className="px-3 py-2 font-medium">LRs created</th>
                  <th className="px-3 py-2 font-medium">PODs created</th>
                  <th className="px-3 py-2 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {trends.map((row) => (
                  <tr
                    key={row.weekStart}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2 tabular-nums text-foreground">
                      {row.weekStart === row.weekEnd
                        ? row.weekStart
                        : `${row.weekStart} → ${row.weekEnd}`}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {displayNum(row.lrsCreated)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {displayNum(row.podsCreated)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {displayNum(row.completedCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
