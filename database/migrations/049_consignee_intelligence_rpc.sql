-- ==========================================================
-- Migration: 049_consignee_intelligence_rpc
-- Module:    Consignee Intelligence V1 — read-only analytics RPC
--
-- Additive ONLY: creates public.get_consignee_intelligence(...).
-- Does NOT alter tables, columns, indexes, RLS, LR numbering,
-- delete policies, or existing RPCs.
--
-- NOT executed automatically — review, then apply manually in Supabase.
-- Does NOT change any existing LR / customer / material data.
--
-- Security:
--   SECURITY DEFINER + search_path = public
--   Requires auth.uid()
--   Requires has_permission('lr', 'view')
--   EXECUTE granted to authenticated only (revoked from PUBLIC)
--
-- Filters (V1 product rules):
--   exact consignee name match (trim of parameter; equality on stored value)
--   coalesce(entry_status, 'final') = 'final'
--   status is distinct from 'Cancelled'
--   lr_date within analysis window (looking back from current_date)
--   quantity metric: loading_weight
-- ==========================================================

create or replace function public.get_consignee_intelligence(
  p_consignee text,
  p_window text default '90',
  p_gst text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := trim(coalesce(p_consignee, ''));
  v_gst text := nullif(trim(coalesce(p_gst, '')), '');
  v_window text := lower(trim(coalesce(p_window, '90')));
  v_from date;
  v_to date := current_date;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_permission('lr', 'view') then
    raise exception 'Not permitted to view LR intelligence';
  end if;

  if v_window not in ('90', '180', '365', 'all') then
    v_window := '90';
  end if;

  if v_window = 'all' then
    v_from := null;
  else
    v_from := v_to - (v_window::integer - 1);
  end if;

  if v_name = '' then
    return jsonb_build_object(
      'identity', jsonb_build_object('name', '', 'gst', v_gst),
      'window', jsonb_build_object('key', v_window, 'from', v_from, 'to', v_to),
      'material_mix', '[]'::jsonb,
      'material_evolution', '[]'::jsonb,
      'frequency', jsonb_build_object(
        'lr_count', 0,
        'last_lr_date', null,
        'days_since_last', null,
        'average_interval', null,
        'median_interval', null,
        'typical_interval', null,
        'estimated_next', null,
        'insufficient_history', true
      ),
      'demand', jsonb_build_object('months', '[]'::jsonb, 'direction', 'Irregular'),
      'recent_lrs', '[]'::jsonb,
      'meta', jsonb_build_object('lr_count', 0, 'total_weight', 0, 'empty', true)
    );
  end if;

  with base as (
    select
      l.id::text as id,
      l.lr_number,
      l.lr_date,
      coalesce(nullif(trim(l.material), ''), 'Unknown') as material,
      coalesce(l.loading_weight, 0)::numeric as loading_weight
    from public.lrs l
    where l.consignee = v_name
      and coalesce(l.entry_status, 'final') = 'final'
      and l.status is distinct from 'Cancelled'
      and (v_from is null or l.lr_date >= v_from)
      and l.lr_date <= v_to
  ),
  totals as (
    select
      count(*)::integer as lr_count,
      coalesce(sum(loading_weight), 0)::numeric as total_weight,
      max(lr_date) as last_lr_date
    from base
  ),
  ranked_materials as (
    select
      material,
      sum(loading_weight) as weight,
      count(*)::integer as trip_count,
      row_number() over (order by sum(loading_weight) desc, material) as rn
    from base
    group by material
  ),
  mix_rolled as (
    select
      case when rn <= 5 then material else 'Other' end as material,
      sum(weight) as weight,
      sum(trip_count)::integer as trip_count,
      min(case when rn <= 5 then rn else 6 end) as sort_key
    from ranked_materials
    group by case when rn <= 5 then material else 'Other' end
  ),
  material_mix as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'material', m.material,
            'weight', round(m.weight, 3),
            'percentage', case
              when t.total_weight > 0 then round((m.weight / t.total_weight) * 100, 1)
              else 0
            end,
            'trip_count', m.trip_count
          )
          order by m.sort_key
        )
        from mix_rolled m
        cross join totals t
      ),
      '[]'::jsonb
    ) as payload
  ),
  top5 as (
    select material from ranked_materials where rn <= 5
  ),
  monthly_raw as (
    select
      date_trunc('month', b.lr_date)::date as month_start,
      case
        when exists (select 1 from top5 t where t.material = b.material)
          then b.material
        else 'Other'
      end as material,
      sum(b.loading_weight) as weight,
      count(*)::integer as lr_count
    from base b
    group by 1, 2
  ),
  month_totals as (
    select month_start, sum(weight) as total_weight, sum(lr_count)::integer as lr_count
    from monthly_raw
    group by month_start
  ),
  material_evolution as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'month', to_char(mt.month_start, 'YYYY-MM'),
            'total_weight', round(mt.total_weight, 3),
            'shares', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'material', mr.material,
                    'weight', round(mr.weight, 3),
                    'percentage', case
                      when mt.total_weight > 0
                        then round((mr.weight / mt.total_weight) * 100, 1)
                      else 0
                    end
                  )
                  order by case when mr.material = 'Other' then 1 else 0 end, mr.material
                )
                from monthly_raw mr
                where mr.month_start = mt.month_start
              ),
              '[]'::jsonb
            )
          )
          order by mt.month_start
        )
        from month_totals mt
      ),
      '[]'::jsonb
    ) as payload
  ),
  demand_months as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'month', to_char(mt.month_start, 'YYYY-MM'),
            'lr_count', mt.lr_count,
            'weight', round(mt.total_weight, 3)
          )
          order by mt.month_start
        )
        from month_totals mt
      ),
      '[]'::jsonb
    ) as payload
  ),
  recent_lrs as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'lr_number', x.lr_number,
            'lr_date', x.lr_date,
            'material', x.material,
            'loading_weight', round(x.loading_weight, 3)
          )
          order by x.lr_date desc, x.id desc
        )
        from (
          select * from base
          order by lr_date desc, id desc
          limit 10
        ) x
      ),
      '[]'::jsonb
    ) as payload
  ),
  gaps as (
    select (lr_date - prev_date)::numeric as gap_days
    from (
      select
        lr_date,
        lag(lr_date) over (order by lr_date, id) as prev_date
      from base
    ) o
    where prev_date is not null
  ),
  frequency as (
    select
      t.lr_count,
      t.last_lr_date,
      case when t.last_lr_date is null then null else (v_to - t.last_lr_date) end as days_since_last,
      case when t.lr_count < 2 then null else (
        select round(avg(gap_days), 1) from gaps
      ) end as average_interval,
      case when t.lr_count < 2 then null else (
        select round(
          (percentile_cont(0.5) within group (order by gap_days))::numeric,
          1
        )
        from gaps
      ) end as median_interval,
      (t.lr_count < 2) as insufficient_history
    from totals t
  ),
  frequency_final as (
    select
      f.*,
      coalesce(f.median_interval, f.average_interval) as typical_interval,
      case
        when f.insufficient_history or f.last_lr_date is null
          or coalesce(f.median_interval, f.average_interval) is null
        then null
        else f.last_lr_date
          + round(coalesce(f.median_interval, f.average_interval))::integer
      end as estimated_next
    from frequency f
  ),
  direction_stats as (
    select
      avg(lr_count) filter (where rn between 1 and 3) as recent_avg,
      avg(lr_count) filter (where rn between 4 and 6) as prior_avg,
      case
        when count(*) filter (where rn between 1 and 6) >= 2
          and avg(lr_count) filter (where rn between 1 and 6) > 0
        then (
          stddev_pop(lr_count) filter (where rn between 1 and 6)
          / nullif(avg(lr_count) filter (where rn between 1 and 6), 0)
        )
        else null
      end as cv
    from (
      select
        mt.lr_count::numeric as lr_count,
        row_number() over (order by mt.month_start desc) as rn
      from month_totals mt
    ) labeled
  ),
  demand_direction as (
    select case
      when d.recent_avg is null then 'Irregular'
      when d.prior_avg is null then 'Stable'
      when d.cv is not null and d.cv >= 0.75 then 'Irregular'
      when d.recent_avg > d.prior_avg * 1.15 then 'Increasing'
      when d.recent_avg < d.prior_avg * 0.85 then 'Decreasing'
      else 'Stable'
    end as direction
    from direction_stats d
  )
  select jsonb_build_object(
    'identity', jsonb_build_object('name', v_name, 'gst', v_gst),
    'window', jsonb_build_object('key', v_window, 'from', v_from, 'to', v_to),
    'material_mix', (select payload from material_mix),
    'material_evolution', (select payload from material_evolution),
    'frequency', (
      select jsonb_build_object(
        'lr_count', f.lr_count,
        'last_lr_date', f.last_lr_date,
        'days_since_last', f.days_since_last,
        'average_interval', f.average_interval,
        'median_interval', f.median_interval,
        'typical_interval', f.typical_interval,
        'estimated_next', f.estimated_next,
        'insufficient_history', f.insufficient_history
      )
      from frequency_final f
    ),
    'demand', jsonb_build_object(
      'months', (select payload from demand_months),
      'direction', (select direction from demand_direction)
    ),
    'recent_lrs', (select payload from recent_lrs),
    'meta', (
      select jsonb_build_object(
        'lr_count', t.lr_count,
        'total_weight', round(t.total_weight, 3),
        'empty', t.lr_count = 0
      )
      from totals t
    )
  )
  into v_result
  from totals
  limit 1;

  return coalesce(
    v_result,
    jsonb_build_object(
      'identity', jsonb_build_object('name', v_name, 'gst', v_gst),
      'window', jsonb_build_object('key', v_window, 'from', v_from, 'to', v_to),
      'material_mix', '[]'::jsonb,
      'material_evolution', '[]'::jsonb,
      'frequency', jsonb_build_object(
        'lr_count', 0,
        'last_lr_date', null,
        'days_since_last', null,
        'average_interval', null,
        'median_interval', null,
        'typical_interval', null,
        'estimated_next', null,
        'insufficient_history', true
      ),
      'demand', jsonb_build_object('months', '[]'::jsonb, 'direction', 'Irregular'),
      'recent_lrs', '[]'::jsonb,
      'meta', jsonb_build_object('lr_count', 0, 'total_weight', 0, 'empty', true)
    )
  );
end;
$$;

revoke all on function public.get_consignee_intelligence(text, text, text)
  from public;
grant execute on function public.get_consignee_intelligence(text, text, text)
  to authenticated;

comment on function public.get_consignee_intelligence(text, text, text) is
  'Consignee Intelligence V1: read-only aggregates for exact consignee name. Requires lr view. Does not modify data.';
