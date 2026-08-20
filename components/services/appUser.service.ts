import { supabase } from "@/lib/supabase";

/**
 * The app's staff-identity profile — one row per Supabase Auth user
 * (see migration 017's `app_users` table + `handle_new_auth_user()`
 * trigger). Organizational levels (migration 041):
 *   creator = Creator (exactly one)
 *   admin   = Tier 1 (operational administrator)
 *   staff   = Tier 2 (normal operational staff)
 *
 * Module administrator access (Creator OR Tier 1) is exposed to the
 * client as `isAdmin` from `lib/auth/AuthProvider.tsx`. Staff management
 * hierarchy is separate and enforced by RLS + helpers below.
 *
 * `approvalStatus` (migration 018) gates whether a signed-in user may
 * use the app at all — see `DashboardLayout.tsx`. Independent of role.
 *
 * `fullAccess` / `isLocked` (migration 019) are Tier 2 access-control
 * switches (also applicable when Creator manages Tier 1 profile fields).
 */
export type AppUserRole = "creator" | "admin" | "staff";

export interface AppUserProfile {
  id: string;
  email: string;
  displayName: string;
  role: AppUserRole;
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

/** Parse DB role without collapsing creator → staff. */
export function parseAppUserRole(role: string | null | undefined): AppUserRole {
  if (role === "creator") return "creator";
  if (role === "admin") return "admin";
  return "staff";
}

export function organizationalRoleLabel(role: AppUserRole): string {
  switch (role) {
    case "creator":
      return "Creator";
    case "admin":
      return "Tier 1";
    case "staff":
      return "Tier 2";
  }
}

/**
 * Whether the actor may manage the target via Staff UI / app_users updates.
 * Mirrors migration 041 hierarchy (UI only — RLS is authoritative).
 * Never allows managing Creator or self. Never allows Tier 1 → Tier 1.
 */
export function canManageStaffTarget(
  actorRole: AppUserRole,
  actorId: string,
  target: Pick<AppUserProfile, "id" | "role">
): boolean {
  if (!actorId || target.id === actorId) return false;
  if (target.role === "creator") return false;
  if (actorRole === "creator") {
    return target.role === "admin" || target.role === "staff";
  }
  if (actorRole === "admin") {
    return target.role === "staff";
  }
  return false;
}

function fromRow(row: AppUserRow): AppUserProfile {
  return {
    id: row.id,
    email: row.email ?? "",
    displayName: row.display_name?.trim() || row.email || "Unnamed",
    role: parseAppUserRole(row.role),
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
   HIERARCHY: PROMOTE/DEMOTE BETWEEN Tier 1 (admin) AND Tier 2 (staff)
   Creator designation is NEVER available here — only migration 041 /
   service_role designate_creator(uuid).
========================================================== */

export async function updateAppUserRole(
  id: string,
  role: "admin" | "staff"
): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ role }).eq("id", id);
  if (error) throw error;
}

export async function updateAppUserDisplayName(id: string, displayName: string): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ display_name: displayName }).eq("id", id);
  if (error) throw error;
}

/**
 * Approve/reject a pending signup, or reverse a prior decision.
 * Caller must be allowed by RLS hierarchy (Creator → Tier1/Tier2;
 * Tier1 → Tier2 only).
 */
export async function updateAppUserApprovalStatus(
  id: string,
  approvalStatus: "pending" | "approved" | "rejected"
): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ approval_status: approvalStatus }).eq("id", id);
  if (error) throw error;
}

/**
 * Toggle Full Access for a manageable staff account (typically Tier 2).
 */
export async function updateAppUserFullAccess(id: string, fullAccess: boolean): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ full_access: fullAccess }).eq("id", id);
  if (error) throw error;
}

/**
 * Lock/unlock a manageable account. RLS blocks Creator targets and
 * Tier 1→Tier 1 / Tier 1→Creator.
 */
export async function updateAppUserLocked(id: string, isLocked: boolean): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ is_locked: isLocked }).eq("id", id);
  if (error) throw error;
}
