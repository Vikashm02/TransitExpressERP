-- ==========================================================
-- Migration: 002_create_vehicles
-- Module:    Vehicle Master
-- Created:   Phase 7 (Vehicle Master reference implementation)
--
-- Reference: components/vehicle/vehicle.schema.ts
--            components/services/vehicle.service.ts
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- (or via your preferred migration tool) against the target Supabase
-- project before the Vehicle Master module is used.
--
-- Notes:
--   - `vehicle_type`, `owner_type`, `capacity_unit`, and `hire_type`
--     are intentionally left as plain text with app-level defaults,
--     NOT database enums/CHECK constraints. Per the locked Vehicle
--     Master architecture, Vehicle Type in particular must stay
--     swappable for a future Vehicle Type Master without a schema
--     change.
--   - `gps_device_id` is reserved for future GPS integration. It has
--     no UI and is never written by the application yet.
--   - Foreign keys (transporter, driver, etc.) are deliberately not
--     included in this migration.
-- ==========================================================

create table if not exists public.vehicles (
  id bigint generated always as identity primary key,

  -- Identity
  vehicle_number text not null,
  rc_number text not null default '',
  vehicle_type text not null,
  owner_name text not null,
  owner_type text not null default 'Market',
  mobile text not null default '',

  -- Capacity
  capacity numeric not null default 0,
  capacity_unit text not null default 'TON',

  -- Financial Information
  hire_rate numeric not null default 0,
  hire_type text not null default 'Fixed',

  -- Technical Information
  chassis_number text not null default '',
  engine_number text not null default '',

  -- Compliance
  insurance_number text not null default '',
  insurance_expiry date,
  permit_number text not null default '',
  permit_expiry date,
  fitness_number text not null default '',
  fitness_expiry date,
  puc_number text not null default '',
  puc_expiry date,

  -- Additional
  remarks text not null default '',

  -- Reserved (no UI yet)
  gps_device_id text,

  -- Persisted lifecycle status. Compliance Status is derived at
  -- render time (see getComplianceStatus) and is never stored here.
  status text not null default 'Active'
    check (status in ('Active', 'Inactive', 'Under Maintenance', 'Sold')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicles_vehicle_number on public.vehicles (vehicle_number);
create index if not exists idx_vehicles_owner_name on public.vehicles (owner_name);
create index if not exists idx_vehicles_status on public.vehicles (status);

-- Keeps `updated_at` current on every row update.
create or replace function public.set_vehicles_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_vehicles_updated_at on public.vehicles;

create trigger trg_vehicles_updated_at
before update on public.vehicles
for each row
execute function public.set_vehicles_updated_at();
