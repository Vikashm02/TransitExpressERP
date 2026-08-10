-- ==========================================================
-- Migration: 009_update_lrs_schema
-- Module:    LR Master
-- Created:   Phase 13.2 (LR Master — live schema catch-up, round 2)
--
-- Reference: database/migrations/007_create_lrs.sql
--            database/migrations/008_update_lrs_schema.sql
--            components/services/lr.service.ts
--
-- Purpose: 008_update_lrs_schema.sql added the three computed commercial
-- columns (bill_amount, lorry_hire_amount, profit_amount), but a fresh
-- end-to-end LR create still failed live with:
--   PGRST204: Could not find the 'package_type' column of 'lrs' in the
--   schema cache
--
-- This confirms the live `public.lrs` table (created out-of-band, outside
-- any committed migration) is still missing columns beyond the three
-- already patched. There is no service-role/SQL access available to this
-- agent to introspect the live table directly, so the exact extent of the
-- gap cannot be confirmed column-by-column ahead of time.
--
-- Instead of patching one column at a time (which only surfaces the next
-- missing column on each retry), this migration adds every column defined
-- in 007_create_lrs.sql — except the three already handled by 008 — using
-- `add column if not exists`. This is a no-op for any column that already
-- exists live, and only creates whatever is actually missing, achieving a
-- full reconciliation in a single idempotent statement without requiring
-- prior knowledge of the live table's exact current state.
--
-- IMPORTANT — package_type / packages are intentionally NOT added here.
-- The live table was confirmed to already carry this data under legacy
-- names (`packaging`, `articles`). Adding package_type/packages via
-- ADD COLUMN here would create empty duplicate columns alongside the
-- legacy ones instead of reconciling them — see
-- 010_rename_lr_packaging_columns.sql, which renames the legacy columns
-- in place instead.
--
-- This migration only ALTERs the existing table — it does not recreate,
-- drop, or touch any other column, and does not include bill_amount,
-- lorry_hire_amount, or profit_amount (already added by 008). Safe to run
-- multiple times.
-- ==========================================================

alter table public.lrs
  add column if not exists lr_number text not null unique,
  add column if not exists lr_date date not null,
  add column if not exists booking_branch text not null,
  add column if not exists customer text not null default '',
  add column if not exists billing_party text not null default 'Consignor'
    check (billing_party in ('Consignor', 'Consignee')),

  add column if not exists consignor text not null,
  add column if not exists consignor_gst text not null default '',
  add column if not exists consignor_address text not null default '',

  add column if not exists consignee text not null,
  add column if not exists consignee_gst text not null default '',
  add column if not exists consignee_address text not null default '',

  add column if not exists vehicle_number text not null,
  add column if not exists vehicle_type text not null default '',
  add column if not exists transporter text not null default '',
  add column if not exists driver_name text not null default '',
  add column if not exists driver_mobile text not null default '',
  add column if not exists from_station text not null,
  add column if not exists to_station text not null,

  add column if not exists material text not null,
  add column if not exists loading_weight numeric not null default 0,
  add column if not exists unloading_weight numeric not null default 0,
  add column if not exists charged_weight numeric not null default 0,

  add column if not exists po_number text not null default '',
  add column if not exists vendor_code text not null default '',
  add column if not exists dc_number text not null default '',
  add column if not exists dc_date date,
  add column if not exists invoice_number text not null default '',
  add column if not exists invoice_date date,
  add column if not exists invoice_value numeric not null default 0,
  add column if not exists eway_bill_number text not null default '',

  add column if not exists bill_rate numeric not null default 0,
  add column if not exists bill_rate_type text not null default 'Fixed'
    check (bill_rate_type in ('Fixed', 'Per Ton (Loading)', 'Per Ton (Unloading)', 'Guaranteed Weight')),
  add column if not exists guaranteed_weight numeric not null default 0,

  add column if not exists lorry_hire_rate numeric not null default 0,
  add column if not exists lorry_hire_type text not null default 'Fixed'
    check (lorry_hire_type in ('Fixed', 'Per Ton')),

  add column if not exists freight_type text not null default 'To Be Billed'
    check (freight_type in ('Paid', 'To Pay', 'To Be Billed')),

  add column if not exists driver_advance numeric not null default 0,
  add column if not exists diesel_advance numeric not null default 0,
  add column if not exists st_challan numeric not null default 0,
  add column if not exists loading_charges numeric not null default 0,
  add column if not exists unloading_charges numeric not null default 0,
  add column if not exists hamali numeric not null default 0,
  add column if not exists commission numeric not null default 0,
  add column if not exists other_expense numeric not null default 0,

  add column if not exists remarks text not null default '',
  add column if not exists internal_remarks text not null default '',

  add column if not exists status text not null default 'Open'
    check (status in ('Open', 'In Transit', 'Delivered', 'Billed', 'Cancelled')),

  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
