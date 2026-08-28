import { supabase } from "@/lib/supabase";
import {
  actionsToLevel,
  levelToActions,
  type ModuleActions,
  type PermissionAction,
  type PermissionKey,
  type PermissionLevel,
  EMPTY_MODULE_ACTIONS,
} from "@/lib/permissions";

/**
 * CRUD for `app_user_permissions` (migrations 019 + 033).
 */

const TABLE = "app_user_permissions";

interface AppUserPermissionRow {
  permission_key: string;
  permission_level: string | null;
  can_view?: boolean | null;
  can_create?: boolean | null;
  can_edit?: boolean | null;
  can_delete?: boolean | null;
  can_print?: boolean | null;
  can_share?: boolean | null;
}

function normalizeLevel(level: string | null): PermissionLevel {
  return level === "view" || level === "create_view" || level === "edit" ? level : "none";
}

function rowToActions(row: AppUserPermissionRow): ModuleActions {
  const hasFlags =
    row.can_view != null ||
    row.can_create != null ||
    row.can_edit != null ||
    row.can_delete != null ||
    row.can_print != null ||
    row.can_share != null;

  if (hasFlags) {
    return {
      view: Boolean(row.can_view),
      create: Boolean(row.can_create),
      edit: Boolean(row.can_edit),
      delete: Boolean(row.can_delete),
      print: Boolean(row.can_print),
      share: Boolean(row.can_share),
    };
  }

  return levelToActions(normalizeLevel(row.permission_level));
}

export type PermissionMap = Partial<Record<PermissionKey, PermissionLevel>>;
export type PermissionActionsMap = Partial<Record<PermissionKey, ModuleActions>>;

async function fetchPermissionActions(userId: string): Promise<PermissionActionsMap> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "permission_key, permission_level, can_view, can_create, can_edit, can_delete, can_print, can_share"
    )
    .eq("user_id", userId);

  if (error) throw error;

  const map: PermissionActionsMap = {};
  for (const row of (data ?? []) as AppUserPermissionRow[]) {
    map[row.permission_key as PermissionKey] = rowToActions(row);
  }
  return map;
}

function actionsMapToLevelMap(actions: PermissionActionsMap): PermissionMap {
  const map: PermissionMap = {};
  for (const [key, value] of Object.entries(actions)) {
    map[key as PermissionKey] = actionsToLevel(value ?? EMPTY_MODULE_ACTIONS);
  }
  return map;
}

/** Used by AuthProvider right after sign-in, for the current user. */
export async function getMyPermissionActions(userId: string): Promise<PermissionActionsMap> {
  return fetchPermissionActions(userId);
}

/** @deprecated Prefer getMyPermissionActions — kept for transitional callers. */
export async function getMyPermissions(userId: string): Promise<PermissionMap> {
  return actionsMapToLevelMap(await fetchPermissionActions(userId));
}

export async function getUserPermissionActions(userId: string): Promise<PermissionActionsMap> {
  return fetchPermissionActions(userId);
}

/** Used by the Staff page's Edit Permissions dialog for any user. */
export async function getUserPermissions(userId: string): Promise<PermissionMap> {
  return actionsMapToLevelMap(await fetchPermissionActions(userId));
}

export async function setUserModuleActions(
  userId: string,
  key: PermissionKey,
  actions: ModuleActions
): Promise<void> {
  const level = actionsToLevel(actions);
  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: userId,
      permission_key: key,
      permission_level: level,
      can_view: actions.view,
      can_create: actions.create,
      can_edit: actions.edit,
      // Delete is universally admin-only (migration 047) — never grant via staff UI.
      can_delete: false,
      can_print: actions.print,
      can_share: actions.share,
    },
    { onConflict: "user_id,permission_key" }
  );

  if (error) throw error;
}

/**
 * Admin-only: set a single module's permission level for a staff
 * member (expands into action flags for migration 033 columns).
 */
export async function setUserPermission(
  userId: string,
  key: PermissionKey,
  level: PermissionLevel
): Promise<void> {
  await setUserModuleActions(userId, key, levelToActions(level));
}

export type { PermissionAction };
