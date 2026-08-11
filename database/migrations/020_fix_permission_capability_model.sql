-- ==========================================================
-- Migration: 020_fix_permission_capability_model
-- Module:    Staff / Sub-User Access Control (follow-up to 019)
--
-- Reference: lib/permissions.ts
--            database/migrations/019_add_staff_permissions.sql
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- against the target Supabase project. Migrations 001-019 are
-- untouched; this is purely additive (single function replacement,
-- no columns/tables/data touched).
--
-- Why this is needed:
--   `public.has_permission()` (migration 019, Part C) compared
--   permission levels with a single continuous ranking:
--
--     array_position(levels, have) >= array_position(levels, need)
--
--   with levels = ['none', 'view', 'create_view', 'edit']. Because
--   'edit' sits after 'create_view' in that array, an 'edit'-level
--   user satisfied `has_permission(key, 'create_view')` too — i.e.
--   Edit silently also unlocked Create at the database layer.
--
--   `lib/permissions.ts` has already been corrected client-side to
--   treat 'create_view' and 'edit' as independent capabilities that
--   both build on 'view', NOT as one strictly containing the other:
--     - create_view unlocks Create, but not Edit.
--     - edit unlocks Edit, but not Create.
--   This migration makes `public.has_permission()` match that same
--   capability model, so the UI (which now hides Create for an
--   'edit'-level user) and the database RLS (which, until this
--   migration, still allowed that same user to INSERT via a direct
--   API call) agree.
--
-- What this changes:
--   ONLY the permission-level comparison inside
--   `public.has_permission(p_key text, p_min_level text)`. Function
--   name, parameters, return type, `security definer`, `set
--   search_path = public`, the admin bypass, the locked/unapproved
--   account checks, the `full_access` bypass, and the permission-row
--   lookup are all preserved byte-for-byte from migration 019 — see
--   the unchanged lines below. No RLS policy definitions are touched:
--   inspection of every `has_permission()` call site (migration 019,
--   Part D — `lrs_select_own_or_admin`, `lrs_insert_authenticated`,
--   `lrs_update_own_or_admin`, `pods_select_own_lr_or_admin`,
--   `pods_insert_own_lr_or_admin`, `pods_update_own_lr_or_admin`)
--   confirms every one of them already requests the correct level for
--   its action (view for select, create_view for insert, edit for
--   update/update-check), so none of those policies need to change —
--   only what `has_permission()` itself decides for a given stored
--   level now differs.
--
-- New behavior:
--   requested 'view'         -> stored view/create_view/edit  => true
--   requested 'create_view'  -> stored create_view             => true
--                                stored edit                    => false (was true)
--   requested 'edit'         -> stored edit                     => true
--                                stored view/create_view         => false
--   requested 'none'         -> always false (deny; 'none' is never
--                                a real requirement in application
--                                code, but a protected module must
--                                not be accessible if it were)
--   admin / full_access / locked / unapproved handling: unchanged.
-- ==========================================================

create or replace function public.has_permission(p_key text, p_min_level text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_approval text;
  v_locked boolean;
  v_full_access boolean;
  v_level text;
begin
  select role, approval_status, is_locked, full_access
    into v_role, v_approval, v_locked, v_full_access
  from public.app_users
  where id = auth.uid();

  -- No profile at all (shouldn't happen for an authenticated caller,
  -- but fail closed rather than open).
  if v_role is null then
    return false;
  end if;

  if v_role = 'admin' then
    return true;
  end if;

  -- Locked or not-yet-approved staff can never pass, no matter what
  -- full_access or their permission rows say.
  if coalesce(v_locked, false) or coalesce(v_approval, 'pending') <> 'approved' then
    return false;
  end if;

  if coalesce(v_full_access, false) then
    return true;
  end if;

  select permission_level into v_level
  from public.app_user_permissions
  where user_id = auth.uid()
    and permission_key = p_key;

  v_level := coalesce(v_level, 'none');

  -- Capability model: 'create_view' and 'edit' are independent
  -- capabilities that both build on 'view' — neither one contains
  -- the other. See file header for why this replaced the old
  -- continuous array_position() ranking.
  if p_min_level = 'view' then
    return v_level in ('view', 'create_view', 'edit');
  elsif p_min_level = 'create_view' then
    return v_level = 'create_view';
  elsif p_min_level = 'edit' then
    return v_level = 'edit';
  else
    return false;
  end if;
end;
$$;

-- ==========================================================
-- END 020
-- ==========================================================
