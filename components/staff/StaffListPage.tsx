"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
  /** staffId → managerId (Creator assignment UI). */
  const [managerByStaffId, setManagerByStaffId] = useState<Record<string, string>>(
    {}
  );

  const actorRole = profile?.role ?? "staff";
  const actorId = profile?.id ?? "";

  const loadStaff = useCallback(async () => {
    try {
      setLoading(true);
      const [data, assignments] = await Promise.all([
        getStaffUsers(),
        getStaffManagerAssignments().catch(() => []),
      ]);
      setStaff(data);
      const map: Record<string, string> = {};
      for (const row of assignments) {
        map[row.staffId] = row.managerId;
      }
      setManagerByStaffId(map);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load staff.");
    } finally {
      setLoading(false);
    }
  }, []);

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
      toast.error("Unable to update role.");
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
      toast.error("Unable to update approval status.");
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
      toast.error("Unable to update lock status.");
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
      toast.error("Unable to update manager assignment.");
    } finally {
      setUpdatingId(null);
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
    </div>
  );
}
