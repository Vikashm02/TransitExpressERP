-- ==========================================================
-- Migration: 024_create_asn_creations
-- Module:    ASN Creation
--
-- Reference: components/asn/asn.schema.ts
--            components/services/asn.service.ts
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- against the target Supabase project before the ASN module is used.
--
-- Notes:
--   - Purely additive CREATE TABLE IF NOT EXISTS.
--   - `lr_number` is plain text with NO foreign key to `public.lrs`,
--     matching Delivery Challan / POD conventions.
--   - LR-derived columns are snapshotted at save time.
--   - File columns store public Supabase Storage URLs (bucket: asn-assets).
--   - Permission key: `asn_creations` (see lib/permissions.ts).
-- ==========================================================

create table if not exists public.asn_creations (
  id bigint generated always as identity primary key,

  asn_number text not null unique,
  asn_date date not null,

  lr_number text not null,
  lr_date date,

  vehicle_number text not null default '',
  driver_name text not null default '',
  driver_contact text not null default '',

  challan_invoice_number text not null default '',
  challan_invoice_date date,

  supplier_tare_weight numeric not null default 0,
  supplier_net_weight numeric not null default 0,
  supplier_gross_weight numeric not null default 0,
  challan_qty numeric not null default 0,

  expected_time_of_arrival timestamptz not null,
  road_permit text not null default '',

  weightment_slip_url text,
  challan_copy_slip_url text,
  lr_copy_slip_url text,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_asn_creations_asn_number
  on public.asn_creations (asn_number);

create index if not exists idx_asn_creations_lr_number
  on public.asn_creations (lr_number);

create index if not exists idx_asn_creations_asn_date
  on public.asn_creations (asn_date);

create or replace function public.set_asn_creations_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_asn_creations_updated_at on public.asn_creations;

create trigger trg_asn_creations_updated_at
before update on public.asn_creations
for each row
execute function public.set_asn_creations_updated_at();


-- ==========================================================
-- RLS — same permission-key pattern as delivery_challans (023).
-- Permission key: `asn_creations`
-- ==========================================================

alter table public.asn_creations enable row level security;

drop policy if exists asn_creations_select on public.asn_creations;

create policy asn_creations_select
on public.asn_creations
for select
to authenticated
using (
  public.has_permission('asn_creations', 'view')
);

drop policy if exists asn_creations_insert on public.asn_creations;

create policy asn_creations_insert
on public.asn_creations
for insert
to authenticated
with check (
  public.has_permission('asn_creations', 'create_view')
);

drop policy if exists asn_creations_update on public.asn_creations;

create policy asn_creations_update
on public.asn_creations
for update
to authenticated
using (
  public.has_permission('asn_creations', 'edit')
)
with check (
  public.has_permission('asn_creations', 'edit')
);


-- Public bucket for ASN slip uploads (same pattern as pod-assets).
insert into storage.buckets (id, name, public)
values ('asn-assets', 'asn-assets', true)
on conflict (id) do nothing;

drop policy if exists asn_assets_insert on storage.objects;
create policy asn_assets_insert
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'asn-assets');

drop policy if exists asn_assets_select on storage.objects;
create policy asn_assets_select
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'asn-assets');
