-- ==========================================================
-- Migration: 001_create_customers
-- Module:    Customer Master
-- Created:   Phase 6 (Customer Master reference implementation)
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
  code text not null,
  name text not null,
  gst text not null default '',
  mobile text not null default '',
  email text not null default '',
  city text not null default '',
  address text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now()
);
