-- ==========================================================
-- Migration: 041_creator_tier1_tier2_role_hierarchy
-- Module:    Organizational role hierarchy (authorization foundation)
--
-- REVISION: security-hardened (Creator self-row freeze, privileged
--           designate_creator context, EXECUTE grants tightened).
--
-- Introduces three organizational levels on public.app_users.role:
--   creator = Creator (exactly one; highest authority)
--   admin   = Tier 1 (operational administrator)
--   staff   = Tier 2 (normal operational staff)
--
-- Existing rows:
--   role = 'admin'  → remain Tier 1 (unchanged value)
--   role = 'staff'  → remain Tier 2 (unchanged value)
--
-- Creator is NOT auto-assigned. After applying this migration, designate
-- the single Creator with the controlled function below using the
-- app_users / auth.users UUID (never hardcode an email in app code):
--
--   select public.designate_creator('<uuid>'::uuid);
--
-- Privilege escalation protection is enforced in:
--   1) RLS on public.app_users UPDATE (via current_app_user_role();
--      no recursive subquery on app_users inside the policy)
--   2) RLS on public.app_user_permissions INSERT/UPDATE/DELETE
--      (via can_manage_app_user() SECURITY DEFINER helper)
--   3) BEFORE INSERT/UPDATE trigger on public.app_users
--   4) Partial unique index guaranteeing at most one Creator
--   5) designate_creator() requires privileged context (not merely a GUC)
--
-- Module / ERP administrator access (Creator + Tier 1):
--   public.is_admin() and public.is_app_admin() return true for
--   role IN ('creator', 'admin'). has_permission / has_module_action
--   treat creator like the previous admin bypass (same order as
--   production migration 033: admin bypass before lock/approval checks).
--
-- Staff management authority (separate from module access):
--   Creator → manage Tier 1 and Tier 2; limited self profile fields only
--   Tier 1  → manage Tier 2 only
--   Tier 2  → manage nobody
--
-- NOT executed automatically — run manually against Supabase after review.
-- Does NOT touch Assistant, LR, Material Description, or device security.
-- ==========================================================


-- ----------------------------------------------------------
-- PART A — role constraint: allow 'creator'
-- ----------------------------------------------------------

alter table public.app_users
  drop constraint if exists app_users_role_check;

alter table public.app_users
  add constraint app_users_role_check
  check (role in ('creator', 'admin', 'staff'));


-- At most one Creator row.
create unique index if not exists app_users_single_creator_idx
  on public.app_users ((1))
  where role = 'creator';


-- ----------------------------------------------------------
-- PART B — hierarchy helpers
-- ----------------------------------------------------------

-- Caller's organizational role only (auth.uid()). Used by app_users
-- UPDATE RLS so policies do NOT subquery public.app_users (avoids
-- recursive RLS evaluation). SECURITY DEFINER reads as owner.
create or replace function public.current_app_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.app_users
  where id = auth.uid();
$$;

-- True when the calling user is the Creator.
create or replace function public.is_creator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_user_role() = 'creator';
$$;

-- Operational / module administrator: Creator OR Tier 1.
-- Preserves existing callers of is_admin() (LR ownership helpers, RLS
-- that meant "administrator", etc.) without weakening staff checks.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_users
    where id = auth.uid()
      and role in ('creator', 'admin')
  );
$$;

-- Notifications / announcements admin helper (migration 028).
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_users
    where id = auth.uid()
      and role in ('creator', 'admin')
  );
$$;

