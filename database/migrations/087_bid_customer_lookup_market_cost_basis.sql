-- ==========================================================
-- Migration: 087_bid_customer_lookup_market_cost_basis
-- Module:    Bid Management — searchable Customer Master lookup
--            + explicit market-cost basis
--
-- REVIEW BEFORE MANUAL APPLICATION. This migration is not run
-- automatically by the application.
--
-- Historical transport_bids.market_vehicle_quote values are already
-- total trip/vehicle amounts. The Per Trip default preserves every
-- existing bid's current economics without reinterpretation.
-- ==========================================================

begin;

alter table public.transport_bids
  add column market_vehicle_cost_basis text not null default 'Per Trip'
    check (market_vehicle_cost_basis in ('Per MT', 'Per Trip'));

create or replace function public.transport_bid_before_write()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.bid_reference := nullif(trim(coalesce(new.bid_reference, '')), '');
  new.billing_party_name := trim(coalesce(new.billing_party_name, ''));
  new.pickup_location := trim(new.pickup_location);
  new.dropoff_location := trim(new.dropoff_location);
  new.vehicle_type := nullif(trim(coalesce(new.vehicle_type, '')), '');
  new.material_name := trim(coalesce(new.material_name, ''));
  new.material_description := nullif(trim(coalesce(new.material_description, '')), '');

  if not exists (select 1 from public.billing_parties
    where id = new.billing_party_id and coalesce(entry_status, 'final') = 'final') then
    raise exception 'Choose a finalized billing party';
  end if;

  if new.consignor_id is not null
    and not exists (select 1 from public.customers where id = new.consignor_id) then
    raise exception 'Choose a consignor from Customer Master';
  end if;
  if new.consignee_id is not null
    and not exists (select 1 from public.customers where id = new.consignee_id) then
    raise exception 'Choose a consignee from Customer Master';
  end if;
  if new.material_id is not null
    and not exists (select 1 from public.materials where id = new.material_id) then
    raise exception 'Choose a material from Material Master';
  end if;

  if tg_op = 'INSERT'
    or new.billing_party_id is distinct from old.billing_party_id then
    select name into new.billing_party_name
    from public.billing_parties where id = new.billing_party_id;
  else
    new.billing_party_name := old.billing_party_name;
  end if;
  if tg_op = 'INSERT' or new.consignor_id is distinct from old.consignor_id then
    if new.consignor_id is null then
      new.consignor_name := '';
    else
      select name into new.consignor_name
      from public.customers where id = new.consignor_id;
    end if;
  else
    new.consignor_name := old.consignor_name;
  end if;
  if tg_op = 'INSERT' or new.consignee_id is distinct from old.consignee_id then
    if new.consignee_id is null then
      new.consignee_name := '';
    else
      select name into new.consignee_name
      from public.customers where id = new.consignee_id;
    end if;
  else
    new.consignee_name := old.consignee_name;
  end if;
  if tg_op = 'INSERT' or new.material_id is distinct from old.material_id then
    if new.material_id is null then
      new.material_name := '';
    else
      select material_name into new.material_name
      from public.materials where id = new.material_id;
    end if;
  else
    new.material_name := old.material_name;
  end if;

  if new.winning_rate is not null and new.winning_rate_basis is null then
    raise exception 'Winning rate requires a rate basis (Per MT or Per Vehicle)';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.status in ('Won', 'Lost') and not public.is_admin() then
      if new.status is distinct from old.status
        or new.billing_party_id is distinct from old.billing_party_id
        or new.consignor_id is distinct from old.consignor_id
        or new.consignee_id is distinct from old.consignee_id
        or new.pickup_location is distinct from old.pickup_location
        or new.dropoff_location is distinct from old.dropoff_location
        or new.distance_km is distinct from old.distance_km
        or new.material_id is distinct from old.material_id
        or new.material_description is distinct from old.material_description
        or new.vehicle_type is distinct from old.vehicle_type
        or new.total_quantity_mt is distinct from old.total_quantity_mt
        or new.expected_load_mt is distinct from old.expected_load_mt
        or new.market_vehicle_quote is distinct from old.market_vehicle_quote
        or new.market_vehicle_cost_basis is distinct from old.market_vehicle_cost_basis
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

create or replace function public.get_bid_customer_lookup(
  p_query text default '',
  p_limit integer default 25
)
returns table (
  id bigint,
  name text,
  code text,
  gst text,
  city text,
  address text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_query text := regexp_replace(lower(trim(coalesce(p_query, ''))), '[[:space:]]+', ' ', 'g');
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 50));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    public.has_module_action('bids', 'create')
    or public.has_module_action('bids', 'edit')
  ) then
    raise exception 'Not permitted to look up customers for Bid entry';
  end if;

  return query
  select
    c.id,
    c.name,
    c.code,
    c.gst,
    c.city,
    c.address
  from public.customers c
  where v_query = ''
    or position(v_query in regexp_replace(lower(coalesce(c.name, '')), '[[:space:]]+', ' ', 'g')) > 0
    or position(v_query in regexp_replace(lower(coalesce(c.code, '')), '[[:space:]]+', ' ', 'g')) > 0
    or position(v_query in regexp_replace(lower(coalesce(c.gst, '')), '[[:space:]]+', ' ', 'g')) > 0
    or position(v_query in regexp_replace(lower(coalesce(c.city, '')), '[[:space:]]+', ' ', 'g')) > 0
    or position(v_query in regexp_replace(lower(coalesce(c.address, '')), '[[:space:]]+', ' ', 'g')) > 0
  order by
    case when v_query <> '' and regexp_replace(lower(coalesce(c.name, '')), '[[:space:]]+', ' ', 'g') = v_query then 0 else 1 end,
    c.name asc,
    c.id asc
  limit v_limit;
end;
$$;

revoke all on function public.get_bid_customer_lookup(text, integer) from public, anon;
grant execute on function public.get_bid_customer_lookup(text, integer) to authenticated;

commit;
