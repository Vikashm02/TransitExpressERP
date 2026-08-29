-- ==========================================================
-- Migration: 055_material_intelligence_rpc
-- Module:    Material Intelligence V1
--
-- Purpose:
--   Read-only analytics for a selected material across consignees,
--   transported loading weight, LR count, and calendar-month trends.
--
-- Canonical fields (do not invent alternatives):
--   Weight  → public.lrs.loading_weight
--   Date    → public.lrs.lr_date
--   Material identity → exact trim match on public.lrs.material (text;
--                       no material_id FK on LRs today)
--   Consignee identity → exact match on public.lrs.consignee (text)
--
-- Filters (same as Consignee Intelligence):
--   entry_status = 'final'
--   status is distinct from 'Cancelled'
--   Analysis window is authoritative for ALL sections
--
-- Additive ONLY:
--   - Creates public.get_material_intelligence(...)
--   - Does NOT alter lrs / materials / customers RLS or schema
--   - Does NOT alter app_user_permissions
--   - Does NOT modify migrations 049–054
--
-- Security (mirrors Consignee Intelligence):
--   SECURITY DEFINER + search_path = public
--   Requires auth.uid()
--   Requires has_permission('lr', 'view')
--   EXECUTE granted to authenticated only (revoked from PUBLIC)
--
-- NOT executed automatically — review, then apply manually in Supabase.
-- ==========================================================

