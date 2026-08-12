-- ==========================================================
-- Migration: 023_create_delivery_challans
-- Module:    Delivery Challan
--
-- Reference: components/deliveryChallan/deliveryChallan.schema.ts
--            components/services/deliveryChallan.service.ts
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- against the target Supabase project before the Delivery Challan
-- module is used. Prior migrations are untouched.
--
-- Notes:
--   - Purely additive CREATE TABLE IF NOT EXISTS.
--   - `lr_number` is plain text with NO foreign key to `public.lrs`,
--     matching the locked "no foreign keys" convention used by POD
--     and other modules (see 011_create_pods.sql).
--   - Snapshot columns (consignor/consignee/address/GST/material/
--     qty/vehicle) are stored at save time so a printed Delivery
--     Challan remains historically accurate if the linked LR is
--     later edited. Manual fields: by_name, po_number, po_date, hsn.
--   - `qty` is the LR's Actual Weight (`loading_weight` on LRs).
-- ==========================================================

create table if not exists public.delivery_challans (
  id bigint generated always as identity primary key,

  lr_number text not null,
  lr_date date not null,

  consignor text not null default '',
  consignor_address text not null default '',
  consignor_gst text not null default '',

  consignee text not null default '',
  consignee_address text not null default '',
  consignee_gst text not null default '',

  -- Manual "By" line under the consignor name on the printed challan.
  by_name text not null default '',

  po_number text not null default '',
  po_date date not null,

  description text not null default '',
  qty numeric not null default 0,
  vehicle_number text not null default '',
  hsn text not null default '',

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_delivery_challans_lr_number
  on public.delivery_challans (lr_number);

create index if not exists idx_delivery_challans_lr_date
  on public.delivery_challans (lr_date);

create or replace function public.set_delivery_challans_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_delivery_challans_updated_at on public.delivery_challans;

create trigger trg_delivery_challans_updated_at
before update on public.delivery_challans
for each row
execute function public.set_delivery_challans_updated_at();


-- ==========================================================
-- RLS — same permission-key pattern as pods (migration 021).
-- Permission key: `delivery_challans` (see lib/permissions.ts).
-- Admins / full_access users pass via has_permission().
-- ==========================================================

alter table public.delivery_challans enable row level security;

drop policy if exists delivery_challans_select on public.delivery_challans;

create policy delivery_challans_select
on public.delivery_challans
for select
to authenticated
using (
  public.has_permission('delivery_challans', 'view')
);

drop policy if exists delivery_challans_insert on public.delivery_challans;

create policy delivery_challans_insert
on public.delivery_challans
for insert
to authenticated
with check (
  public.has_permission('delivery_challans', 'create_view')
);

drop policy if exists delivery_challans_update on public.delivery_challans;

create policy delivery_challans_update
on public.delivery_challans
for update
to authenticated
using (
  public.has_permission('delivery_challans', 'edit')
)
with check (
  public.has_permission('delivery_challans', 'edit')
);
