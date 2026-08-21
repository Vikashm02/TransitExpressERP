-- ==========================================================
-- Migration: 044_vehicle_master_lr_sync_fields
-- Module:    Vehicle Master columns for LR ↔ Vehicle sync
--
-- Adds transporter / driver_name / driver_mobile so LR entry can
-- fetch and maintain current vehicle contact/assignment info.
--
-- Does NOT:
--   - create RPCs
--   - change RLS (vehicles still has no RLS)
--   - modify historical LRs
--   - bulk-backfill existing vehicles (new cols default '')
--
-- NOT executed automatically — run manually against Supabase
-- after review.
-- ==========================================================

alter table public.vehicles
  add column if not exists transporter text not null default '',
  add column if not exists driver_name text not null default '',
  add column if not exists driver_mobile text not null default '';

comment on column public.vehicles.transporter is
  'Latest transporter name; maintained from LR vehicle details.';

comment on column public.vehicles.driver_name is
  'Latest driver name; maintained from LR vehicle details.';

comment on column public.vehicles.driver_mobile is
  'Latest driver mobile; maintained from LR vehicle details.';
