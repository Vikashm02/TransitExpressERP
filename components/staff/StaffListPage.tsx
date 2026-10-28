"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";
import {
  Clock,
  Crown,
  Ellipsis,
  Info,
  Lock,
  LoaderCircle,
  RotateCw,
  Search,
  ShieldAlert,
  UserCheck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import DataTable, {
  type DataTableAction,
  type DataTableColumn,
} from "@/components/common/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/ui/StatusBadge";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  canManageStaffTarget,
  getStaffUsers,
  organizationalRoleLabel,
  updateAppUserRole,
  updateAppUserApprovalStatus,
  updateAppUserLocked,
  type AppUserProfile,
} from "@/components/services/appUser.service";
import {
  getStaffManagerAssignments,
  setStaffManagerAssignment,
} from "@/components/services/teamOverview.service";
import StaffPermissionsDialog from "@/components/staff/StaffPermissionsDialog";
import WhatsappAccessDialog from "@/components/staff/WhatsappAccessDialog";
import {
  disableWhatsappAccess,
  listWhatsappAccess,
  type WhatsappAccessRow,
} from "@/components/services/whatsappAccess.service";
import {
  canChangeWhatsappAccess,
  canDisableWhatsappAccess,
  canEnableWhatsappAccess,
  canManageWhatsappAccessAsCreator,
  WHATSAPP_ACCESS_STATUS_LABELS,
} from "@/lib/whatsappAccessRules";
import { createWhatsappRequestCoordinator } from "@/lib/whatsappRequestCoordinator";
import { getWhatsappAccessErrorMessage } from "@/lib/errors/whatsappAccessError";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

/**
 * Staff roster for Creator and Tier 1.
 *
 * Hierarchy (UI mirrors migration 041 RLS):
 *   Creator → manage Tier 1 (admin) + Tier 2 (staff)
 *   Tier 1  → manage Tier 2 only
 *   Tier 2  → no access
 *
 * Creator designation is never offered here — only service_role
 * designate_creator(uuid) after migration 041.
 */
