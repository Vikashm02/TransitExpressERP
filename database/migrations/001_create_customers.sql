-- ==========================================================
-- Migration: 001_create_customers
-- Module:    Customer Master
-- Created:   Phase 6 (Customer Master reference implementation)
-- Updated:   Phase 11.1 (Migration Hardening — added updated_at,
--            updated_at trigger, indexes, and UNIQUE(code) to match
--            the structure established by later migrations)
--
-- Naming convention for future migrations:
--   database/migrations/<NNN>_<verb>_<table>.sql
--   e.g. 002_create_vehicles.sql, 003_create_drivers.sql
--
-- These files are a record of the schema changes required by the
-- application. They are NOT executed automatically — run them manually
-- (or via your preferred migration tool) against the target Supabase
-- project before the corresponding module is used.
-- ==========================================================

create table if not exists public.customers (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  gst text not null default '',
  mobile text not null default '',
  email text not null default '',
  city text not null default '',
  address text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customers_code on public.customers (code);
create index if not exists idx_customers_name on public.customers (name);
create index if not exists idx_customers_city on public.customers (city);
create index if not exists idx_customers_status on public.customers (status);

-- Keeps `updated_at` current on every row update.
create or replace function public.set_customers_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_customers_updated_at on public.customers;

create trigger trg_customers_updated_at
before update on public.customers
for each row
execute function public.set_customers_updated_at();
