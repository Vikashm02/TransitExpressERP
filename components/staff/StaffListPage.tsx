"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getUserFacingError } from "@/lib/errors/getUserFacingError";
import { ShieldAlert, UserCog } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
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
    { key: "displayName", header: "Name", sortable: true, className: "font-medium" },
    { key: "email", header: "Email", sortable: true },
    {
      key: "role",
      header: "Tier",
      sortable: true,
      render: (row) => (
        <StatusBadge
          status={
            row.role === "creator" || row.role === "admin" ? "Active" : "Pending"
          }
          label={organizationalRoleLabel(row.role)}
        />
      ),
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
            <span className="text-xs text-muted-foreground">
              {manager?.displayName ?? "Unassigned"}
            </span>
          );
        }

        return (
          <select
            className="max-w-[11rem] rounded-md border border-border bg-background px-2 py-1 text-xs"
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
      header: "Approval",
      sortable: true,
      render: (row) => (
        <StatusBadge
          status={row.approvalStatus}
          label={
            row.approvalStatus.charAt(0).toUpperCase() + row.approvalStatus.slice(1)
          }
        />
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
    {
      key: "isLocked",
      header: "Locked",
      sortable: true,
      render: (row) => (
        <StatusBadge
          status={row.isLocked ? "Error" : "Active"}
          label={row.isLocked ? "Locked" : "Active"}
        />
      ),
    },
    ...(whatsappColumn ? [whatsappColumn] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Staff
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isCreator
            ? "Creator can manage Tier 1 and Tier 2, and assign Tier 2 staff to a Tier 1 manager. Creator designation is not available here."
            : "Tier 1 can manage Tier 2 staff only. Manager assignments are set by the Creator."}{" "}
          LR ownership reassignment happens from the LR Entry table.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={staff}
        loading={loading}
        rowKey={(row) => row.id}
        emptyTitle="No staff accounts yet"
        emptyIcon={UserCog}
        actions={[
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
          // WhatsApp Assistant access management is Creator-only. Enable/Change
          // follow M114 eligibility (account_ineligible / overrides excluded);
          // Disable remains available for cleanup of an active mapping.
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
        ]}
      />

      <p className="text-xs text-muted-foreground">
        You cannot change your own role, approval status, or lock status from
        here. Creator cannot be modified from this page.
      </p>

      {updatingId && (
        <p className="text-xs text-muted-foreground">Updating...</p>
      )}

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
