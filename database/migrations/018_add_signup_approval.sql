-- ==========================================================
-- Migration: 018_add_signup_approval
-- Module:    Signup Approval Workflow
--
-- Reference: components/services/appUser.service.ts
--            lib/auth/AuthProvider.tsx
--            components/layout/DashboardLayout.tsx
--            components/staff/StaffListPage.tsx
--            components/auth/LoginPage.tsx
--            database/migrations/017_add_auth_ownership_lorry_expenses.sql
--
-- Migration 017 is already applied to this project. This migration
-- is purely ADDITIVE on top of it and does NOT edit 017's file, and
-- does not drop/alter any existing table, column, row, policy name,
-- or business data.
--
-- What this adds:
--   1. A new public.app_users.approval_status column
--      ('pending' | 'approved' | 'rejected'), backfilled so every
--      account that exists BEFORE this migration keeps working
--      exactly as before (set to 'approved' — never 'pending').
--   2. A minimal update to the existing handle_new_auth_user()
--      signup trigger function (same name, same trigger — just one
--      extra inserted column) so every NEW signup starts as
--      approval_status = 'pending', role still 'staff', exactly as
--      before otherwise.
--
-- What this does NOT add:
--   No new RLS policy is needed. The existing
--   `app_users_update_admin_only` policy (see 017) already restricts
--   EVERY column of EVERY update on app_users — including this new
--   approval_status column — to requests where the caller
--   (auth.uid()) already has role = 'admin' in app_users. There was
--   never a self-service update policy for staff, so a staff account
--   already cannot change approval_status (their own or anyone
--   else's) or role. This migration relies on that existing
--   protection instead of duplicating it.
-- ==========================================================


-- ----------------------------------------------------------
-- 1) Add the column WITHOUT a default first, so every row that
--    already exists lands here as NULL — never silently defaulted
--    to 'pending' — and is then explicitly backfilled below.
-- ----------------------------------------------------------
alter table public.app_users
add column if not exists approval_status text;


-- ----------------------------------------------------------
-- 2) Backfill: every account that exists as of this migration
--    (any existing admin or staff) keeps working exactly as before.
-- ----------------------------------------------------------
update public.app_users
set approval_status = 'approved'
where approval_status is null;


-- ----------------------------------------------------------
-- 3) Only from this point on does 'pending' become the default —
--    i.e. only for rows inserted after this migration runs. The
--    signup trigger below also sets it explicitly, so this default
--    is a belt-and-suspenders backstop, not the primary mechanism.
-- ----------------------------------------------------------
alter table public.app_users
alter column approval_status set default 'pending';

alter table public.app_users
alter column approval_status set not null;

alter table public.app_users
drop constraint if exists app_users_approval_status_check;

alter table public.app_users
add constraint app_users_approval_status_check
check (approval_status in ('pending', 'approved', 'rejected'));


-- ==========================================================
-- Signup trigger: minimal update. Same function name, same
-- trigger (trg_handle_new_auth_user on auth.users, created in
-- 017, unaffected by CREATE OR REPLACE FUNCTION below). The only
-- difference from 017's version is the added approval_status
-- column in the INSERT.
-- ==========================================================
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
    approval_status
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    'staff',
    'pending'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ==========================================================
-- END 018
-- ==========================================================
