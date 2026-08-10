-- ==========================================================
-- Migration: 007_create_lrs
-- Module:    LR Master
-- Created:   Phase 13.1 (LR Master reference implementation)
--
-- Reference: components/lr/lr.schema.ts
--            components/services/lr.service.ts
--            lib/calculations/lrCalculations.ts
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- (or via your preferred migration tool) against the target Supabase
-- project before the LR Master module is used.
--
-- Notes:
--   - `lr_number` is TEXT, NOT NULL, UNIQUE — manual entry only. There is
--     intentionally no sequence, trigger, or auto-generation logic here,
--     matching the locked Phase 13 architecture (LR numbering is deferred
--     to a dedicated future phase).
--   - `booking_branch` and `vehicle_type` are plain, unconstrained text —
--     `lr.schema.ts` validates them as free-form strings (not `z.enum`),
--     consistent with the "swappable source" pattern used for Vehicle
--     Type / Booking Branch elsewhere in the app. No CHECK constraint is
--     added for either, matching the schema exactly.
--   - `billing_party`, `bill_rate_type`, `lorry_hire_type`, `freight_type`,
--     and `status` ARE `z.enum(...)` in `lr.schema.ts`, so each gets a
--     matching CHECK constraint here — a direct, 1:1 mirror of the
--     schema's own validation, not an invented business rule.
--   - `bill_amount`, `lorry_hire_amount`, and `profit_amount` are NOT
--     part of the `lr.schema.ts` Zod object (they are never user-entered)
--     but ARE unconditionally written and read by `lr.service.ts`
--     (`toRow`/`fromRow`), which always recomputes them via
--     `calculateLR()` at save time. Included here as plain numeric
--     columns per explicit confirmation — omitting them would make
--     `createLR()`/`updateLR()` fail at runtime.
--   - `dc_date` and `invoice_date` are nullable — `lr.service.ts` maps an
--     empty string to `null` for both (see `OPTIONAL_DATE_FIELDS`).
--     `lr_date` is always required by `lrSchema`, so it is NOT NULL with
--     no default.
--   - No e-Way Bill enhancements, POD, GPS, trip tracking, invoice
--     numbering, or billing integration columns are included — only what
--     `lr.schema.ts` and `lr.service.ts` require today. `eway_bill_number`
--     itself is kept as-is since it already existed as a plain field.
--   - Foreign keys are deliberately not included in this migration — all
--     cross-module references (customer/vehicle/driver/transporter/
--     material) remain plain text for now.
-- ==========================================================

create table if not exists public.lrs (
  id bigint generated always as identity primary key,

  -- LR Information
  lr_number text not null unique,
  lr_date date not null,
  booking_branch text not null,
  customer text not null default '',
  billing_party text not null default 'Consignor'
    check (billing_party in ('Consignor', 'Consignee')),

  -- Consignor
  consignor text not null,
  consignor_gst text not null default '',
  consignor_address text not null default '',

  -- Consignee
  consignee text not null,
  consignee_gst text not null default '',
  consignee_address text not null default '',

  -- Vehicle & Route
  vehicle_number text not null,
  vehicle_type text not null default '',
  transporter text not null default '',
  driver_name text not null default '',
  driver_mobile text not null default '',
  from_station text not null,
  to_station text not null,

  -- Material
  material text not null,
  package_type text not null default '',
  packages numeric not null default 0,
  loading_weight numeric not null default 0,
  unloading_weight numeric not null default 0,
  charged_weight numeric not null default 0,

  -- Dispatch Documents
  po_number text not null default '',
  vendor_code text not null default '',
  dc_number text not null default '',
  dc_date date,
  invoice_number text not null default '',
  invoice_date date,
  invoice_value numeric not null default 0,
  eway_bill_number text not null default '',

  -- Commercial
  bill_rate numeric not null default 0,
  bill_rate_type text not null default 'Fixed'
    check (bill_rate_type in ('Fixed', 'Per Ton (Loading)', 'Per Ton (Unloading)', 'Guaranteed Weight')),
  guaranteed_weight numeric not null default 0,

  lorry_hire_rate numeric not null default 0,
  lorry_hire_type text not null default 'Fixed'
    check (lorry_hire_type in ('Fixed', 'Per Ton')),

  freight_type text not null default 'To Be Billed'
    check (freight_type in ('Paid', 'To Pay', 'To Be Billed')),

  driver_advance numeric not null default 0,
  diesel_advance numeric not null default 0,
  st_challan numeric not null default 0,
  loading_charges numeric not null default 0,
  unloading_charges numeric not null default 0,
  hamali numeric not null default 0,
  commission numeric not null default 0,
  other_expense numeric not null default 0,

  -- Computed commercial fields — always recomputed by lr.service.ts via
  -- calculateLR() at save time; never trusted directly from the client.
  bill_amount numeric not null default 0,
  lorry_hire_amount numeric not null default 0,
  profit_amount numeric not null default 0,

  -- Remarks
  remarks text not null default '',
  internal_remarks text not null default '',

  -- Status
  status text not null default 'Open'
    check (status in ('Open', 'In Transit', 'Delivered', 'Billed', 'Cancelled')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lrs_lr_number on public.lrs (lr_number);
create index if not exists idx_lrs_lr_date on public.lrs (lr_date);
create index if not exists idx_lrs_vehicle_number on public.lrs (vehicle_number);
create index if not exists idx_lrs_consignor on public.lrs (consignor);
create index if not exists idx_lrs_consignee on public.lrs (consignee);
create index if not exists idx_lrs_status on public.lrs (status);
create index if not exists idx_lrs_freight_type on public.lrs (freight_type);

-- Keeps `updated_at` current on every row update.
create or replace function public.set_lrs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_lrs_updated_at on public.lrs;

create trigger trg_lrs_updated_at
before update on public.lrs
for each row
execute function public.set_lrs_updated_at();
