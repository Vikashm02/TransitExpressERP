// Server-only notification recipient resolution. Delivery channels are
// deliberately not consulted: an eligible user may have zero, one, or many
// browser/native devices.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type AppUser = {
  id: string;
  role: string | null;
  full_access: boolean | null;
};

type ModulePermission = {
  user_id: string;
  can_view: boolean | null;
  can_create: boolean | null;
  can_edit: boolean | null;
  permission_level: string | null;
};

const LEGACY_VIEW_LEVELS = new Set(["view", "create_view", "edit"]);

/**
 * Returns approved, unlocked users permitted to see a module. This mirrors
 * the ERP's view semantics: granular view/create/edit access wins; otherwise
 * the legacy permission level remains a compatibility fallback.
 */
export async function resolveEligibleNotificationRecipients(
  admin: SupabaseClient,
  permissionKey: string
): Promise<string[]> {
  const { data: users, error: usersError } = await admin
    .from("app_users")
    .select("id, role, full_access")
    .eq("approval_status", "approved")
    .eq("is_locked", false);

  if (usersError) throw usersError;

  const activeUsers = (users ?? []) as AppUser[];
  const eligible = new Set<string>();
  const permissionCandidates: string[] = [];

  for (const user of activeUsers) {
    if (user.role === "creator" || user.role === "admin" || user.full_access === true) {
      eligible.add(user.id);
    } else {
      permissionCandidates.push(user.id);
    }
  }

  if (permissionCandidates.length === 0) return [...eligible];

  const { data: permissions, error: permissionsError } = await admin
    .from("app_user_permissions")
    .select("user_id, can_view, can_create, can_edit, permission_level")
    .eq("permission_key", permissionKey)
    .in("user_id", permissionCandidates);

  if (permissionsError) throw permissionsError;

  for (const permission of (permissions ?? []) as ModulePermission[]) {
    const hasGranularAccess =
      permission.can_view === true || permission.can_create === true || permission.can_edit === true;
    const hasLegacyAccess = LEGACY_VIEW_LEVELS.has(permission.permission_level ?? "none");

    if (hasGranularAccess || hasLegacyAccess) eligible.add(permission.user_id);
  }

  return [...eligible];
}
