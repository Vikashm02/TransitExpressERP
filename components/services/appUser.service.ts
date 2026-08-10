import { supabase } from "@/lib/supabase";

/**
 * The app's staff-identity profile — one row per Supabase Auth user
 * (see migration 017's `app_users` table + `handle_new_auth_user()`
 * trigger). This is intentionally the ONLY place "Admin" vs "Staff"
 * is decided; every ownership check elsewhere (LR/POD/Lorry Expenses
 * RLS policies, and the client-side `isAdmin` flag from
 * `lib/auth/AuthProvider.tsx`) reads from this same `role` column.
 */
export interface AppUserProfile {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "staff";
}

const TABLE = "app_users";

interface AppUserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
}

function fromRow(row: AppUserRow): AppUserProfile {
  return {
    id: row.id,
    email: row.email ?? "",
    displayName: row.display_name?.trim() || row.email || "Unnamed",
    role: row.role === "admin" ? "admin" : "staff",
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
