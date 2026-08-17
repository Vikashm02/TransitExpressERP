-- ==========================================================
-- Migration: 033_granular_module_actions
-- Module:    Staff permissions — independent action flags
--
-- Adds per-module action columns so Admin can grant View / Create /
-- Edit / Delete / Print / Share independently.
--
-- Backward compatible:
--   - permission_level column is retained and kept in sync
--   - existing rows are backfilled from permission_level
--   - edit historically implied delete → can_delete = true for 'edit'
--   - print/share default ON whenever the user had any view access
--
-- Also replaces public.has_permission() to read action flags, and
-- adds public.has_module_action() for delete/print/share checks.
--
-- NOT executed automatically — run manually against Supabase.
-- ==========================================================

alter table public.app_user_permissions
  add column if not exists can_view boolean not null default false,
  add column if not exists can_create boolean not null default false,
  add column if not exists can_edit boolean not null default false,
  add column if not exists can_delete boolean not null default false,
  add column if not exists can_print boolean not null default false,
  add column if not exists can_share boolean not null default false;

-- Backfill once from legacy permission_level (idempotent for re-runs
-- only for rows that still look unset after defaults — use level).
update public.app_user_permissions
set
  can_view = case
    when permission_level in ('view', 'create_view', 'edit') then true
    else false
  end,
  can_create = case when permission_level = 'create_view' then true else false end,
  can_edit = case when permission_level = 'edit' then true else false end,
  -- Historical product rule: Edit unlocked Delete.
  can_delete = case when permission_level = 'edit' then true else false end,
  can_print = case
    when permission_level in ('view', 'create_view', 'edit') then true
    else false
  end,
  can_share = case
    when permission_level in ('view', 'create_view', 'edit') then true
    else false
  end;

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

  if v_role = 'admin' then
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

  -- Fallback for rows that predate columns / missing row.
  if not found then
    return false;
  end if;

  -- Prefer action flags; fall back to legacy level if all flags false
  -- but a legacy level is still present (safety during rollout).
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

  if v_role = 'admin' then
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

grant execute on function public.has_module_action(text, text) to authenticated;

-- Operations delete policies: require explicit delete action (not edit).
drop policy if exists lrs_delete_admin_only on public.lrs;
create policy lrs_delete_permitted
  on public.lrs
  for delete
  to authenticated
  using (public.has_module_action('lr', 'delete'));

drop policy if exists pods_delete on public.pods;
create policy pods_delete_permitted
  on public.pods
  for delete
  to authenticated
  using (public.has_module_action('pod', 'delete'));

drop policy if exists delivery_challans_delete on public.delivery_challans;
create policy delivery_challans_delete_permitted
  on public.delivery_challans
  for delete
  to authenticated
  using (public.has_module_action('delivery_challans', 'delete'));

drop policy if exists asn_creations_delete on public.asn_creations;
create policy asn_creations_delete
  on public.asn_creations
  for delete
  to authenticated
  using (public.has_module_action('asn_creations', 'delete'));
