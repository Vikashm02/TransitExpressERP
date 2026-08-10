-- ==========================================================
-- Migration: 011_create_pods
-- Module:    POD (Proof of Delivery) Entry
-- Created:   POD module reference implementation
--
-- Reference: components/pod/pod.schema.ts
--            components/services/pod.service.ts
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- (or via your preferred migration tool) against the target Supabase
-- project before the POD module is used.
--
-- Notes:
--   - `lr_number` is plain text with NO foreign key to `public.lrs`,
--     matching the locked "no foreign keys" convention already used by
--     every other module in this app (see 007_create_lrs.sql notes) —
--     also sidesteps the pre-existing `lrs.id` type ambiguity noted in
--     the LR Print route (documented as bigint here, but UUID on at
--     least one live project).
--   - Consignor/Consignee/Vehicle Number/Driver Name/From/To are
--     display-only fields resolved live from the linked LR at
--     read/entry time (via the existing `getLRs()`); they are
--     intentionally NOT stored on this table, since only LR Number,
--     POD Date, Unloading Weight, Unloading Date, and the POD file are
--     ever saved here.
--   - `proof_url` is nullable until a file is uploaded via Supabase
--     Storage (see `uploadPodProof`), same pattern as
--     `drivers.photo_url` / `company_settings.logo_url`.
--   - This migration also provisions a public `pod-assets` Storage
--     bucket (same pattern the app already expects for
--     `company-assets` / `driver-assets`), since `storage.buckets` is
--     just a normal table and creating it here removes the need for a
--     separate manual Dashboard step.
--   - Storage RLS policies for `pod-assets`: only INSERT and SELECT are
--     granted, to the `anon` role only — the exact two operations
--     `uploadPodProof()` (upload + getPublicUrl) needs, matching the
--     app's current auth model (no signed-in user; `lib/supabase.ts`
--     always uses the anon key). No UPDATE or DELETE policy is added.
-- ==========================================================

create table if not exists public.pods (
  id bigint generated always as identity primary key,

  lr_number text not null,
  pod_date date not null,
  unloading_weight numeric not null default 0,
  unloading_date date not null,

  -- Proof of POD (Supabase Storage URL — nullable until uploaded)
  proof_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pods_lr_number on public.pods (lr_number);

-- Keeps `updated_at` current on every row update.
create or replace function public.set_pods_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_pods_updated_at on public.pods;

create trigger trg_pods_updated_at
before update on public.pods
for each row
execute function public.set_pods_updated_at();

-- Public bucket for POD proof files (PDF/JPG/JPEG/PNG uploads).
insert into storage.buckets (id, name, public)
values ('pod-assets', 'pod-assets', true)
on conflict (id) do nothing;

-- Minimum Storage RLS policies required by `uploadPodProof()`
-- (components/services/pod.service.ts): upload (INSERT) and
-- getPublicUrl/read (SELECT) on the `pod-assets` bucket, for the `anon`
-- role only. No UPDATE or DELETE policy is created.
drop policy if exists "pod-assets insert (anon)" on storage.objects;

create policy "pod-assets insert (anon)"
on storage.objects
for insert
to anon
with check (bucket_id = 'pod-assets');

drop policy if exists "pod-assets select (anon)" on storage.objects;

create policy "pod-assets select (anon)"
on storage.objects
for select
to anon
using (bucket_id = 'pod-assets');
