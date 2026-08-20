import { supabase } from "@/lib/supabase";
import type { AppUserRole } from "@/components/services/appUser.service";
import {
  type OverviewOpenQueues,
  type OverviewPeriodMetrics,
  type OverviewPermissions,
} from "@/components/services/overview.service";

export type TeamOverviewScope = "organization" | "assigned_team";

export interface TeamOverviewSummary {
  teamMembers: number;
  tier1Count: number;
  tier2Count: number;
  activeApproved: number;
  pendingApproval: number;
  locked: number;
}

export interface TeamOverviewMember {
  userId: string;
  displayName: string;
  role: AppUserRole;
  approvalStatus: string;
  isLocked: boolean;
  drafts: number | null;
  pendingPods: number | null;
  lrsCreated: number | null;
  lrsUpdated: number | null;
  podsCreated: number | null;
  dcsCreated: number | null;
  asnsCreated: number | null;
  completedCount: number | null;
}

export interface TeamOverviewTrend {
  weekStart: string;
  weekEnd: string;
  lrsCreated: number | null;
  podsCreated: number | null;
  completedCount: number | null;
}

export interface TeamOverviewSnapshot {
  callerId: string;
  scope: TeamOverviewScope;
  from: string;
  to: string;
  permissions: OverviewPermissions;
  summary: TeamOverviewSummary;
  period: OverviewPeriodMetrics;
  open: OverviewOpenQueues;
  completedCount: number | null;
  members: TeamOverviewMember[];
  trends: TeamOverviewTrend[];
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapPeriod(raw: Record<string, unknown> | null | undefined): OverviewPeriodMetrics {
  const row = raw ?? {};
  return {
    lrsCreated: asNullableNumber(row.lrs_created),
    lrsUpdated: asNullableNumber(row.lrs_updated),
    podsCreated: asNullableNumber(row.pods_created),
    dcsCreated: asNullableNumber(row.dcs_created),
    asnsCreated: asNullableNumber(row.asns_created),
  };
}

function parseRole(role: unknown): AppUserRole {
  if (role === "creator") return "creator";
  if (role === "admin") return "admin";
  return "staff";
}

/**
 * Team Overview snapshot. Scope is enforced by get_team_overview_snapshot
 * via auth.uid() — never pass manager/staff ids from the browser.
 */
export async function getTeamOverviewSnapshot(
  fromDate: string,
  toDate: string
): Promise<TeamOverviewSnapshot> {
  const { data, error } = await supabase.rpc("get_team_overview_snapshot", {
    p_from: fromDate,
    p_to: toDate,
  });

  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("Team overview snapshot returned no data.");
  }

  const raw = data as Record<string, unknown>;
  const permissions = (raw.permissions ?? {}) as Record<string, unknown>;
  const open = (raw.open ?? {}) as Record<string, unknown>;
  const summary = (raw.summary ?? {}) as Record<string, unknown>;
  const membersRaw = Array.isArray(raw.members) ? raw.members : [];
  const trendsRaw = Array.isArray(raw.trends) ? raw.trends : [];

  const scopeRaw = String(raw.scope ?? "");
  const scope: TeamOverviewScope =
    scopeRaw === "assigned_team" ? "assigned_team" : "organization";

  return {
    callerId: String(raw.caller_id ?? ""),
    scope,
    from: String(raw.from ?? fromDate),
    to: String(raw.to ?? toDate),
    permissions: {
      lr: Boolean(permissions.lr),
      pod: Boolean(permissions.pod),
      deliveryChallans: Boolean(permissions.delivery_challans),
      asnCreations: Boolean(permissions.asn_creations),
    },
    summary: {
      teamMembers: asNullableNumber(summary.team_members) ?? 0,
      tier1Count: asNullableNumber(summary.tier1_count) ?? 0,
      tier2Count: asNullableNumber(summary.tier2_count) ?? 0,
      activeApproved: asNullableNumber(summary.active_approved) ?? 0,
      pendingApproval: asNullableNumber(summary.pending_approval) ?? 0,
      locked: asNullableNumber(summary.locked) ?? 0,
    },
    period: mapPeriod(raw.period as Record<string, unknown>),
    open: {
      lrDraftsCount: asNullableNumber(open.lr_drafts_count),
      pendingPodCount: asNullableNumber(open.pending_pod_count),
    },
    completedCount: asNullableNumber(raw.completed_count),
    members: membersRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        userId: String(row.user_id ?? ""),
        displayName: String(row.display_name ?? "Unnamed"),
        role: parseRole(row.role),
        approvalStatus: String(row.approval_status ?? "pending"),
        isLocked: Boolean(row.is_locked),
        drafts: asNullableNumber(row.drafts),
        pendingPods: asNullableNumber(row.pending_pods),
        lrsCreated: asNullableNumber(row.lrs_created),
        lrsUpdated: asNullableNumber(row.lrs_updated),
        podsCreated: asNullableNumber(row.pods_created),
        dcsCreated: asNullableNumber(row.dcs_created),
        asnsCreated: asNullableNumber(row.asns_created),
        completedCount: asNullableNumber(row.completed_count),
      };
    }),
    trends: trendsRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        weekStart: String(row.week_start ?? ""),
        weekEnd: String(row.week_end ?? ""),
        lrsCreated: asNullableNumber(row.lrs_created),
        podsCreated: asNullableNumber(row.pods_created),
        completedCount: asNullableNumber(row.completed_count),
      };
    }),
  };
}

export interface StaffManagerAssignment {
  id: string;
  managerId: string;
  staffId: string;
  createdAt: string;
}

/** Creator: all assignments. Tier 1: own assignments only (RLS). */
export async function getStaffManagerAssignments(): Promise<StaffManagerAssignment[]> {
  const { data, error } = await supabase
    .from("staff_manager_assignments")
    .select("id, manager_id, staff_id, created_at")
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: String(row.id),
    managerId: String(row.manager_id),
    staffId: String(row.staff_id),
    createdAt: String(row.created_at ?? ""),
  }));
}

/**
 * Creator-only: set Tier 2 staff's manager (replace any prior assignment).
 * Pass managerId = null to clear.
 */
export async function setStaffManagerAssignment(
  staffId: string,
  managerId: string | null
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("staff_manager_assignments")
    .delete()
    .eq("staff_id", staffId);

  if (deleteError) throw deleteError;

  if (!managerId) return;

  const { error: insertError } = await supabase
    .from("staff_manager_assignments")
    .insert({ staff_id: staffId, manager_id: managerId });

  if (insertError) throw insertError;
}