-- Staff-management authority over a target app_users row.
-- Does NOT grant module permissions; only who-may-manage-whom.
-- Creator managing self is FALSE here — self updates use a separate
-- trigger path that freezes organizational/security columns.
create or replace function public.can_manage_app_user(p_target_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  if p_target_id is null or auth.uid() is null then
    return false;
  end if;

  -- Never "manage" yourself through the staff-management helper.
  if p_target_id = auth.uid() then
    return false;
  end if;

  select role into v_actor_role
  from public.app_users
  where id = auth.uid();

  select role into v_target_role
  from public.app_users
  where id = p_target_id;

  if v_actor_role is null or v_target_role is null then
    return false;
  end if;

  if v_actor_role = 'creator' then
    return v_target_role in ('admin', 'staff');
  end if;

  if v_actor_role = 'admin' then
    return v_target_role = 'staff';
  end if;

  return false;
end;
$$;

-- Privileged context for Creator designation only.
-- NOT granted to anon/authenticated — defense in depth for the trigger.
--
-- Uses ONLY the request JWT role claim. Do NOT use current_user /
-- session_user here: this function is SECURITY DEFINER, so current_user
-- is the function owner (often postgres), which would incorrectly treat
-- ordinary authenticated calls as privileged.
--
-- In Supabase/PostgREST, auth.jwt() reflects the *request* JWT even
-- inside SECURITY DEFINER (it does not switch to the definer's identity).
-- Browser users present role=authenticated (or anon); only the service
-- role API key presents role=service_role.
create or replace function public.is_privileged_creator_designation_context()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;


-- ----------------------------------------------------------
-- PART C — controlled Creator designation (UUID only)
-- ----------------------------------------------------------
-- GUC alone is NOT sufficient: authenticated clients can call set_config.
-- Trigger accepts Creator assignment only when GUC is on AND this
-- privileged context is true (set inside designate_creator after check).

create or replace function public.designate_creator(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if not public.is_privileged_creator_designation_context() then
    raise exception
      'designate_creator: service_role JWT required';
  end if;

  if p_user_id is null then
    raise exception 'designate_creator: user id is required';
  end if;

  if not exists (select 1 from public.app_users where id = p_user_id) then
    raise exception 'designate_creator: app_users row not found for %', p_user_id;
  end if;

  select id into v_existing
  from public.app_users
  where role = 'creator'
  limit 1;

  if v_existing is not null and v_existing <> p_user_id then
    raise exception
      'designate_creator: a Creator already exists (%). Transfer is not supported by this function.',
      v_existing;
  end if;

  if v_existing = p_user_id then
    return; -- already Creator
  end if;

  perform set_config('app.allow_creator_designation', 'on', true);

  update public.app_users
  set role = 'creator'
  where id = p_user_id;

  perform set_config('app.allow_creator_designation', 'off', true);
end;
$$;


-- ----------------------------------------------------------
-- PART D — trigger: block illegal role / target mutations
-- ----------------------------------------------------------

create or replace function public.app_users_enforce_role_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_allow_creator text;
  v_privileged boolean;
begin
  v_allow_creator := nullif(current_setting('app.allow_creator_designation', true), '');
  v_privileged := public.is_privileged_creator_designation_context();

  -- Controlled designation path: GUC + privileged context (not GUC alone).
  if coalesce(v_allow_creator, '') = 'on' and v_privileged then
    if tg_op = 'UPDATE'
       and new.role = 'creator'
       and old.role is distinct from 'creator'
       and new.id is not distinct from old.id
       and new.approval_status is not distinct from old.approval_status
       and new.is_locked is not distinct from old.is_locked
       and new.full_access is not distinct from old.full_access then
      return new;
    end if;
  end if;

  -- Never assign Creator through ordinary writes (including GUC-only abuse).
  if new.role = 'creator'
     and (tg_op = 'INSERT' or old.role is distinct from 'creator') then
    raise exception
      'Cannot assign Creator role through ordinary staff updates. Use public.designate_creator(uuid).';
  end if;

  -- Never demote / reassign Creator through ordinary writes.
  if tg_op = 'UPDATE'
     and old.role = 'creator'
     and new.role is distinct from 'creator' then
    raise exception 'Cannot change or demote the Creator role through ordinary updates.';
  end if;

  -- Signup trigger / security definer inserts with auth.uid() null are OK
  -- only for staff (handle_new_auth_user). No admin/creator via this path.
  if v_actor_id is null then
    if tg_op = 'INSERT' and new.role = 'staff' then
      return new;
    end if;
    raise exception 'Unauthenticated app_users write is only allowed for INSERT role = staff';
  end if;

  select role into v_actor_role
  from public.app_users
  where id = v_actor_id;

  if v_actor_role is null then
    raise exception 'Caller has no app_users profile';
  end if;

  -- Tier 2: no management writes (RLS should already block; fail closed).
  if v_actor_role = 'staff' then
    raise exception 'Tier 2 staff cannot modify app_users rows';
  end if;

  -- Tier 1 rules: manage staff only; cannot promote / touch peers / Creator.
  if v_actor_role = 'admin' then
    if tg_op = 'UPDATE' and old.role in ('creator', 'admin') then
      raise exception 'Tier 1 cannot modify Creator or other Tier 1 users';
    end if;
    if tg_op = 'UPDATE' and old.role <> 'staff' then
      raise exception 'Tier 1 can only manage Tier 2 (staff) users';
    end if;
    if new.role <> 'staff' then
      raise exception 'Tier 1 can only manage Tier 2 (staff) users';
    end if;
    if new.id is distinct from old.id then
      raise exception 'Cannot change app_users.id';
    end if;
  end if;

  -- Creator rules.
  if v_actor_role = 'creator' then
    if tg_op = 'UPDATE' and new.id is distinct from old.id then
      raise exception 'Cannot change app_users.id';
    end if;

    -- Own row: freeze organizational / security authority fields.
    -- display_name (and other non-listed columns) may change if RLS allows.
    if new.id = v_actor_id then
      if new.role is distinct from 'creator'
         or new.role is distinct from old.role
         or new.approval_status is distinct from old.approval_status
         or new.is_locked is distinct from old.is_locked
         or new.full_access is distinct from old.full_access then
        raise exception
          'Creator cannot alter their own organizational/security fields (role, approval_status, is_locked, full_access) through ordinary updates';
      end if;
      return new;
    end if;

    -- Manage Tier 1 and Tier 2 only (not invent another creator).
    if tg_op = 'UPDATE' and old.role = 'creator' then
      raise exception 'Cannot modify another Creator row';
    end if;

    if new.role not in ('admin', 'staff') then
      raise exception 'Creator may only assign Tier 1 (admin) or Tier 2 (staff) roles';
    end if;

    if tg_op = 'UPDATE' and old.role not in ('admin', 'staff') then
      raise exception 'Creator may only manage Tier 1 (admin) or Tier 2 (staff) users';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_app_users_enforce_role_hierarchy on public.app_users;

create trigger trg_app_users_enforce_role_hierarchy
before insert or update on public.app_users
for each row
execute function public.app_users_enforce_role_hierarchy();


-- ----------------------------------------------------------
-- PART E — RLS: app_users UPDATE hierarchy
-- ----------------------------------------------------------
-- Replaces the peer-admin policy from migration 017.
--
-- IMPORTANT: Do NOT subquery public.app_users for the actor inside
-- this policy (recursive RLS). Actor role comes from
-- public.current_app_user_role() (SECURITY DEFINER). Target row
-- fields use the row being updated (id / role) directly.
--
-- USING  = which existing rows may be targeted
-- WITH CHECK = which new row shapes may be written (blocks illegal
--              role escalation on an otherwise-permitted target)
-- Trigger remains defense in depth for field freezes / promotions.

drop policy if exists app_users_update_admin_only on public.app_users;
drop policy if exists app_users_update_by_hierarchy on public.app_users;

create policy app_users_update_by_hierarchy
on public.app_users
for update
to authenticated
using (
  (
    public.current_app_user_role() = 'creator'
    and (
      -- Own row (security-field freeze enforced by trigger)
      id = auth.uid()
      or role in ('admin', 'staff')
    )
  )
  or (
    public.current_app_user_role() = 'admin'
    and role = 'staff'
  )
)
with check (
  (
    public.current_app_user_role() = 'creator'
    and (
      -- Own row must remain creator (cannot self-escalate/demote)
      (id = auth.uid() and role = 'creator')
      -- Managed users may only be Tier 1 or Tier 2
      or (id is distinct from auth.uid() and role in ('admin', 'staff'))
    )
  )
  or (
    -- Tier 1 may only write Tier 2 rows that remain staff
    public.current_app_user_role() = 'admin'
    and role = 'staff'
  )
);


-- ----------------------------------------------------------
-- PART F — RLS: app_user_permissions writes by hierarchy
-- ----------------------------------------------------------
-- SELECT stays: own rows OR is_admin() (Creator + Tier 1), so org
-- admins can still open permission dialogs. Writes require managing
-- the target user (Tier 1 cannot edit Creator / Tier 1 permission rows).

drop policy if exists app_user_permissions_insert_admin_only
  on public.app_user_permissions;
drop policy if exists app_user_permissions_update_admin_only
  on public.app_user_permissions;
drop policy if exists app_user_permissions_delete_admin_only
  on public.app_user_permissions;

drop policy if exists app_user_permissions_insert_by_hierarchy
  on public.app_user_permissions;
drop policy if exists app_user_permissions_update_by_hierarchy
  on public.app_user_permissions;
drop policy if exists app_user_permissions_delete_by_hierarchy
  on public.app_user_permissions;

create policy app_user_permissions_insert_by_hierarchy
on public.app_user_permissions
for insert
to authenticated
with check (public.can_manage_app_user(user_id));

create policy app_user_permissions_update_by_hierarchy
on public.app_user_permissions
for update
to authenticated
using (public.can_manage_app_user(user_id))
with check (public.can_manage_app_user(user_id));

create policy app_user_permissions_delete_by_hierarchy
on public.app_user_permissions
for delete
to authenticated
using (public.can_manage_app_user(user_id));


-- ----------------------------------------------------------
-- PART G — permission helpers: Creator shares admin module bypass
-- ----------------------------------------------------------
-- Lock/approval order matches production migration 033: administrator
-- (now creator|admin) bypass runs BEFORE locked/approval checks.
-- This preserves existing admin semantics; Tier 2 still gated.

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
  v_can_view boolean;
  v_can_create boolean;
  v_can_edit boolean;
  v_level text;
begin
  select role, approval_status, is_locked, full_access
    into v_role, v_approval, v_locked, v_full_access
  from public.app_users
  where id = auth.uid();

  if v_role is null then
    return false;
  end if;

  -- Creator + Tier 1 retain full module administrator bypass.
  if v_role in ('creator', 'admin') then
    return true;
  end if;

  if coalesce(v_locked, false) or coalesce(v_approval, 'pending') <> 'approved' then
    return false;
  end if;

  if coalesce(v_full_access, false) then
    return true;
  end if;

  select
    can_view,
    can_create,
    can_edit,
    permission_level
  into
    v_can_view,
    v_can_create,
    v_can_edit,
    v_level
  from public.app_user_permissions
  where user_id = auth.uid()
    and permission_key = p_key;

  if not found then
    return false;
  end if;

  if coalesce(v_can_view, false) or coalesce(v_can_create, false) or coalesce(v_can_edit, false) then
    if p_min_level = 'view' then
      return coalesce(v_can_view, false) or coalesce(v_can_create, false) or coalesce(v_can_edit, false);
    elsif p_min_level = 'create_view' then
      return coalesce(v_can_create, false);
    elsif p_min_level = 'edit' then
      return coalesce(v_can_edit, false);
    else
      return false;
    end if;
  end if;

  v_level := coalesce(v_level, 'none');
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

create or replace function public.has_module_action(p_key text, p_action text)
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
  v_can_view boolean;
  v_can_create boolean;
  v_can_edit boolean;
  v_can_delete boolean;
  v_can_print boolean;
  v_can_share boolean;
begin
  select role, approval_status, is_locked, full_access
    into v_role, v_approval, v_locked, v_full_access
  from public.app_users
  where id = auth.uid();

  if v_role is null then
    return false;
  end if;

  if v_role in ('creator', 'admin') then
    return true;
  end if;

  if coalesce(v_locked, false) or coalesce(v_approval, 'pending') <> 'approved' then
    return false;
  end if;

  if coalesce(v_full_access, false) then
    return true;
  end if;

  select
    can_view, can_create, can_edit, can_delete, can_print, can_share
  into
    v_can_view, v_can_create, v_can_edit, v_can_delete, v_can_print, v_can_share
  from public.app_user_permissions
  where user_id = auth.uid()
    and permission_key = p_key;

  if not found then
    return false;
  end if;

  if p_action = 'view' then
    return coalesce(v_can_view, false) or coalesce(v_can_create, false) or coalesce(v_can_edit, false);
  elsif p_action = 'create' then
    return coalesce(v_can_create, false);
  elsif p_action = 'edit' then
    return coalesce(v_can_edit, false);
  elsif p_action = 'delete' then
    return coalesce(v_can_delete, false);
  elsif p_action = 'print' then
    return coalesce(v_can_print, false);
  elsif p_action = 'share' then
    return coalesce(v_can_share, false);
  else
    return false;
  end if;
end;
$$;


-- ----------------------------------------------------------
-- PART H — EXECUTE privileges (least privilege)
-- ----------------------------------------------------------

revoke all on function public.current_app_user_role() from public;
revoke all on function public.current_app_user_role() from anon;
grant execute on function public.current_app_user_role() to authenticated;

revoke all on function public.is_creator() from public;
revoke all on function public.is_creator() from anon;
grant execute on function public.is_creator() to authenticated;

revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.is_app_admin() from public;
revoke all on function public.is_app_admin() from anon;
grant execute on function public.is_app_admin() to authenticated;

revoke all on function public.can_manage_app_user(uuid) from public;
revoke all on function public.can_manage_app_user(uuid) from anon;
grant execute on function public.can_manage_app_user(uuid) to authenticated;

revoke all on function public.has_permission(text, text) from public;
revoke all on function public.has_permission(text, text) from anon;
grant execute on function public.has_permission(text, text) to authenticated;

revoke all on function public.has_module_action(text, text) from public;
revoke all on function public.has_module_action(text, text) from anon;
grant execute on function public.has_module_action(text, text) to authenticated;

-- Privileged / internal only — not callable by browser JWT roles.
revoke all on function public.is_privileged_creator_designation_context() from public;
revoke all on function public.is_privileged_creator_designation_context() from anon, authenticated;

revoke all on function public.designate_creator(uuid) from public;
revoke all on function public.designate_creator(uuid) from anon, authenticated;
grant execute on function public.designate_creator(uuid) to service_role;

revoke all on function public.app_users_enforce_role_hierarchy() from public;
revoke all on function public.app_users_enforce_role_hierarchy() from anon, authenticated;


-- ----------------------------------------------------------
-- PART I — post-apply Creator designation (manual)
-- ----------------------------------------------------------
-- After you apply this migration, designate the Creator ONCE using a
-- client authenticated with the Supabase service_role key (JWT claim
-- role = service_role). Example (server/SQL with service role — never
-- from the browser anon/authenticated key):
--
--   select public.designate_creator('00000000-0000-0000-0000-000000000000'::uuid);
--
-- Bare SQL-editor sessions without a service_role JWT will be rejected
-- by is_privileged_creator_designation_context().
--
-- Do not put an email address in application source code.
-- ==========================================================