export default function StaffListPage() {
  const { isAdmin, isCreator, profile } = useAuth();
  const [staff, setStaff] = useState<AppUserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [permissionsUser, setPermissionsUser] = useState<AppUserProfile | null>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  /** staffId → M114 WhatsApp access row (Creator view only). */
  const [whatsappByUserId, setWhatsappByUserId] = useState<Record<string, WhatsappAccessRow>>({});
  const [whatsappDialogUser, setWhatsappDialogUser] = useState<AppUserProfile | null>(null);
  const [whatsappDialogMode, setWhatsappDialogMode] = useState<"enable" | "change">("enable");
  const [whatsappDialogOpen, setWhatsappDialogOpen] = useState(false);
  const [whatsappDisableTarget, setWhatsappDisableTarget] = useState<AppUserProfile | null>(null);
  const [whatsappDisableOpen, setWhatsappDisableOpen] = useState(false);
  /** staffId → managerId (Creator assignment UI). */
  const [managerByStaffId, setManagerByStaffId] = useState<Record<string, string>>(
    {}
  );
  /** UI-only: roster search text and status filter (no data effect). */
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StaffStatusFilter>("all");

  const actorRole = profile?.role ?? "staff";
  const actorId = profile?.id ?? "";
  // Latest-request-wins guard for WhatsApp access state: an overlapping or
  // older list/load result must never overwrite or clear newer state. The
  // coordinator also carries the live eligibility getter and mounted flag.
  const canManageWhatsapp = canManageWhatsappAccessAsCreator(profile);
  /** Live eligibility, readable from async closures after awaits. */
  const canManageWhatsappRef = useRef(canManageWhatsapp);
  canManageWhatsappRef.current = canManageWhatsapp;
  const whatsappCoordinatorRef = useRef(
    createWhatsappRequestCoordinator(() => canManageWhatsappRef.current)
  );

  // Unmount guard: invalidate in-flight WhatsApp requests and flip the
  // mounted flag so no async continuation applies state afterwards.
  useEffect(() => {
    whatsappCoordinatorRef.current.markMounted();
    return () => {
      whatsappCoordinatorRef.current.markUnmounted();
    };
  }, []);

  const loadStaff = useCallback(async () => {
    // Generation is allocated at ENTRY, before the first await — request
    // start order, not intermediate completion order, decides which
    // invocation is newest.
    const generation = whatsappCoordinatorRef.current.beginLoad();
    // An ineligible actor must never see stale WhatsApp controls. Do not
    // invalidate this generation here: ordinary Staff Master loading still
    // belongs to this request and must be allowed to finish.
    if (!canManageWhatsapp) {
      if (whatsappCoordinatorRef.current.isMounted) {
        setWhatsappByUserId({});
      }
    }
    try {
      if (whatsappCoordinatorRef.current.isMounted) {
        setLoading(true);
      }
      const [data, assignments] = await Promise.all([
        getStaffUsers(),
        getStaffManagerAssignments().catch(() => []),
      ]);
      // A newer load started, or the page unmounted: apply nothing.
      if (!whatsappCoordinatorRef.current.isCurrent(generation)) return;
      setStaff(data);
      const map: Record<string, string> = {};
      for (const row of assignments) {
        map[row.staffId] = row.managerId;
      }
      setManagerByStaffId(map);
      // WhatsApp management is Creator-only AND the current profile must be
      // an approved, unlocked Creator; otherwise never invoke the RPC and
      // clear any stale access state. Check the LIVE eligibility ref, not a
      // captured boolean — the actor may have lost eligibility while the
      // staff/assignment fetch above was in flight.
      if (!canManageWhatsappRef.current) {
        setWhatsappByUserId({});
        return;
      }
      // Freshness + live-eligibility gate, again, immediately before the
      // RPC: an old closure resumed after a newer load superseded it (or
      // after eligibility was revoked) must never reach listWhatsappAccess.
      if (!whatsappCoordinatorRef.current.mayFetch(generation)) {
        if (!canManageWhatsappRef.current && whatsappCoordinatorRef.current.isCurrent(generation)) {
          setWhatsappByUserId({});
        }
        return;
      }
      // Clear stale access controls immediately for this fresh load so
      // actions are not shown against outdated mappings while refreshing.
      setWhatsappByUserId({});
      try {
        const rows = await listWhatsappAccess();
        if (!whatsappCoordinatorRef.current.isCurrent(generation)) return;
        const byUser: Record<string, WhatsappAccessRow> = {};
        for (const row of rows) {
          byUser[row.targetUserId] = row;
        }
        setWhatsappByUserId(byUser);
      } catch {
        // A WhatsApp list failure must not break the Staff Master roster,
        // and an OLD failed request must not clear NEWER successful state.
        if (!whatsappCoordinatorRef.current.isCurrent(generation)) return;
        setWhatsappByUserId({});
        toast.error("Unable to load WhatsApp access.");
      }
    } catch {
      if (whatsappCoordinatorRef.current.isCurrent(generation)) {
        toast.error("Unable to load staff.");
      }
    } finally {
      if (whatsappCoordinatorRef.current.isCurrent(generation)) {
        setLoading(false);
      }
    }
  }, [canManageWhatsapp]);

  useEffect(() => {
    if (isAdmin) {
      loadStaff();
    } else {
      setLoading(false);
    }
  }, [isAdmin, loadStaff]);

  function canManage(row: AppUserProfile): boolean {
    return canManageStaffTarget(actorRole, actorId, row);
  }

  /** Rule input for one roster row; safe defaults hide management when the
   * WhatsApp list RPC could not be loaded. */
  function whatsappRuleInput(row: AppUserProfile) {
    const access = whatsappByUserId[row.id];
    return {
      effectiveAccessStatus: access?.effectiveAccessStatus ?? ("account_ineligible" as const),
      whatsappPhoneE164: access?.whatsappPhoneE164 ?? null,
      approvalStatus: row.approvalStatus,
      isLocked: row.isLocked,
    };
  }

  async function handleToggleRole(user: AppUserProfile) {
    // Creator only; Tier 1 never sees this action. Never assigns creator.
    if (!isCreator || !canManage(user)) {
      toast.error("You do not have permission to change this user's tier.");
      return;
    }
    if (user.role !== "admin" && user.role !== "staff") return;

    const nextRole = user.role === "admin" ? "staff" : "admin";

    try {
      setUpdatingId(user.id);
      await updateAppUserRole(user.id, nextRole);
      toast.success(
        `${user.displayName} is now ${
          nextRole === "admin" ? "Tier 1" : "Tier 2"
        }.`
      );
      await loadStaff();
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, "Unable to update role."));
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleSetApproval(
    user: AppUserProfile,
    approvalStatus: "approved" | "rejected"
  ) {
    if (!canManage(user)) {
      toast.error("You do not have permission to update this user.");
      return;
    }

    try {
      setUpdatingId(user.id);
      await updateAppUserApprovalStatus(user.id, approvalStatus);
      toast.success(`${user.displayName} has been ${approvalStatus}.`);
      await loadStaff();
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, "Unable to update approval status."));
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleToggleLock(user: AppUserProfile) {
    if (!canManage(user)) {
      toast.error("You do not have permission to update this user.");
      return;
    }

    const nextLocked = !user.isLocked;

    try {
      setUpdatingId(user.id);
      await updateAppUserLocked(user.id, nextLocked);
      toast.success(
        `${user.displayName} has been ${nextLocked ? "locked" : "unlocked"}.`
      );
      await loadStaff();
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, "Unable to update lock status."));
    } finally {
      setUpdatingId(null);
    }
  }

  function handleEditPermissions(user: AppUserProfile) {
    if (!canManage(user) || user.role !== "staff") {
      toast.error("You do not have permission to edit these permissions.");
      return;
    }
    setPermissionsUser(user);
    setPermissionsOpen(true);
  }

  async function handleManagerChange(staffUser: AppUserProfile, managerId: string) {
    if (!isCreator || staffUser.role !== "staff") {
      toast.error("Only the Creator can assign Tier 2 managers.");
      return;
    }

    const nextManager = managerId.trim() || null;

    try {
      setUpdatingId(staffUser.id);
      await setStaffManagerAssignment(staffUser.id, nextManager);
      toast.success(
        nextManager
          ? `Manager updated for ${staffUser.displayName}.`
          : `Manager cleared for ${staffUser.displayName}.`
      );
      await loadStaff();
    } catch (error) {
      console.error(error);
      toast.error(getUserFacingError(error, "Unable to update manager assignment."));
    } finally {
      setUpdatingId(null);
    }
  }

  function handleOpenWhatsappDialog(user: AppUserProfile, mode: "enable" | "change") {
    if (
      !canManageWhatsapp ||
      !canManage(user) ||
      user.role === "creator" ||
      user.id === actorId
    ) {
      toast.error("You do not have permission to manage this account.");
      return;
    }
    // Handler-level defense: recheck the same predicate that gates the button.
    const ruleInput = whatsappRuleInput(user);
    if (mode === "enable" ? !canEnableWhatsappAccess(ruleInput) : !canChangeWhatsappAccess(ruleInput)) {
      toast.error("This account is not eligible for that WhatsApp change.");
      return;
    }
    setWhatsappDialogUser(user);
    setWhatsappDialogMode(mode);
    setWhatsappDialogOpen(true);
  }

  async function handleDisableWhatsapp() {
    const user = whatsappDisableTarget;
    if (
      !user ||
      !canManageWhatsapp ||
      !canManage(user) ||
      user.role === "creator" ||
      user.id === actorId
    ) {
      toast.error("You do not have permission to manage this account.");
      setWhatsappDisableOpen(false);
      setWhatsappDisableTarget(null);
      return;
    }
    // Handler-level defense: recheck eligibility AND the actual active
    // mapping signal rather than relying on the hidden button.
    if (!canDisableWhatsappAccess(whatsappRuleInput(user))) {
      toast.error("No active WhatsApp mapping to disable for this account.");
      setWhatsappDisableOpen(false);
      setWhatsappDisableTarget(null);
      return;
    }

    try {
      setUpdatingId(user.id);
      await disableWhatsappAccess(user.id);
      toast.success(`WhatsApp access disabled for ${user.displayName}.`);
      await loadStaff();
    } catch (error) {
      toast.error(
        getWhatsappAccessErrorMessage(error, "Unable to disable WhatsApp access.")
      );
    } finally {
      setUpdatingId(null);
      setWhatsappDisableOpen(false);
      setWhatsappDisableTarget(null);
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-card p-14 text-center shadow-sm">
        <ShieldAlert className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm font-medium text-foreground">
          Staff management is available to Creator and Tier 1 only.
        </p>
      </div>
    );
  }

  const tier1Options = staff.filter((u) => u.role === "admin");

  // Same actions, labels, handlers and visibility rules as before; they are
  // now grouped in a per-row "Manage" menu instead of a long button strip.
  const staffActions: StaffActionGroup[] = [
    {
      title: "Approval",
      actions: [
        {
          label: "Approve",
          onClick: (row) => handleSetApproval(row, "approved"),
          hidden: (row) =>
            !canManage(row) || row.approvalStatus === "approved",
        },
        {
          label: "Reject",
          variant: "destructive",
          onClick: (row) => handleSetApproval(row, "rejected"),
          hidden: (row) =>
            !canManage(row) || row.approvalStatus === "rejected",
        },
      ],
    },
    {
      title: "Role and permissions",
      actions: [
        {
          label: "Make Tier 1",
          onClick: handleToggleRole,
          // Creator-only; promote Tier 2 → Tier 1. Never offered to Tier 1.
          hidden: (row) =>
            !isCreator || !canManage(row) || row.role !== "staff",
        },
        {
          label: "Make Tier 2",
          onClick: handleToggleRole,
          // Creator-only; demote Tier 1 → Tier 2.
          hidden: (row) =>
            !isCreator || !canManage(row) || row.role !== "admin",
        },
        {
          label: "Edit Permissions",
          onClick: handleEditPermissions,
          hidden: (row) => !canManage(row) || row.role !== "staff",
        },
      ],
    },
    {
      title: "Sign-in",
      actions: [
        {
          label: "Unlock",
          onClick: (row) => handleToggleLock(row),
          hidden: (row) => !canManage(row) || !row.isLocked,
        },
        {
          label: "Lock",
          variant: "destructive",
          onClick: (row) => handleToggleLock(row),
          hidden: (row) => !canManage(row) || row.isLocked,
        },
      ],
    },
    {
      // WhatsApp Assistant access management is Creator-only. Enable/Change
      // follow M114 eligibility (account_ineligible / overrides excluded);
      // Disable remains available for cleanup of an active mapping.
      title: "WhatsApp Assistant",
      actions: [
        {
          label: "Enable WhatsApp",
          onClick: (row) => handleOpenWhatsappDialog(row, "enable"),
          hidden: (row) =>
            !canManageWhatsapp || !canManage(row) || row.role === "creator" || row.id === actorId ||
            !canEnableWhatsappAccess(whatsappRuleInput(row)),
        },
        {
          label: "Change WhatsApp",
          onClick: (row) => handleOpenWhatsappDialog(row, "change"),
          hidden: (row) =>
            !canManageWhatsapp || !canManage(row) || row.role === "creator" || row.id === actorId ||
            !canChangeWhatsappAccess(whatsappRuleInput(row)),
        },
        {
          label: "Disable WhatsApp",
          variant: "destructive",
          onClick: (row) => {
            setWhatsappDisableTarget(row);
            setWhatsappDisableOpen(true);
          },
          hidden: (row) =>
            !canManageWhatsapp || !canManage(row) || row.role === "creator" || row.id === actorId ||
            !canDisableWhatsappAccess(whatsappRuleInput(row)),
        },
      ],
    },
  ];

  const whatsappColumn: DataTableColumn<AppUserProfile> | null = canManageWhatsapp
    ? {
        key: "whatsapp",
        header: "WhatsApp",
        render: (row) => {
          const access = whatsappByUserId[row.id];
          if (!access) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          const enabled = access.effectiveAccessStatus.startsWith("enabled");
          return (
            <div className="space-y-1">
              <StatusBadge
                status={
                  enabled
                    ? "Active"
                    : access.effectiveAccessStatus === "account_ineligible"
                      ? "Pending"
                      : access.effectiveAccessStatus === "security_override_denied"
                        ? "Error"
                        : "Inactive"
                }
                label={WHATSAPP_ACCESS_STATUS_LABELS[access.effectiveAccessStatus]}
              />
              <p className="text-xs text-muted-foreground">
                {access.whatsappPhoneE164 ?? "No number linked"}
              </p>
              {enabled && (
                <p className="text-xs text-muted-foreground">
                  LR {access.effectiveLrAccess ? "✓" : "—"} · POD{" "}
                  {access.effectivePodAccess ? "✓" : "—"}
                </p>
              )}
            </div>
          );
        },
      }
    : null;

  const columns: DataTableColumn<AppUserProfile>[] = [
    {
      key: "displayName",
      header: "Staff member",
      sortable: true,
      render: (row) => (
        <span className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
          >
            {initials(row.displayName || row.email)}
          </span>
          <span className="block min-w-0">
            <span className="block truncate font-medium text-foreground">
              {row.displayName || "Unnamed"}
              {row.id === actorId && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>
              )}
            </span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{row.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: "role",
      header: "Tier",
      sortable: true,
      sortAccessor: (row) => TIER_ORDER[row.role] ?? 9,
      mobile: "top",
      render: (row) => <TierBadge role={row.role} label={organizationalRoleLabel(row.role)} />,
    },
    {
      key: "manager",
      header: "Manager",
      render: (row) => {
        if (row.role !== "staff") {
          return <span className="text-xs text-muted-foreground">—</span>;
        }

        const currentManagerId = managerByStaffId[row.id] ?? "";

        if (!isCreator) {
          const manager = staff.find((u) => u.id === currentManagerId);
          return (
            <span className="text-sm text-muted-foreground">
              {manager?.displayName ?? "Unassigned"}
            </span>
          );
        }

        return (
          <select
            className="h-8 w-full max-w-[12rem] rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
            value={currentManagerId}
            disabled={updatingId === row.id}
            onChange={(event) => {
              void handleManagerChange(row, event.target.value);
            }}
            aria-label={`Manager for ${row.displayName}`}
          >
            <option value="">Unassigned</option>
            {tier1Options.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.displayName}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: "approvalStatus",
      header: "Account",
      sortable: true,
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge
            status={row.approvalStatus}
            label={
              row.approvalStatus.charAt(0).toUpperCase() + row.approvalStatus.slice(1)
            }
          />
          {row.isLocked && <StatusBadge status="Error" label="Locked" />}
        </div>
      ),
    },
    {
      key: "access",
      header: "Access",
      render: (row) =>
        row.role === "creator" || row.role === "admin" ? (
          <StatusBadge status="Active" label="All Modules" />
        ) : row.fullAccess ? (
          <StatusBadge status="Active" label="Full Access" />
        ) : (
          <StatusBadge status="Pending" label="Restricted" />
        ),
    },
    ...(whatsappColumn ? [whatsappColumn] : []),
    {
      key: "manage",
      header: <span className="sr-only">Manage</span>,
      align: "right",
      mobile: "actions",
      render: (row) => (
        <StaffRowActions
          row={row}
          groups={staffActions}
          busy={updatingId === row.id}
        />
      ),
    },
  ];

  const counts = {
    all: staff.length,
    pending: staff.filter((u) => u.approvalStatus === "pending").length,
    approved: staff.filter((u) => u.approvalStatus === "approved").length,
    rejected: staff.filter((u) => u.approvalStatus === "rejected").length,
    locked: staff.filter((u) => u.isLocked).length,
  };
  const tier1Count = staff.filter((u) => u.role === "admin").length;

  const query = search.trim().toLowerCase();
  const visibleStaff = staff.filter((u) => {
    if (statusFilter === "locked" ? !u.isLocked : statusFilter !== "all" && u.approvalStatus !== statusFilter) {
      return false;
    }
    if (!query) return true;
    return `${u.displayName} ${u.email} ${organizationalRoleLabel(u.role)}`.toLowerCase().includes(query);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        buttonText=""
        showAddButton={false}
        subtitle={
          isCreator
            ? "Approve sign-ups, set tiers and permissions, assign managers, and control sign-in access."
            : "Approve Tier 2 sign-ups, edit their permissions, and control their sign-in access."
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile icon={Users} label="Total staff" value={counts.all} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} loading={loading} />
        <SummaryTile icon={Clock} label="Waiting for approval" value={counts.pending} tone="warning" active={statusFilter === "pending"} onClick={() => setStatusFilter("pending")} loading={loading} />
        <SummaryTile icon={Lock} label="Locked" value={counts.locked} tone="danger" active={statusFilter === "locked"} onClick={() => setStatusFilter("locked")} loading={loading} />
        <SummaryTile icon={Crown} label="Tier 1 managers" value={tier1Count} loading={loading} />
      </div>

      {!loading && counts.pending > 0 && statusFilter !== "pending" && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-center gap-3">
            <UserCheck className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            <p className="text-sm text-amber-900 dark:text-amber-100">
              {counts.pending === 1
                ? "1 new sign-up is waiting for your approval."
                : `${counts.pending} new sign-ups are waiting for your approval.`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setStatusFilter("pending")}>
            Review sign-ups
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, email or tier..."
              aria-label="Search staff"
              className="h-9 pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StaffStatusFilter)}
            aria-label="Filter staff by status"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:w-60"
          >
            <option value="all">All staff ({counts.all})</option>
            <option value="pending">Waiting for approval ({counts.pending})</option>
            <option value="approved">Approved ({counts.approved})</option>
            <option value="rejected">Rejected ({counts.rejected})</option>
            <option value="locked">Locked ({counts.locked})</option>
          </select>
          <Button variant="outline" className="h-9 gap-2" onClick={() => void loadStaff()} disabled={loading}>
            <RotateCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={visibleStaff}
          loading={loading}
          rowKey={(row) => row.id}
          emptyTitle={staff.length === 0 ? "No staff accounts yet" : "No staff match this search"}
          emptyDescription={
            staff.length === 0 ? undefined : "Try a different name, or clear the status filter."
          }
          emptyIcon={UserCog}
          getRowClassName={(row) =>
            row.approvalStatus === "pending"
              ? "bg-amber-50/60 dark:bg-amber-500/5"
              : row.isLocked
                ? "bg-muted/40"
                : undefined
          }
        />
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          {isCreator
            ? "Creator can manage Tier 1 and Tier 2, and assign Tier 2 staff to a Tier 1 manager. Creator designation is not available here."
            : "Tier 1 can manage Tier 2 staff only. Manager assignments are set by the Creator."}{" "}
          You cannot change your own role, approval status, or lock status from
          here. Creator cannot be modified from this page. LR ownership
          reassignment happens from the LR Entry table.
        </p>
      </div>

      <StaffPermissionsDialog
        user={permissionsUser}
        open={permissionsOpen}
        onOpenChange={setPermissionsOpen}
        onSaved={loadStaff}
      />

      <WhatsappAccessDialog
        target={whatsappDialogUser}
        access={whatsappDialogUser ? whatsappByUserId[whatsappDialogUser.id] ?? null : null}
        mode={whatsappDialogMode}
        open={whatsappDialogOpen}
        onOpenChange={setWhatsappDialogOpen}
        onSaved={loadStaff}
      />

      <ConfirmDialog
        open={whatsappDisableOpen}
        onOpenChange={setWhatsappDisableOpen}
        title={`Disable WhatsApp${whatsappDisableTarget ? ` — ${whatsappDisableTarget.displayName}` : ""}`}
        description="This preserves the mapping history but immediately stops WhatsApp Assistant access for this account. You can enable it again later."
        confirmLabel="Disable"
        loading={updatingId === whatsappDisableTarget?.id}
        onConfirm={handleDisableWhatsapp}
      />
    </div>
  );
}

/* ==========================================================
   Presentation helpers (layout only — no data access)
========================================================== */

type StaffStatusFilter = "all" | "pending" | "approved" | "rejected" | "locked";

interface StaffActionGroup {
  title: string;
  actions: DataTableAction<AppUserProfile>[];
}

const TIER_ORDER: Record<string, number> = { creator: 0, admin: 1, staff: 2 };

function initials(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function TierBadge({ role, label }: { role: string; label: string }) {
  const tone =
    role === "creator"
      ? "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200"
      : role === "admin"
        ? "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200"
        : "border-border bg-muted/60 text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", tone)}>
      {role === "creator" && <Crown className="h-3 w-3" aria-hidden="true" />}
      {label}
    </span>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  tone = "default",
  active = false,
  loading = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: "default" | "warning" | "danger";
  active?: boolean;
  loading?: boolean;
  onClick?: () => void;
}) {
  const iconTone =
    tone === "warning"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      : tone === "danger"
        ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
        : "bg-primary/10 text-primary";
  const content = (
    <>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", iconTone)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block text-xs leading-snug text-muted-foreground">{label}</span>
        <span className="block text-xl font-semibold tabular-nums text-foreground">
          {loading ? "–" : value}
        </span>
      </span>
    </>
  );
  const base = "flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs transition-colors";
  if (!onClick) return <div className={base}>{content}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        base,
        "outline-none hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/40",
        active && "border-primary/60 ring-1 ring-primary/30"
      )}
    >
      {content}
    </button>
  );
}

