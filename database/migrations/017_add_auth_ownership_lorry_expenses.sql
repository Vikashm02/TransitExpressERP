-- ==========================================================
-- Migration: 017_add_auth_ownership_lorry_expenses
-- Modules:   Staff Auth, LR Ownership, Lorry Expenses, POD Settlement
--
-- Reference: lib/auth/AuthProvider.tsx
--            components/services/appUser.service.ts
--            components/services/lr.service.ts
--            components/lorryExpense/lorryExpense.schema.ts
--            components/services/lorryExpense.service.ts
--            components/pod/pod.schema.ts
--            components/services/pod.service.ts
--
-- This migration:
--   1. Adds Supabase Auth-backed app_users profiles.
--   2. Adds LR ownership (created_by / assigned_to).
--   3. Adds POD settlement fields.
--   4. Adds Lorry Expenses.
--   5. Enables database-level RLS ownership enforcement.
--
-- It does not drop tables, columns, or business data.
-- ==========================================================


-- ==========================================================
-- PART A — STAFF IDENTITY
-- ==========================================================

create table if not exists public.app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  role text not null default 'staff'
    check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

alter table public.app_users enable row level security;


-- Every authenticated user may read the staff roster.
drop policy if exists app_users_select_authenticated
on public.app_users;

create policy app_users_select_authenticated
on public.app_users
for select
to authenticated
using (true);


-- Only an existing admin may update staff profiles/roles.
drop policy if exists app_users_update_admin_only
on public.app_users;

create policy app_users_update_admin_only
on public.app_users
for update
to authenticated
using (
  exists (
    select 1
    from public.app_users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.app_users u
    where u.id = auth.uid()
      and u.role = 'admin'
  )
);


-- Auto-create an app_users row for every NEW Supabase Auth signup.
-- Every new user starts as STAFF.
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
    role
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    'staff'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


drop trigger if exists trg_handle_new_auth_user
on auth.users;

create trigger trg_handle_new_auth_user
after insert on auth.users
for each row
execute function public.handle_new_auth_user();


-- ==========================================================
-- EXISTING AUTH USER BACKFILL
-- ==========================================================
--
-- Your Supabase project already has one Auth user.
-- This creates the missing app_users profile for any existing
-- Auth user who does not already have one.
--
-- It does NOT modify auth.users.
-- It does NOT modify the user's password.
-- It does NOT delete or alter any existing business data.
-- Existing users are intentionally created as STAFF.
--

insert into public.app_users (
  id,
  email,
  display_name,
  role
)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(
    u.raw_user_meta_data ->> 'display_name',
    split_part(coalesce(u.email, ''), '@', 1)
  ),
  'staff'
from auth.users u
where not exists (
  select 1
  from public.app_users a
  where a.id = u.id
);


-- Central admin check used by RLS policies.
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
      and role = 'admin'
  );
$$;


-- ==========================================================
-- PART B — LR OWNERSHIP
-- ==========================================================

alter table public.lrs
add column if not exists created_by uuid
  references public.app_users (id),
add column if not exists assigned_to uuid
  references public.app_users (id);

create index if not exists idx_lrs_assigned_to
on public.lrs (assigned_to);


-- Enforce ownership at database level.
create or replace function public.lrs_enforce_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if tg_op = 'INSERT' then

    new.created_by := auth.uid();

    if new.assigned_to is null
       or not public.is_admin() then
      new.assigned_to := auth.uid();
    end if;

  elsif tg_op = 'UPDATE' then

    new.created_by := old.created_by;

    if new.assigned_to is distinct from old.assigned_to
       and not public.is_admin() then
      new.assigned_to := old.assigned_to;
    end if;

  end if;

  return new;
end;
$$;


drop trigger if exists trg_lrs_enforce_ownership
on public.lrs;

create trigger trg_lrs_enforce_ownership
before insert or update on public.lrs
for each row
execute function public.lrs_enforce_ownership();


alter table public.lrs enable row level security;


-- Staff sees only LRs assigned to them.
-- Admin sees every LR.
drop policy if exists lrs_select_own_or_admin
on public.lrs;

create policy lrs_select_own_or_admin
on public.lrs
for select
to authenticated
using (
  public.is_admin()
  or assigned_to = auth.uid()
);


-- Authenticated users may create LRs.
-- The ownership trigger determines the owner.
drop policy if exists lrs_insert_authenticated
on public.lrs;

create policy lrs_insert_authenticated
on public.lrs
for insert
to authenticated
with check (true);


-- Staff can edit their assigned LRs.
-- Admin can edit all LRs.
drop policy if exists lrs_update_own_or_admin
on public.lrs;

