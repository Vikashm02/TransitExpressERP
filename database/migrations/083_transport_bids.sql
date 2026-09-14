-- ==========================================================
-- Migration: 083_transport_bids
-- Module:    Bid Management / Transport Bid Tracking (Phase 1)
--
-- REVIEW ONLY: manually apply before deploying the UI.
-- Additive only: creates public.transport_bids, no existing table
-- altered, no backfill, no numbering changes.
--
-- Design notes (see implementation report):
-- * Inputs are persisted; every margin/total is derived in
--   lib/calculations/bidCalculations.ts and never stored.
-- * billing_party_name / material_name are historical snapshots
--   frozen at write time so master renames never rewrite history.
-- * bid_reference is optional; blank normalizes to NULL and the
--   uniqueness index ignores NULLs.
-- * Closed-bid protection is deliberately non-irreversible:
--   Won/Lost commercial columns AND the status value itself are
--   frozen for non-admins (freezing status closes the
--   Won -> Live -> edit -> Won bypass), but public.is_admin()
--   (Creator/Tier 1, migration 041) may still correct/reopen them.
--   Cancelled / Not Submitted stay fully editable
--   (including reopen to Draft/Live).
-- Requires the existing permission helpers (has_permission /
-- has_module_action) — no new auth system.
-- ==========================================================

begin;

create table public.transport_bids (
  id uuid primary key default gen_random_uuid(),
  bid_reference text,
  billing_party_id bigint not null references public.billing_parties(id) on delete restrict,
  billing_party_name text not null,
  consignor_id bigint not null references public.customers(id) on delete restrict,
  consignor_name text not null,
  consignee_id bigint not null references public.customers(id) on delete restrict,
  consignee_name text not null,
  source text not null check (source in ('Cargo Exchange', 'Email', 'Manual', 'Other')),
  status text not null default 'Draft'
    check (status in ('Draft', 'Live', 'Won', 'Lost', 'Cancelled', 'Not Submitted')),
  pickup_location text not null check (length(trim(pickup_location)) between 1 and 120),
  dropoff_location text not null check (length(trim(dropoff_location)) between 1 and 120),
  distance_km numeric not null check (distance_km >= 0 and distance_km < 'Infinity'::numeric),
  transit_time text not null default '',
  material_id bigint not null references public.materials(id) on delete restrict,
  material_name text not null,
  vehicle_type text not null check (length(trim(vehicle_type)) between 1 and 60),
  total_quantity_mt numeric not null check (total_quantity_mt > 0 and total_quantity_mt < 'Infinity'::numeric),
  expected_load_mt numeric not null check (expected_load_mt > 0 and expected_load_mt < 'Infinity'::numeric),
  market_vehicle_quote numeric not null check (market_vehicle_quote >= 0 and market_vehicle_quote < 'Infinity'::numeric),
  bid_rate_basis text not null check (bid_rate_basis in ('Per MT', 'Per Vehicle')),
  bid_rate numeric not null check (bid_rate >= 0 and bid_rate < 'Infinity'::numeric),
  winning_rate numeric check (winning_rate is null or (winning_rate >= 0 and winning_rate < 'Infinity'::numeric)),
  winning_rate_basis text check (winning_rate_basis is null or winning_rate_basis in ('Per MT', 'Per Vehicle')),
  posted_at timestamptz not null default now(),
  closes_at timestamptz,
  loss_reason text check (loss_reason is null or loss_reason in
    ('Rate Too High', 'Vehicle Availability', 'Commercial Decision',
     'Customer Cancelled', 'Capacity Issue', 'Unknown', 'Other')),
  result_remarks text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);

-- Case-insensitive uniqueness, NULLs ignored so any number of bids
-- may have no external reference.
create unique index transport_bids_reference_unique
  on public.transport_bids (upper(trim(bid_reference)))
  where bid_reference is not null;
create index transport_bids_status_closes
  on public.transport_bids (status, closes_at);
create index transport_bids_party
  on public.transport_bids (billing_party_id);

alter table public.transport_bids enable row level security;
revoke all on public.transport_bids from anon, authenticated;
grant select, insert, update on public.transport_bids to authenticated;

create policy transport_bids_view on public.transport_bids
  for select to authenticated
  using (public.has_permission('bids', 'view'));
create policy transport_bids_create on public.transport_bids
  for insert to authenticated
  with check (public.has_module_action('bids', 'create'));
create policy transport_bids_edit on public.transport_bids
  for update to authenticated
  using (public.has_module_action('bids', 'edit'))
  with check (public.has_module_action('bids', 'edit'));