/** Per-row actions: quick Approve for pending sign-ups, everything else in a
 * grouped "Manage" menu. Visibility comes from each action's own `hidden`. */
function StaffRowActions({
  row,
  groups,
  busy,
}: {
  row: AppUserProfile;
  groups: StaffActionGroup[];
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const visibleGroups = groups
    .map((group) => ({ ...group, actions: group.actions.filter((a) => !a.hidden?.(row)) }))
    .filter((group) => group.actions.length > 0);

  if (busy) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Updating...
      </span>
    );
  }
  if (visibleGroups.length === 0) {
    return <span className="text-xs text-muted-foreground">No actions</span>;
  }

  const approve =
    row.approvalStatus === "pending"
      ? visibleGroups.flatMap((g) => g.actions).find((a) => a.label === "Approve")
      : undefined;

  return (
    <div className="flex items-center justify-end gap-2">
      {approve && (
        <Button size="sm" className="h-8 gap-1.5" onClick={() => approve.onClick(row)}>
          <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Approve
        </Button>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              aria-label={`Manage ${row.displayName}`}
            />
          }
        >
          <Ellipsis className="h-4 w-4" aria-hidden="true" />
          Manage
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 gap-1 p-1.5">
          {visibleGroups.map((group, index) => (
            <div key={group.title} className={cn(index > 0 && "mt-1 border-t border-border pt-1")}>
              <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {group.title}
              </p>
              {group.actions.map((action) => {
                const destructive = action.variant === "destructive";
                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      action.onClick(row);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                      destructive ? "text-destructive" : "text-foreground"
                    )}
                  >
                    {action.label}
                  </button>
                );
              })}
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
