"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, UserCog } from "lucide-react";

import DataTable, { type DataTableColumn } from "@/components/common/DataTable";
import StatusBadge from "@/components/ui/StatusBadge";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  getStaffUsers,
  updateAppUserRole,
  type AppUserProfile,
} from "@/components/services/appUser.service";

/**
 * Admin-only staff roster. Lets an admin promote/demote a staff member
 * between "staff" and "admin" — the ONLY way any account (after the
 * very first, manually-bootstrapped Admin — see the "INITIAL ADMIN
 * BOOTSTRAP" section in migration 017) can ever become Admin. Every
 * new sign-up always starts as "staff" (enforced server-side); nobody,
 * including the person using this page, can promote themselves — the
 * `app_users_update_admin_only` RLS policy rejects any update not
 * coming from an already-authenticated Admin, so this is enforced at
 * the database layer, not just by the client-side `hidden` rule below.
 * Reassigning an individual LR to a staff member happens from the LR
 * table itself (see LRTable.tsx's "Reassign" action), not here — this
 * page only manages roles.
 */
export default function StaffListPage() {
  const { isAdmin, profile } = useAuth();
  const [staff, setStaff] = useState<AppUserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getStaffUsers();
      setStaff(data);
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

  async function handleToggleRole(user: AppUserProfile) {
    const nextRole = user.role === "admin" ? "staff" : "admin";

    try {
      setUpdatingId(user.id);
      await updateAppUserRole(user.id, nextRole);
      toast.success(`${user.displayName} is now ${nextRole === "admin" ? "an Administrator" : "Staff"}.`);
      await loadStaff();
    } catch (error) {
      console.error(error);
      toast.error("Unable to update role.");
    } finally {
      setUpdatingId(null);
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-card p-14 text-center shadow-sm">
        <ShieldAlert className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm font-medium text-foreground">Staff management is available to Administrators only.</p>
      </div>
    );
  }

  const columns: DataTableColumn<AppUserProfile>[] = [
    { key: "displayName", header: "Name", sortable: true, className: "font-medium" },
    { key: "email", header: "Email", sortable: true },
    {
      key: "role",
      header: "Role",
      sortable: true,
      render: (row) => <StatusBadge status={row.role === "admin" ? "Active" : "Pending"} label={row.role === "admin" ? "Admin" : "Staff"} />,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Staff</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Promote/demote staff accounts. LR ownership reassignment happens from the LR Entry table.
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
            label: "Toggle Role",
            onClick: handleToggleRole,
            hidden: (row) => Boolean(profile && row.id === profile.id),
          },
        ]}
      />

      <p className="text-xs text-muted-foreground">
        You cannot change your own role from here — ask another Administrator if you need to step down.
      </p>

      {updatingId && (
        <p className="text-xs text-muted-foreground">Updating...</p>
      )}
    </div>
  );
}
