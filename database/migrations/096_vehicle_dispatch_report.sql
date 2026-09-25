-- Migration: 096_vehicle_dispatch_report
-- Read-only, paginated operational reporting over finalized, non-cancelled LRs.
begin;

create or replace function public.get_vehicle_dispatch_report(
  p_from date,
  p_to date,
  p_consignor text default null,
  p_consignee text default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from date := p_from;
  v_to date := p_to;
  v_consignor text := trim(coalesce(p_consignor, ''));
  v_consignee text := trim(coalesce(p_consignee, ''));
  -- Cap the page before multiplying by page size so OFFSET remains safely within integer range.
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 1000000);
  v_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_offset integer;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_permission('reports', 'view') then
    raise exception 'Not permitted to view Vehicle Dispatch Report';
  end if;

  if v_from is null or v_to is null then
    raise exception 'From Date and To Date are required';
  end if;

  if v_from > v_to then
    raise exception 'From Date cannot be after To Date';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  with base_period as (
    select
      l.id::text as id,
      l.lr_date,
      l.lr_number,
      coalesce(nullif(trim(l.vehicle_number), ''), '') as vehicle_number,
      coalesce(nullif(trim(l.consignor), ''), 'Unknown') as consignor,
      coalesce(nullif(trim(l.consignee), ''), 'Unknown') as consignee,
      coalesce(nullif(trim(l.material), ''), 'Unknown') as material,
      coalesce(nullif(trim(l.from_station), ''), '') as from_station,
      coalesce(nullif(trim(l.to_station), ''), '') as to_station,
      coalesce(l.loading_weight, 0)::numeric as loading_weight
    from public.lrs l
    where coalesce(l.entry_status, 'final') = 'final'
      and l.status is distinct from 'Cancelled'
      and l.lr_date >= v_from
      and l.lr_date <= v_to
  ),
  base as (
    select *
    from base_period
    where (v_consignor = '' or upper(consignor) = upper(v_consignor))
      and (v_consignee = '' or upper(consignee) = upper(v_consignee))
  ),
  summary as (
    select
      count(*)::integer as total_loads,
      count(distinct nullif(regexp_replace(upper(vehicle_number), '[^A-Z0-9]', '', 'g'), ''))::integer as unique_vehicles,
      coalesce(sum(loading_weight), 0)::numeric as total_loading_weight
    from base
  ),
  filter_options as (
    select jsonb_build_object(
      'consignors', coalesce((
        select jsonb_agg(x.name order by x.name)
        from (
          select min(consignor) as name
          from base_period
          group by upper(consignor)
        ) x
      ), '[]'::jsonb),
      'consignees', coalesce((
        select jsonb_agg(x.name order by x.name)
        from (
          select min(consignee) as name
          from base_period
          group by upper(consignee)
        ) x
      ), '[]'::jsonb)
    ) as payload
  ),
  page_rows as (
    select *
    from base
    order by lr_date desc, lr_number desc, id desc
    offset v_offset
    limit v_page_size
  )
  select jsonb_build_object(
    'filters', jsonb_build_object(
      'from_date', v_from,
      'to_date', v_to,
      'consignor', v_consignor,
      'consignee', v_consignee
    ),
    'summary', jsonb_build_object(
      'total_loads', (select total_loads from summary),
      'unique_vehicles', (select unique_vehicles from summary),
      'total_loading_weight', round((select total_loading_weight from summary), 3)
    ),
    'filter_options', (select payload from filter_options),
    'pagination', jsonb_build_object(
      'page', v_page,
      'page_size', v_page_size,
      'total_count', (select total_loads from summary)
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'lr_date', lr_date,
        'lr_number', lr_number,
        'vehicle_number', vehicle_number,
        'consignor', consignor,
        'consignee', consignee,
        'material', material,
        'loading_weight', round(loading_weight, 3),
        'from_station', from_station,
        'to_station', to_station
      ) order by lr_date desc, lr_number desc, id desc)
      from page_rows
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_vehicle_dispatch_report(date, date, text, text, integer, integer) from public, anon;
grant execute on function public.get_vehicle_dispatch_report(date, date, text, text, integer, integer) to authenticated;

comment on function public.get_vehicle_dispatch_report(date, date, text, text, integer, integer) is
  'Read-only Vehicle Dispatch Report: final non-cancelled LR trips, normalized unique vehicles, loading weight, historical party snapshots, and paginated detail. Requires reports:view.';

commit;
