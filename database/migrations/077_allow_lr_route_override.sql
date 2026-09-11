-- Preserve automatic master-city defaults while allowing a route override.
begin;

create or replace function public.lr_derive_route_from_master() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_from text; v_to text;
begin
  if new.entry_status <> 'final' then return new; end if;
  select city into v_from from public.customers
    where upper(trim(name)) = upper(trim(new.consignor)) and coalesce(entry_status, 'final') = 'final';
  select city into v_to from public.customers
    where upper(trim(name)) = upper(trim(new.consignee)) and coalesce(entry_status, 'final') = 'final';
  if nullif(trim(v_from), '') is null then raise exception 'Consignor city is required in Customer Master'; end if;
  if nullif(trim(v_to), '') is null then raise exception 'Consignee city is required in Customer Master'; end if;
  -- Party selection fills the default in the browser. Preserve a staff-entered
  -- route when the actual pickup or delivery location differs from the master.
  if nullif(trim(new.from_station), '') is null then new.from_station := v_from; end if;
  if nullif(trim(new.to_station), '') is null then new.to_station := v_to; end if;
  return new;
end;
$$;
revoke all on function public.lr_derive_route_from_master() from public, anon, authenticated;

commit;
