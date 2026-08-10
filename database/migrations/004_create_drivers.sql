-- ==========================================================
-- Migration: 004_create_drivers
-- Module:    Driver Master
-- Created:   Phase 9 (Driver Master reference implementation)
-- Updated:   Phase 11.1 (Migration Hardening — added UNIQUE(license_number))
--
-- Reference: components/driver/driver.schema.ts
--            components/services/driver.service.ts
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- (or via your preferred migration tool) against the target Supabase
-- project before the Driver Master module is used.
--
-- Notes:
--   - `driver_type` and `license_type` are intentionally left as plain
--     text with app-level defaults, NOT database enums/CHECK
--     constraints. Per the locked Driver Master architecture,
--     License Type in particular must stay swappable for a future
--     License Type Master without a schema change.
--   - `preferred_vehicle` is plain text with no foreign key — it is
--     reserved for a future Vehicle Master integration.
--   - License Status is derived at render time (see getLicenseStatus)
--     and is never stored here.
--   - `photo_url` is nullable until a photo is uploaded via Supabase
--     Storage (see `uploadDriverAsset`).
--   - Foreign keys are deliberately not included in this migration.
-- ==========================================================

create table if not exists public.drivers (
  id bigint generated always as identity primary key,

  -- Identity
  driver_name text not null,
  driver_type text not null default 'Own',
  date_of_birth date,
  blood_group text not null default '',
  experience_years numeric not null default 0,

  -- Contact
  mobile text not null default '',
  alternate_mobile text not null default '',
  address text not null default '',
  emergency_contact_name text not null default '',
  emergency_contact_number text not null default '',

  -- License & Compliance
  license_number text not null unique,
  license_type text not null default 'LMV',
  license_issuing_state text not null default '',
  license_expiry date,

  -- Identity Documents
  aadhaar_number text not null default '',
  pan text not null default '',

  -- Employment
  date_of_joining date,
  preferred_vehicle text not null default '',

  -- Banking
  bank_name text not null default '',
  account_number text not null default '',
  ifsc text not null default '',

  -- Photo (Supabase Storage URL — nullable until uploaded)
  photo_url text,

  -- Additional
  remarks text not null default '',

  -- Persisted lifecycle status. License Status is derived at
  -- render time (see getLicenseStatus) and is never stored here.
  status text not null default 'Active'
    check (status in ('Active', 'Inactive')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_drivers_driver_name on public.drivers (driver_name);
create index if not exists idx_drivers_license_number on public.drivers (license_number);
create index if not exists idx_drivers_mobile on public.drivers (mobile);
create index if not exists idx_drivers_status on public.drivers (status);

-- Keeps `updated_at` current on every row update.
create or replace function public.set_drivers_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_drivers_updated_at on public.drivers;

create trigger trg_drivers_updated_at
before update on public.drivers
for each row
execute function public.set_drivers_updated_at();
