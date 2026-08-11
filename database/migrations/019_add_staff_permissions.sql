-- ==========================================================
-- Migration: 019_add_staff_permissions
-- Module:    Staff / Sub-User Access Control
--
-- Reference: lib/permissions.ts
--            components/services/appUser.service.ts
--            components/services/permission.service.ts
--            lib/auth/AuthProvider.tsx
--            components/layout/DashboardLayout.tsx
--            components/layout/Sidebar.tsx
--            components/staff/StaffListPage.tsx
--            components/staff/StaffPermissionsDialog.tsx
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- against the target Supabase project. Migrations 001-018 are
-- untouched; this is purely additive (new columns default such that
-- every existing account keeps working exactly as it does today).
--
-- What this adds:
--   1. `app_users.full_access`   — Admin-controlled master switch. ON
--      means "this staff member behaves like they have every
--      permission below set to Edit", without needing a row per
--      module. Every account that exists BEFORE this migration is
--      backfilled to `true` (nobody loses access they already have).
--      Every NEW signup after this migration defaults to `false` —
--      an Admin must explicitly grant access via the Staff page,
--      matching the reference video's flow of an Admin configuring a
--      brand new sub-user.
--   2. `app_users.is_locked`     — Admin-controlled kill switch for a
--      single staff account, independent of `role` and
--      `approval_status`. Defaults to `false` for everyone.
--   3. `app_user_permissions`    — one row per (staff user, module).
--      `permission_level` is one of 'none' | 'view' | 'create_view'
--      | 'edit', matching the reference video's per-module control
--      (no row for a given module == 'none', i.e. no access).
--   4. `public.has_permission(key, min_level)` — single source of
--      truth for "can this user do X", used by:
--        - the new RLS checks on `lrs` / `pods` below (real
--          database-level enforcement, not just a UI hint), and
--        - the client (via the mirrored TypeScript logic in
--          lib/permissions.ts) for nav/route gating.
--      Admins always pass. A locked or non-approved staff account
--      always fails, regardless of any permission row or full_access
--      — this closes the same gap for `lrs`/`pods` that the existing
--      `approval_status` gate only enforced in the UI (DashboardLayout),
--      not previously in RLS.
--
-- Deliberately OUT of scope for this migration (see the app's final
-- implementation report for the full reasoning):
--   - `bills` / `bill_lrs` / `credit_notes` / `debit_notes` /
--     `billing_parties` have NO row level security at all today (no
--     `enable row level security`, no policies, on any of them —
--     true since migrations 012/014/015 first created them). Adding
--     RLS to those tables from scratch is a separate, materially
--     riskier change than extending the ownership policies that
--     already exist on `lrs`/`pods`, and is not what was asked for
--     here. Billing/Credit Note/Debit Note/Ledger/Reports access is
--     enforced by this migration's permission system only at the
--     application layer (Sidebar navigation + DashboardLayout route
--     guard) — NOT at the database layer. Treat this the same as the
--     pre-existing, already-flagged gap where a rejected/pending
--     user is only blocked by the UI, not by RLS, on those same
--     tables.
--   - `lorry_expenses` RLS is intentionally left untouched. It is not
--     one of the modules named in the reference video's permission
--     list, so extending its ownership policy the same way as
--     `lrs`/`pods` was judged out of scope for this pass. It remains
--     gated at the application layer only (Sidebar + DashboardLayout),
--     exactly like Billing/Credit Note/Debit Note above.
-- ==========================================================


-- ==========================================================
-- PART A — app_users: full_access + is_locked
-- ==========================================================

alter table public.app_users
  add column if not exists full_access boolean;

-- Backfill BEFORE adding the NOT NULL + default, so every account
-- that exists right now keeps exactly the access it has today.
update public.app_users
set full_access = true
where full_access is null;

alter table public.app_users
  alter column full_access set default false;

alter table public.app_users
  alter column full_access set not null;

alter table public.app_users
  add column if not exists is_locked boolean not null default false;