create or replace function public.get_material_intelligence(
  p_material text,
  p_window text default '90',
  p_focus_consignee text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_material text := trim(coalesce(p_material, ''));
  v_focus_param text := nullif(trim(coalesce(p_focus_consignee, '')), '');
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
    -- Inclusive lookback: e.g. 90 Days => from = today - 89.
    v_from := v_to - (v_window::integer - 1);
  end if;

  if v_material = '' then
    return jsonb_build_object(
      'identity', jsonb_build_object('material', ''),
      'window', jsonb_build_object(
        'key', v_window,
        'from', v_from,
        'to', v_to,
        'observation_days', null
      ),
      'overview', jsonb_build_object(
        'total_weight', 0,
        'lr_count', 0,
        'avg_weight_per_lr', null,
        'unique_consignees', 0,
        'period_from', v_from,
        'period_to', v_to
      ),
      'top_consignees', jsonb_build_object(
        'items', '[]'::jsonb,
        'other', null
      ),
      'weight_trend', '[]'::jsonb,
      'consignee_trend', '[]'::jsonb,
      'focus_consignee', jsonb_build_object(
        'name', '',
        'source', 'none',
        'material_mix', '[]'::jsonb,
        'share_trend', '[]'::jsonb,
        'selected_material_share', null
      ),
      'insights', '[]'::jsonb,
      'recent_lrs', '[]'::jsonb,
      'meta', jsonb_build_object('lr_count', 0, 'total_weight', 0, 'empty', true)
    );
  end if;

  with
  -- LRs for the selected material within the analysis window.
  base as (
    select
      l.id::text as id,
      l.lr_number,
      l.lr_date,
      coalesce(nullif(trim(l.consignee), ''), 'Unknown') as consignee,
      coalesce(nullif(trim(l.material), ''), 'Unknown') as material,
      coalesce(l.loading_weight, 0)::numeric as loading_weight
    from public.lrs l
    where trim(l.material) = v_material
      and coalesce(l.entry_status, 'final') = 'final'
      and l.status is distinct from 'Cancelled'
      and (v_from is null or l.lr_date >= v_from)
      and l.lr_date <= v_to
  ),
  totals as (
    select
      count(*)::integer as lr_count,
      coalesce(sum(loading_weight), 0)::numeric as total_weight,
      count(distinct consignee)::integer as unique_consignees,
      max(lr_date) as last_lr_date,
      min(lr_date) as first_lr_date
    from base
  ),
  observation as (
    select
      case
        when v_window = 'all' then
          case
            when t.lr_count = 0 or t.first_lr_date is null then null
            else greatest(1, (v_to - t.first_lr_date) + 1)
          end
        else v_window::integer
      end as observation_days
    from totals t
  ),
  overview as (
    select jsonb_build_object(
      'total_weight', round(t.total_weight, 3),
      'lr_count', t.lr_count,
      'avg_weight_per_lr', case
        when t.lr_count > 0 then round(t.total_weight / t.lr_count, 3)
        else null
      end,
      'unique_consignees', t.unique_consignees,
      'period_from', case
        when v_window = 'all' then t.first_lr_date
        else v_from
      end,
      'period_to', v_to
    ) as payload
    from totals t
  ),
  ranked_consignees as (
    select
      consignee,
      sum(loading_weight) as weight,
      count(*)::integer as lr_count,
      row_number() over (order by sum(loading_weight) desc, consignee) as rn
    from base
    group by consignee
  ),
  top_items as (
    select
      rn as rank,
      consignee,
      weight,
      lr_count
    from ranked_consignees
    where rn <= 10
  ),
  other_roll as (
    select
      coalesce(sum(weight), 0)::numeric as weight,
      coalesce(sum(lr_count), 0)::integer as lr_count,
      count(*)::integer as consignee_count
    from ranked_consignees
    where rn > 10
  ),
  top_consignees as (
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'rank', i.rank,
              'consignee', i.consignee,
              'weight', round(i.weight, 3),
              'percentage', case
                when t.total_weight > 0
                  then round((i.weight / t.total_weight) * 100, 1)
                else 0
              end,
              'lr_count', i.lr_count
            )
            order by i.rank
          )
          from top_items i
          cross join totals t
        ),
        '[]'::jsonb
      ),
      'other', case
        when (select consignee_count from other_roll) > 0 then
          (
            select jsonb_build_object(
              'weight', round(o.weight, 3),
              'percentage', case
                when t.total_weight > 0
                  then round((o.weight / t.total_weight) * 100, 1)
                else 0
              end,
              'lr_count', o.lr_count,
              'consignee_count', o.consignee_count
            )
            from other_roll o
            cross join totals t
          )
        else null
      end
    ) as payload
  ),
  -- Resolve focus consignee: explicit param if present in window, else #1 by weight.
  focus_resolved as (
    select
      case
        when v_focus_param is not null
          and exists (
            select 1 from ranked_consignees r where r.consignee = v_focus_param
          )
        then v_focus_param
        when v_focus_param is not null
          and exists (
            select 1
            from public.lrs l
            where trim(l.consignee) = v_focus_param
              and coalesce(l.entry_status, 'final') = 'final'
              and l.status is distinct from 'Cancelled'
              and (v_from is null or l.lr_date >= v_from)
              and l.lr_date <= v_to
          )
        then v_focus_param
        else (select consignee from ranked_consignees where rn = 1)
      end as focus_name,
      case
        when v_focus_param is not null then 'param'
        when exists (select 1 from ranked_consignees where rn = 1) then 'auto_top'
        else 'none'
      end as focus_source
  ),
  -- All materials for the focus consignee in the same analysis window (mix / share).
  focus_base as (
    select
      l.id::text as id,
      l.lr_date,
      coalesce(nullif(trim(l.material), ''), 'Unknown') as material,
      coalesce(l.loading_weight, 0)::numeric as loading_weight
    from public.lrs l
    cross join focus_resolved f
    where f.focus_name is not null
      and trim(l.consignee) = f.focus_name
      and coalesce(l.entry_status, 'final') = 'final'
      and l.status is distinct from 'Cancelled'
      and (v_from is null or l.lr_date >= v_from)
      and l.lr_date <= v_to
  ),
  focus_totals as (
    select
      coalesce(sum(loading_weight), 0)::numeric as total_weight,
      count(*)::integer as lr_count
    from focus_base
  ),
  focus_ranked_materials as (
    select
      material,
      sum(loading_weight) as weight,
      count(*)::integer as trip_count,
      row_number() over (order by sum(loading_weight) desc, material) as rn
    from focus_base
    group by material
  ),
  focus_mix_rolled as (
    select
      case when rn <= 5 then material else 'Other' end as material,
      sum(weight) as weight,
      sum(trip_count)::integer as trip_count,
      min(case when rn <= 5 then rn else 6 end) as sort_key
    from focus_ranked_materials
    group by case when rn <= 5 then material else 'Other' end
  ),
  focus_material_mix as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'material', m.material,
            'weight', round(m.weight, 3),
            'percentage', case
              when t.total_weight > 0
                then round((m.weight / t.total_weight) * 100, 1)
              else 0
            end,
            'trip_count', m.trip_count
          )
          order by m.sort_key, m.material
        )
        from focus_mix_rolled m
        cross join focus_totals t
      ),
      '[]'::jsonb
    ) as payload
  ),
  focus_selected_share as (
    select
      case
        when f.focus_name is null then null
        else (
          select jsonb_build_object(
            'material', v_material,
            'weight', round(coalesce(sum(fb.loading_weight), 0), 3),
            'percentage', case
              when ft.total_weight > 0
                then round((coalesce(sum(fb.loading_weight), 0) / ft.total_weight) * 100, 1)
              else 0
            end,
            'trip_count', count(*)::integer
          )
          from focus_base fb
          cross join focus_totals ft
          where fb.material = v_material
        )
      end as payload
    from focus_resolved f
  ),
  calendar_bounds as (
    select
      case
        when v_window = 'all' then
          date_trunc('month', (select first_lr_date from totals))::date
        else
          date_trunc('month', v_from)::date
      end as range_start,
      date_trunc('month', v_to)::date as range_end
  ),
  calendar_months as (
    select gs::date as month_start
    from calendar_bounds cb
    cross join lateral generate_series(
      cb.range_start,
      cb.range_end,
      interval '1 month'
    ) as gs
    where cb.range_start is not null
  ),
  monthly_weight_activity as (
    select
      date_trunc('month', lr_date)::date as month_start,
      sum(loading_weight) as weight,
      count(*)::integer as lr_count
    from base
    group by 1
  ),
  month_weight_totals as (
    select
      c.month_start,
      coalesce(a.weight, 0)::numeric as weight,
      coalesce(a.lr_count, 0)::integer as lr_count
    from calendar_months c
    left join monthly_weight_activity a on a.month_start = c.month_start
  ),
  weight_trend_months as (
    select
      mt.month_start,
      mt.weight,
      mt.lr_count,
      lag(mt.weight) over (order by mt.month_start) as prev_weight
    from month_weight_totals mt
  ),
  weight_trend as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'month', to_char(w.month_start, 'YYYY-MM'),
            'weight', round(w.weight, 3),
            'lr_count', w.lr_count,
            'change', case
              when w.prev_weight is null then null
              else round(w.weight - w.prev_weight, 3)
            end,
            'percentage_change', case
              when w.prev_weight is null then null
              when w.prev_weight = 0 then null
              else round(((w.weight - w.prev_weight) / w.prev_weight) * 100, 1)
            end,
            'comparison_available', w.prev_weight is not null
          )
          order by w.month_start
        )
        from weight_trend_months w
      ),
      '[]'::jsonb
    ) as payload
  ),
  top5_consignees as (
    select consignee from ranked_consignees where rn <= 5
  ),
  monthly_consignee_raw as (
    select
      date_trunc('month', b.lr_date)::date as month_start,
      case
        when exists (select 1 from top5_consignees t where t.consignee = b.consignee)
          then b.consignee
        else 'Other'
      end as consignee,
      sum(b.loading_weight) as weight
    from base b
    group by 1, 2
  ),
  month_consignee_activity as (
    select
      month_start,
      sum(weight) as total_weight
    from monthly_consignee_raw
    group by month_start
  ),
  month_consignee_totals as (
    select
      c.month_start,
      coalesce(a.total_weight, 0)::numeric as total_weight
    from calendar_months c
    left join month_consignee_activity a on a.month_start = c.month_start
  ),
  consignee_trend as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'month', to_char(mt.month_start, 'YYYY-MM'),
            'total_weight', round(mt.total_weight, 3),
            'consignees', case
              when mt.total_weight = 0 then '[]'::jsonb
              else coalesce(
                (
                  select jsonb_agg(
                    jsonb_build_object(
                      'consignee', mr.consignee,
                      'weight', round(mr.weight, 3),
                      'percentage', case
                        when mt.total_weight > 0
                          then round((mr.weight / mt.total_weight) * 100, 1)
                        else 0
                      end
                    )
                    order by
                      case when mr.consignee = 'Other' then 1 else 0 end,
                      mr.weight desc,
                      mr.consignee
                  )
                  from monthly_consignee_raw mr
                  where mr.month_start = mt.month_start
                ),
                '[]'::jsonb
              )
            end
          )
          order by mt.month_start
        )
        from month_consignee_totals mt
      ),
      '[]'::jsonb
    ) as payload
  ),
  -- Focus consignee monthly material weight share (top 5 materials + Other).
  focus_top5_materials as (
    select material from focus_ranked_materials where rn <= 5
  ),
  focus_monthly_raw as (
    select
      date_trunc('month', fb.lr_date)::date as month_start,
      case
        when exists (select 1 from focus_top5_materials t where t.material = fb.material)
          then fb.material
        else 'Other'
      end as material,
      sum(fb.loading_weight) as weight
    from focus_base fb
    group by 1, 2
  ),
  focus_month_activity as (
    select month_start, sum(weight) as total_weight
    from focus_monthly_raw
    group by month_start
  ),
  focus_month_totals as (
    select
      c.month_start,
      coalesce(a.total_weight, 0)::numeric as total_weight
    from calendar_months c
    left join focus_month_activity a on a.month_start = c.month_start
  ),
  focus_share_trend as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'month', to_char(mt.month_start, 'YYYY-MM'),
            'total_weight', round(mt.total_weight, 3),
            'shares', case
              when mt.total_weight = 0 then '[]'::jsonb
              else coalesce(
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
                    order by
                      case when mr.material = 'Other' then 1 else 0 end,
                      mr.weight desc,
                      mr.material
                  )
                  from focus_monthly_raw mr
                  where mr.month_start = mt.month_start
                ),
                '[]'::jsonb
              )
            end
          )
          order by mt.month_start
        )
        from focus_month_totals mt
      ),
      '[]'::jsonb
    ) as payload
  ),
  focus_consignee_payload as (
    select jsonb_build_object(
      'name', coalesce(f.focus_name, ''),
      'source', f.focus_source,
      'material_mix', (select payload from focus_material_mix),
      'share_trend', (select payload from focus_share_trend),
      'selected_material_share', (select payload from focus_selected_share)
    ) as payload
    from focus_resolved f
  ),
  recent_lrs as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'lr_number', x.lr_number,
            'lr_date', x.lr_date,
            'consignee', x.consignee,
            'material', x.material,
            'loading_weight', round(x.loading_weight, 3)
          )
          order by x.lr_date desc, x.id desc
        )
        from (
          select * from base
          order by lr_date desc, id desc
          limit 15
        ) x
      ),
      '[]'::jsonb
    ) as payload
  ),
  -- Deterministic insights from aggregated facts only (no speculation).
  insights as (
    select coalesce(
      (
        with
        insight_top as (
          select
            i.consignee,
            i.weight,
            i.percentage
          from top_items i
          order by i.rank
          limit 1
        ),
        insight_mom as (
          select *
          from weight_trend_months
          where prev_weight is not null
          order by month_start desc
          limit 1
        ),
        insight_streak as (
          select count(*)::integer as streak_len
          from (
            select
              month_start,
              weight,
              prev_weight,
              sum(
                case
                  when prev_weight is not null and weight > prev_weight then 0
                  else 1
                end
              ) over (order by month_start desc) as grp
            from weight_trend_months
          ) s
          where grp = 0
            and prev_weight is not null
            and weight > prev_weight
        ),
        insight_focus_share as (
          select
            f.focus_name,
            (select payload from focus_selected_share) as share
          from focus_resolved f
        ),
        insight_mix_shift as (
          select
            f.focus_name,
            first_share.pct as from_pct,
            last_share.pct as to_pct
          from focus_resolved f
          cross join lateral (
            select mt.month_start
            from focus_month_totals mt
            where mt.total_weight > 0
            order by mt.month_start
            limit 1
          ) first_m
          cross join lateral (
            select mt.month_start
            from focus_month_totals mt
            where mt.total_weight > 0
            order by mt.month_start desc
            limit 1
          ) last_m
          cross join lateral (
            select coalesce(
              round(
                (
                  select coalesce(sum(fb.loading_weight), 0)
                  from focus_base fb
                  where date_trunc('month', fb.lr_date)::date = first_m.month_start
                    and fb.material = v_material
                )
                / nullif(
                  (select total_weight from focus_month_totals where month_start = first_m.month_start),
                  0
                )
                * 100,
                1
              ),
              0
            ) as pct
          ) first_share
          cross join lateral (
            select coalesce(
              round(
                (
                  select coalesce(sum(fb.loading_weight), 0)
                  from focus_base fb
                  where date_trunc('month', fb.lr_date)::date = last_m.month_start
                    and fb.material = v_material
                )
                / nullif(
                  (select total_weight from focus_month_totals where month_start = last_m.month_start),
                  0
                )
                * 100,
                1
              ),
              0
            ) as pct
          ) last_share
          where f.focus_name is not null
            and first_m.month_start is distinct from last_m.month_start
        ),
        built as (
          select 1 as ord, jsonb_build_object(
            'id', 'top_consignee',
            'message',
              t.consignee
              || ' received the highest quantity of '
              || v_material
              || ' during the selected period: '
              || round(t.weight, 3)::text
              || ' MT ('
              || t.percentage::text
              || '% of total).'
          ) as item
          from insight_top t
          where t.weight > 0

          union all

          select 2, jsonb_build_object(
            'id', 'focus_share',
            'message',
              v_material
              || ' accounted for '
              || (s.share->>'percentage')
              || '% of '
              || s.focus_name
              || '''s transported material weight during the selected period ('
              || (s.share->>'weight')
              || ' MT).'
          )
          from insight_focus_share s
          where s.focus_name is not null
            and s.share is not null
            and (s.share->>'percentage') is not null
            and (s.share->>'weight')::numeric > 0

          union all

          select 3, jsonb_build_object(
            'id', 'mom_weight',
            'message',
              case
                when m.change > 0 then
                  v_material || ' volume increased '
                  || case
                    when m.percentage_change is not null
                      then m.percentage_change::text || '%'
                    else round(m.change, 3)::text || ' MT'
                  end
                  || ' compared with the previous month ('
                  || to_char(m.month_start, 'Mon YYYY')
                  || ').'
                when m.change < 0 then
                  v_material || ' volume decreased '
                  || case
                    when m.percentage_change is not null
                      then abs(m.percentage_change)::text || '%'
                    else abs(round(m.change, 3))::text || ' MT'
                  end
                  || ' compared with the previous month ('
                  || to_char(m.month_start, 'Mon YYYY')
                  || ').'
                else
                  v_material || ' volume was unchanged compared with the previous month ('
                  || to_char(m.month_start, 'Mon YYYY')
                  || ').'
              end
          )
          from (
            select
              month_start,
              weight,
              prev_weight,
              round(weight - prev_weight, 3) as change,
              case
                when prev_weight = 0 then null
                else round(((weight - prev_weight) / prev_weight) * 100, 1)
              end as percentage_change
            from insight_mom
          ) m
          where m.prev_weight is not null
            and (m.change <> 0 or m.weight > 0)

          union all

          select 4, jsonb_build_object(
            'id', 'streak_up',
            'message',
              v_material
              || ' transported weight has increased for '
              || s.streak_len::text
              || ' consecutive months.'
          )
          from insight_streak s
          where s.streak_len >= 3

          union all

          select 5, jsonb_build_object(
            'id', 'mix_shift',
            'message',
              m.focus_name
              || '''s share of '
              || v_material
              || ' in their material mix '
              || case
                when m.to_pct > m.from_pct then 'increased'
                else 'decreased'
              end
              || ' from '
              || m.from_pct::text
              || '% to '
              || m.to_pct::text
              || '% over the selected period.'
          )
          from insight_mix_shift m
          where abs(m.to_pct - m.from_pct) >= 5
        )
        select jsonb_agg(item order by ord)
        from built
      ),
      '[]'::jsonb
    ) as payload
  )
  select jsonb_build_object(
    'identity', jsonb_build_object('material', v_material),
    'window', jsonb_build_object(
      'key', v_window,
      'from', case
        when v_window = 'all' then (select first_lr_date from totals)
        else v_from
      end,
      'to', v_to,
      'observation_days', (select observation_days from observation)
    ),
    'overview', (select payload from overview),
    'top_consignees', (select payload from top_consignees),
    'weight_trend', (select payload from weight_trend),
    'consignee_trend', (select payload from consignee_trend),
    'focus_consignee', (select payload from focus_consignee_payload),
    'insights', (select payload from insights),
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
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_material_intelligence(text, text, text) from public;
grant execute on function public.get_material_intelligence(text, text, text) to authenticated;

comment on function public.get_material_intelligence(text, text, text) is
  'Material Intelligence V1: window-scoped loading_weight analytics by material (top consignees, trends, focus mix). Requires lr view. Read-only.';