create policy lrs_update_own_or_admin
on public.lrs
for update
to authenticated
using (
  public.is_admin()
  or assigned_to = auth.uid()
)
with check (
  public.is_admin()
  or assigned_to = auth.uid()
);


-- Only admins can delete LRs.
drop policy if exists lrs_delete_admin_only
on public.lrs;

create policy lrs_delete_admin_only
on public.lrs
for delete
to authenticated
using (
  public.is_admin()
);


-- ==========================================================
-- PART C — POD SETTLEMENT FIELDS + OWNERSHIP
-- ==========================================================

alter table public.pods
add column if not exists st_chalan numeric not null default 0,
add column if not exists tds_percentage numeric not null default 0
  check (tds_percentage in (0, 1)),
add column if not exists other_deduction numeric not null default 0,
add column if not exists balance_paid_on date;


alter table public.pods enable row level security;


-- POD ownership follows the assigned LR.
drop policy if exists pods_select_own_lr_or_admin
on public.pods;

create policy pods_select_own_lr_or_admin
on public.pods
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.lrs l
    where l.lr_number = pods.lr_number
      and l.assigned_to = auth.uid()
  )
);


drop policy if exists pods_insert_own_lr_or_admin
on public.pods;

create policy pods_insert_own_lr_or_admin
on public.pods
for insert
to authenticated
with check (
  public.is_admin()
  or exists (
    select 1
    from public.lrs l
    where l.lr_number = pods.lr_number
      and l.assigned_to = auth.uid()
  )
);


drop policy if exists pods_update_own_lr_or_admin
on public.pods;

create policy pods_update_own_lr_or_admin
on public.pods
for update
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.lrs l
    where l.lr_number = pods.lr_number
      and l.assigned_to = auth.uid()
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.lrs l
    where l.lr_number = pods.lr_number
      and l.assigned_to = auth.uid()
  )
);


-- ==========================================================
-- PART D — LORRY EXPENSES
-- ==========================================================

create table if not exists public.lorry_expenses (
  id bigint generated always as identity primary key,

  lr_id bigint not null unique
    references public.lrs (id)
    on delete cascade,

  driver_advance numeric not null default 0,
  diesel_advance numeric not null default 0,
  loading_charges numeric not null default 0,
  unloading_charges numeric not null default 0,
  hamali numeric not null default 0,
  commission numeric not null default 0,
  other_expense numeric not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create or replace function public.set_lorry_expenses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


drop trigger if exists trg_lorry_expenses_updated_at
on public.lorry_expenses;

create trigger trg_lorry_expenses_updated_at
before update on public.lorry_expenses
for each row
execute function public.set_lorry_expenses_updated_at();


alter table public.lorry_expenses enable row level security;


-- Staff can see expenses only for their assigned LRs.
-- Admin can see all expenses.
drop policy if exists lorry_expenses_select_own_lr_or_admin
on public.lorry_expenses;

create policy lorry_expenses_select_own_lr_or_admin
on public.lorry_expenses
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.lrs l
    where l.id = lorry_expenses.lr_id
      and l.assigned_to = auth.uid()
  )
);


-- Staff can create expenses only against their assigned LRs.
drop policy if exists lorry_expenses_insert_own_lr_or_admin
on public.lorry_expenses;

create policy lorry_expenses_insert_own_lr_or_admin
on public.lorry_expenses
for insert
to authenticated
with check (
  public.is_admin()
  or exists (
    select 1
    from public.lrs l
    where l.id = lorry_expenses.lr_id
      and l.assigned_to = auth.uid()
  )
);


-- Staff can update expenses only for their assigned LRs.
drop policy if exists lorry_expenses_update_own_lr_or_admin
on public.lorry_expenses;

create policy lorry_expenses_update_own_lr_or_admin
on public.lorry_expenses
for update
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.lrs l
    where l.id = lorry_expenses.lr_id
      and l.assigned_to = auth.uid()
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.lrs l
    where l.id = lorry_expenses.lr_id
      and l.assigned_to = auth.uid()
  )
);


-- ==========================================================
-- PART E — INITIAL ADMIN BOOTSTRAP
-- ==========================================================
--
-- IMPORTANT:
-- The existing Auth account and all future accounts start as STAFF.
--
-- After applying this migration:
--
-- 1. Sign in / sign up using the intended Admin account.
--
-- 2. Run the following ONE-TIME statement in the Supabase SQL Editor,
--    replacing the email with the Admin's actual email:
--
-- update public.app_users
-- set role = 'admin'
-- where email = 'YOUR_ADMIN_EMAIL';
--
-- 3. Verify:
--
-- select id, email, role
-- from public.app_users;
--
-- After the first Admin exists, further promotion/demotion should
-- happen through the application's Staff page.
--
-- ==========================================================
-- END 017
-- ==========================================================