-- No delete policy: closure is via status (Cancelled). Matches the
-- purchase_orders precedent; avoids creator-only-delete machinery.

create or replace function public.transport_bid_before_write()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Normalize text; blank external reference becomes NULL.
  new.bid_reference := nullif(trim(coalesce(new.bid_reference, '')), '');
  new.billing_party_name := trim(coalesce(new.billing_party_name, ''));
  new.pickup_location := trim(new.pickup_location);
  new.dropoff_location := trim(new.dropoff_location);
  new.vehicle_type := trim(new.vehicle_type);
  new.material_name := trim(coalesce(new.material_name, ''));

  -- Billing party must be a finalized master row (mirrors 073).
  if not exists (select 1 from public.billing_parties
    where id = new.billing_party_id and coalesce(entry_status, 'final') = 'final') then
    raise exception 'Choose a finalized billing party';
  end if;

  -- Consignor / consignee must be Customer Master rows (any status is
  -- deliberately allowed so historical parties stay selectable).
  if not exists (select 1 from public.customers where id = new.consignor_id) then
    raise exception 'Choose a consignor from Customer Master';
  end if;
  if not exists (select 1 from public.customers where id = new.consignee_id) then
    raise exception 'Choose a consignee from Customer Master';
  end if;

  -- Material must come from Material Master.
  if not exists (select 1 from public.materials where id = new.material_id) then
    raise exception 'Choose a material from Material Master';
  end if;

  -- Historical snapshots: on INSERT always freeze from masters (client
  -- text is never trusted); on UPDATE refresh ONLY the snapshot whose
  -- master ID changed and preserve OLD names otherwise, so a later
  -- master rename can never silently rewrite bid history.
  if tg_op = 'INSERT'
    or new.billing_party_id is distinct from old.billing_party_id then
    select name into new.billing_party_name
    from public.billing_parties where id = new.billing_party_id;
  else
    new.billing_party_name := old.billing_party_name;
  end if;
  if tg_op = 'INSERT'
    or new.consignor_id is distinct from old.consignor_id then
    select name into new.consignor_name
    from public.customers where id = new.consignor_id;
  else
    new.consignor_name := old.consignor_name;
  end if;
  if tg_op = 'INSERT'
    or new.consignee_id is distinct from old.consignee_id then
    select name into new.consignee_name
    from public.customers where id = new.consignee_id;
  else
    new.consignee_name := old.consignee_name;
  end if;
  if tg_op = 'INSERT'
    or new.material_id is distinct from old.material_id then
    select material_name into new.material_name
    from public.materials where id = new.material_id;
  else
    new.material_name := old.material_name;
  end if;

  -- A winning rate is meaningless without its basis.
  if new.winning_rate is not null and new.winning_rate_basis is null then
    raise exception 'Winning rate requires a rate basis (Per MT or Per Vehicle)';
  end if;

  -- Live bids need a closing time (future reminder scheduling source).
  -- Drafts may leave it empty while being prepared.
  if new.status = 'Live' and new.closes_at is null then
    raise exception 'Live bids require a closing date and time';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- Won/Lost freeze for non-admins: commercial columns (including
    -- the consignor/consignee lane) plus the status value itself
    -- (otherwise Won -> Live -> edit -> Won would bypass the freeze).
    -- Admins (is_admin) may still correct/reopen history;
    -- Cancelled / Not Submitted stay fully editable
    -- including reopen to Draft/Live.
    if old.status in ('Won', 'Lost') and not public.is_admin() then
      if new.status is distinct from old.status
        or new.billing_party_id is distinct from old.billing_party_id
        or new.consignor_id is distinct from old.consignor_id
        or new.consignee_id is distinct from old.consignee_id
        or new.pickup_location is distinct from old.pickup_location
        or new.dropoff_location is distinct from old.dropoff_location
        or new.distance_km is distinct from old.distance_km
        or new.material_id is distinct from old.material_id
        or new.vehicle_type is distinct from old.vehicle_type
        or new.total_quantity_mt is distinct from old.total_quantity_mt
        or new.expected_load_mt is distinct from old.expected_load_mt
        or new.market_vehicle_quote is distinct from old.market_vehicle_quote
        or new.bid_rate_basis is distinct from old.bid_rate_basis
        or new.bid_rate is distinct from old.bid_rate then
        raise exception 'Closed bid economics are frozen; ask an administrator to correct them';
      end if;
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.transport_bid_before_write() from public, anon, authenticated;

drop trigger if exists trg_transport_bids_before_write on public.transport_bids;
create trigger trg_transport_bids_before_write
  before insert or update on public.transport_bids
  for each row execute function public.transport_bid_before_write();

commit;
