import { supabase } from "@/lib/supabase";

/**
 * The app's staff-identity profile — one row per Supabase Auth user
 * (see migration 017's `app_users` table + `handle_new_auth_user()`
 * trigger). This is intentionally the ONLY place "Admin" vs "Staff"
 * is decided; every ownership check elsewhere (LR/POD/Lorry Expenses
 * RLS policies, and the client-side `isAdmin` flag from
 * `lib/auth/AuthProvider.tsx`) reads from this same `role` column.
 *
 * `approvalStatus` (migration 018) gates whether a signed-in user may
 * use the app at all — see `DashboardLayout.tsx`, which blocks anyone
 * whose status isn't "approved". It is independent of `role`.
 *
 * `fullAccess` / `isLocked` (migration 019) are the Staff / Sub-User
 * Access Control master switches: `fullAccess` makes a staff account
 * behave as if every module permission were set to Edit, without a
 * row per module; `isLocked` blocks the account outright regardless
 * of `fullAccess` or any individual permission. Both are Admin-only
 * to change (see `app_users_update_admin_only` RLS policy) and are
 * independent of `role`/`approvalStatus`.
 */
export interface AppUserProfile {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "staff";
  approvalStatus: "pending" | "approved" | "rejected";
  fullAccess: boolean;
  isLocked: boolean;
}

const TABLE = "app_users";

interface AppUserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  approval_status: string | null;
  full_access: boolean | null;
  is_locked: boolean | null;
}

function fromRow(row: AppUserRow): AppUserProfile {
  return {
    id: row.id,
    email: row.email ?? "",
    displayName: row.display_name?.trim() || row.email || "Unnamed",
    role: row.role === "admin" ? "admin" : "staff",
    approvalStatus: row.approval_status === "approved" || row.approval_status === "rejected"
      ? row.approval_status
      : "pending",
    fullAccess: Boolean(row.full_access),
    isLocked: Boolean(row.is_locked),
  };
}

/* ==========================================================
   GET MY PROFILE (used by AuthProvider right after sign-in)
========================================================== */

export async function getMyProfile(userId: string): Promise<AppUserProfile | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;

  return data ? fromRow(data as AppUserRow) : null;
}

/* ==========================================================
   GET ALL STAFF (Assigned To pickers, Staff admin page)
========================================================== */

export async function getStaffUsers(): Promise<AppUserProfile[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("display_name", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => fromRow(row as AppUserRow));
}

/* ==========================================================
   ADMIN-ONLY: PROMOTE/DEMOTE, RENAME
   (RLS on `app_users` additionally enforces admin-only at the
   database layer — see migration 017 — so this is not the only
   protection, just the client-side entry point.)
========================================================== */

export async function updateAppUserRole(id: string, role: "admin" | "staff"): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ role }).eq("id", id);
  if (error) throw error;
}

export async function updateAppUserDisplayName(id: string, displayName: string): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ display_name: displayName }).eq("id", id);
  if (error) throw error;
}

/**
 * Admin-only: approve/reject a pending signup, or reverse a prior
 * decision. Same RLS protection as `updateAppUserRole` above — the
 * `app_users_update_admin_only` policy (migration 017) rejects this
 * update unless the caller is already an admin, so a staff account
 * cannot approve/reject themselves or anyone else even if they call
 * this function directly.
 */
export async function updateAppUserApprovalStatus(
  id: string,
  approvalStatus: "pending" | "approved" | "rejected"
): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ approval_status: approvalStatus }).eq("id", id);
  if (error) throw error;
}

/**
 * Admin-only: toggle the "Full Access" master switch for a staff
 * account (migration 019). Same RLS protection as the functions
 * above — a staff account cannot grant this to themselves.
 */
export async function updateAppUserFullAccess(id: string, fullAccess: boolean): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ full_access: fullAccess }).eq("id", id);
  if (error) throw error;
}

/**
 * Admin-only: lock/unlock a staff account (migration 019). A locked
 * account is blocked by `DashboardLayout` regardless of role,
 * approval status, or any permission, and — for `lrs`/`pods`
 * specifically — by `public.has_permission()` at the database layer
 * too (see that migration's Part C).
 */
export async function updateAppUserLocked(id: string, isLocked: boolean): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ is_locked: isLocked }).eq("id", id);
  if (error) throw error;
}