-- New signups still start as STAFF / pending approval (migrations
-- 017 + 018) — this only adds full_access = false to that same
-- starting state, so a brand new sub-user has zero module access
-- until BOTH approved AND explicitly configured by an Admin.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (
    id,
    email,
    display_name,
    role,
    full_access
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    'staff',
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


-- ==========================================================
-- PART B — app_user_permissions
-- ==========================================================

create table if not exists public.app_user_permissions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.app_users (id) on delete cascade,
  permission_key text not null,
  permission_level text not null default 'none'
    check (permission_level in ('none', 'view', 'create_view', 'edit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, permission_key)
);

create index if not exists idx_app_user_permissions_user_id
  on public.app_user_permissions (user_id);


create or replace function public.set_app_user_permissions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_user_permissions_updated_at
on public.app_user_permissions;

create trigger trg_app_user_permissions_updated_at
before update on public.app_user_permissions
for each row
execute function public.set_app_user_permissions_updated_at();


alter table public.app_user_permissions enable row level security;

-- A user may read their own permission rows (needed for nav/route
-- gating on login). An admin may read everyone's (needed for the
-- Staff page's "Edit Permissions" dialog).
drop policy if exists app_user_permissions_select
on public.app_user_permissions;

create policy app_user_permissions_select
on public.app_user_permissions
for select
to authenticated
using (
  public.is_admin()
  or user_id = auth.uid()
);


-- Only an admin may grant/change/revoke permissions — never the
-- staff member themselves, even for their own row.
drop policy if exists app_user_permissions_insert_admin_only
on public.app_user_permissions;

create policy app_user_permissions_insert_admin_only
on public.app_user_permissions
for insert
to authenticated
with check (public.is_admin());

drop policy if exists app_user_permissions_update_admin_only
on public.app_user_permissions;

create policy app_user_permissions_update_admin_only
on public.app_user_permissions
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists app_user_permissions_delete_admin_only
on public.app_user_permissions;

create policy app_user_permissions_delete_admin_only
on public.app_user_permissions
for delete
to authenticated
using (public.is_admin());


-- ==========================================================
-- PART C — public.has_permission(): single source of truth
-- ==========================================================
--
-- Returns true when the calling user (auth.uid()) may act on
-- `p_key` at least at `p_min_level` ('view' < 'create_view' <
-- 'edit'). Mirrored on the client by `hasPermission()` in
-- lib/permissions.ts for nav/route gating — this function is what
-- actually protects the data if that client-side check is ever
-- bypassed.
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
  levels text[] := array['none', 'view', 'create_view', 'edit'];
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

  return coalesce(array_position(levels, coalesce(v_level, 'none')), 1)
       >= coalesce(array_position(levels, p_min_level), 999);
end;
$$;


-- ==========================================================
-- PART D — extend lrs / pods RLS with has_permission()
-- ==========================================================
-- Same policy names as migration 017 (drop + recreate in place —
-- migration 017's file itself is not edited). Ownership (assigned_to
-- = auth.uid()) is still required for staff exactly as before; this
-- only ADDS a permission-level check on top of it, and additionally
-- now denies locked/non-approved staff at the database level too
-- (previously only DashboardLayout enforced that, for these tables).

drop policy if exists lrs_select_own_or_admin on public.lrs;

create policy lrs_select_own_or_admin
on public.lrs
for select
to authenticated
using (
  public.is_admin()
  or (assigned_to = auth.uid() and public.has_permission('lr', 'view'))
);


drop policy if exists lrs_insert_authenticated on public.lrs;

create policy lrs_insert_authenticated
on public.lrs
for insert
to authenticated
with check (
  public.has_permission('lr', 'create_view')
);


drop policy if exists lrs_update_own_or_admin on public.lrs;

create policy lrs_update_own_or_admin
on public.lrs
for update
to authenticated
using (
  public.is_admin()
  or (assigned_to = auth.uid() and public.has_permission('lr', 'edit'))
)
with check (
  public.is_admin()
  or (assigned_to = auth.uid() and public.has_permission('lr', 'edit'))
);


drop policy if exists pods_select_own_lr_or_admin on public.pods;

create policy pods_select_own_lr_or_admin
on public.pods
for select
to authenticated
using (
  public.is_admin()
  or (
    public.has_permission('pod', 'view')
    and exists (
      select 1
      from public.lrs l
      where l.lr_number = pods.lr_number
        and l.assigned_to = auth.uid()
    )
  )
);


drop policy if exists pods_insert_own_lr_or_admin on public.pods;

create policy pods_insert_own_lr_or_admin
on public.pods
for insert
to authenticated
with check (
  public.is_admin()
  or (
    public.has_permission('pod', 'create_view')
    and exists (
      select 1
      from public.lrs l
      where l.lr_number = pods.lr_number
        and l.assigned_to = auth.uid()
    )
  )
);


drop policy if exists pods_update_own_lr_or_admin on public.pods;

create policy pods_update_own_lr_or_admin
on public.pods
for update
to authenticated
using (
  public.is_admin()
  or (
    public.has_permission('pod', 'edit')
    and exists (
      select 1
      from public.lrs l
      where l.lr_number = pods.lr_number
        and l.assigned_to = auth.uid()
    )
  )
)
with check (
  public.is_admin()
  or (
    public.has_permission('pod', 'edit')
    and exists (
      select 1
      from public.lrs l
      where l.lr_number = pods.lr_number
        and l.assigned_to = auth.uid()
    )
  )
);

-- ==========================================================
-- END 019
-- ==========================================================
