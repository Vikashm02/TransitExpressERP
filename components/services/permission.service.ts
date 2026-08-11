import { supabase } from "@/lib/supabase";
import type { PermissionKey, PermissionLevel } from "@/lib/permissions";

/**
 * CRUD for `app_user_permissions` (migration 019) — the per-module,
 * per-staff-member permission rows behind the Staff / Sub-User Access
 * Control system. `getMyPermissions()` is called once per session by
 * `AuthProvider` (alongside the profile fetch); `getUserPermissions()`
 * + `setUserPermission()` back the Admin-only Edit Permissions dialog
 * on the Staff page. Reads/writes are additionally protected by RLS
 * (a staff member can only ever read their own row; only an Admin can
 * write any row) — see that migration for details.
 */

const TABLE = "app_user_permissions";

interface AppUserPermissionRow {
  permission_key: string;
  permission_level: string | null;
}

function normalizeLevel(level: string | null): PermissionLevel {
  return level === "view" || level === "create_view" || level === "edit" ? level : "none";
}

export type PermissionMap = Partial<Record<PermissionKey, PermissionLevel>>;

async function fetchPermissions(userId: string): Promise<PermissionMap> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("permission_key, permission_level")
    .eq("user_id", userId);

  if (error) throw error;

  const map: PermissionMap = {};
  for (const row of (data ?? []) as AppUserPermissionRow[]) {
    map[row.permission_key as PermissionKey] = normalizeLevel(row.permission_level);
  }
  return map;
}

/** Used by AuthProvider right after sign-in, for the current user. */
export async function getMyPermissions(userId: string): Promise<PermissionMap> {
  return fetchPermissions(userId);
}

/** Used by the Staff page's Edit Permissions dialog for any user. */
export async function getUserPermissions(userId: string): Promise<PermissionMap> {
  return fetchPermissions(userId);
}

/**
 * Admin-only: set a single module's permission level for a staff
 * member. Setting `"none"` still leaves a row behind (rather than
 * deleting it) so the Edit Permissions dialog has an explicit value
 * to show — `getMyPermissions()` treats a missing row the same as
 * `"none"` either way.
 */
export async function setUserPermission(
  userId: string,
  key: PermissionKey,
  level: PermissionLevel
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      { user_id: userId, permission_key: key, permission_level: level },
      { onConflict: "user_id,permission_key" }
    );

  if (error) throw error;
}
