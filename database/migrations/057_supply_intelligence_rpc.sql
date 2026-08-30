-- ==========================================================
-- Migration: 057_supply_intelligence_rpc
-- Module:    Transjit ERP Supply Intelligence reporting
--
-- Adds a read-only, window-scoped reporting RPC over public.lrs.
-- Canonical dimensions:
--   Material  -> coalesce(nullif(trim(material), ''), 'Unknown')
--   Consignee -> coalesce(nullif(trim(consignee), ''), 'Unknown')
--   Weight    -> coalesce(loading_weight, 0)::numeric
--
-- Migration 055/056 Material Intelligence and the existing
-- Consignee Intelligence migrations/functions are NOT modified.
--
-- NOT applied automatically -- review, then apply manually in Supabase.
-- ==========================================================

create or replace function public.get_supply_intelligence(
  p_window text default '90',
  p_from date default null,
  p_to date default null,
  p_material text default null,
  p_consignee text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_window text := lower(trim(coalesce(p_window, '90')));
  v_material text := trim(coalesce(p_material, ''));
  v_consignee text := trim(coalesce(p_consignee, ''));
  v_from date;
  v_to date := current_date;
  v_observation_days integer;
  v_swap date;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    public.has_permission('reports', 'view')
    or public.has_permission('lr', 'view')
  ) then
    raise exception 'Not permitted to view supply intelligence';
  end if;

  if v_window not in ('90', '180', '365', 'custom') then
    v_window := '90';
  end if;

  if v_window = 'custom' then
    v_from := p_from;
    v_to := least(coalesce(p_to, current_date), current_date);

    if v_from is null then
      v_from := v_to - 89;
    end if;

    if v_from > v_to then
      v_swap := v_from;
      v_from := v_to;
      v_to := v_swap;
    end if;

    v_observation_days := (v_to - v_from) + 1;
  else
    v_from := v_to - (v_window::integer - 1);
    v_observation_days := v_window::integer;
  end if;

  with
  -- All qualifying LRs in the period. Deliberately unfiltered by the
  -- optional dimensions so filter options do not collapse.
  base_period as (
    select
      l.id::text as id,
      l.lr_number,
      l.lr_date,
      trim(l.material) as material_raw,
      trim(l.consignee) as consignee_raw,
      coalesce(nullif(trim(l.material), ''), 'Unknown') as material,
      coalesce(nullif(trim(l.consignee), ''), 'Unknown') as consignee,
      coalesce(l.loading_weight, 0)::numeric as loading_weight
    from public.lrs l
    where coalesce(l.entry_status, 'final') = 'final'
      and l.status is distinct from 'Cancelled'
      and l.lr_date >= v_from
      and l.lr_date <= v_to
  ),
  -- Analytics source after applying the optional dimensions.
  -- Match against canonical display names (same as filter_options).
  base as (
    select
      bp.id,
      bp.lr_number,
      bp.lr_date,
      bp.material,
      bp.consignee,
      bp.loading_weight
    from base_period bp
    where (v_material = '' or bp.material = v_material)
      and (v_consignee = '' or bp.consignee = v_consignee)
  ),
  totals as (
    select
      count(*)::integer as lr_count,
      coalesce(sum(loading_weight), 0)::numeric as total_weight,
      count(distinct consignee)::integer as unique_consignees,
      count(distinct material)::integer as unique_materials,
      min(lr_date) as first_lr_date,
      max(lr_date) as last_lr_date
    from base
  ),
  consignee_aggregates as (
    select
      consignee,
      sum(loading_weight)::numeric as weight,
      count(*)::integer as lr_count
    from base
    group by consignee
  ),
  material_aggregates as (
    select
      material,
      sum(loading_weight)::numeric as weight,
      count(*)::integer as lr_count,
      count(distinct consignee)::integer as unique_consignees
    from base
    group by material
  ),
  overview as (
    select jsonb_build_object(
      'total_weight', round(t.total_weight, 3),
      'lr_count', t.lr_count,
      'unique_consignees', t.unique_consignees,
      'unique_materials', t.unique_materials,
      'avg_weight_per_lr', case
        when t.lr_count > 0 then round(t.total_weight / t.lr_count, 3)
        else null
      end,
      'top_consignee', (
        select jsonb_build_object(
          'name', ca.consignee,
          'weight', round(ca.weight, 3)
        )
        from consignee_aggregates ca
        order by ca.weight desc, ca.consignee
        limit 1
      ),
      'top_material', (
        select jsonb_build_object(
          'name', ma.material,
          'weight', round(ma.weight, 3)
        )
        from material_aggregates ma
        order by ma.weight desc, ma.material
        limit 1
      ),
      'period_from', v_from,
      'period_to', v_to
    ) as payload
    from totals t
  ),
  filter_options as (
    select jsonb_build_object(
      'materials', coalesce(
        (
          select jsonb_agg(x.material order by x.material)
          from (
            select distinct bp.material
            from base_period bp
          ) x
        ),
        '[]'::jsonb
      ),
      'consignees', coalesce(
        (
          select jsonb_agg(x.consignee order by x.consignee)
          from (
            select distinct bp.consignee
            from base_period bp
          ) x
        ),
        '[]'::jsonb
      )
    ) as payload
  ),
  ranked_consignees as (
    select
      ca.consignee,
      ca.weight,
      ca.lr_count,
      case
        when ca.lr_count > 0 then ca.weight / ca.lr_count
        else null
      end as avg_weight_per_lr,
      row_number() over (
        order by ca.weight desc, ca.consignee
      ) as rn
    from consignee_aggregates ca
  ),
  consignee_material_weights as (
    select
      b.consignee,
      b.material,
      sum(b.loading_weight)::numeric as weight,
      row_number() over (
        partition by b.consignee
        order by sum(b.loading_weight) desc, b.material
      ) as rn
    from base b
    group by b.consignee, b.material
  ),
  consignee_top_material as (
    select
      cmw.consignee,
      cmw.material
    from consignee_material_weights cmw
    where cmw.rn = 1
  ),
  top_consignee_items as (
    select
      rc.rn as rank,
      rc.consignee,
      rc.weight,
      rc.lr_count,
      rc.avg_weight_per_lr,
      ctm.material as top_material
    from ranked_consignees rc
    left join consignee_top_material ctm
      on ctm.consignee = rc.consignee
    where rc.rn <= 15
  ),
  other_consignees as (
    select
      coalesce(sum(rc.weight), 0)::numeric as weight,
      coalesce(sum(rc.lr_count), 0)::integer as lr_count,
      count(*)::integer as consignee_count
    from ranked_consignees rc
    where rc.rn > 15
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
              'lr_count', i.lr_count,
              'avg_weight_per_lr', case
                when i.avg_weight_per_lr is not null
                  then round(i.avg_weight_per_lr, 3)
                else null
              end,
              'top_material', i.top_material
            )
            order by i.rank
          )
          from top_consignee_items i
          cross join totals t
        ),
        '[]'::jsonb
      ),
      'other', case
        when o.consignee_count > 0 then jsonb_build_object(
          'weight', round(o.weight, 3),
          'percentage', case
            when t.total_weight > 0
              then round((o.weight / t.total_weight) * 100, 1)
            else 0
          end,
          'lr_count', o.lr_count,
          'consignee_count', o.consignee_count
        )
        else null
      end
    ) as payload
    from totals t
    cross join other_consignees o
  ),
  ranked_materials as (
    select
      ma.material,
      ma.weight,
      ma.lr_count,
      ma.unique_consignees,
      case
        when ma.lr_count > 0 then ma.weight / ma.lr_count
        else null
      end as avg_weight_per_lr,
      row_number() over (
        order by ma.weight desc, ma.material
      ) as rn
    from material_aggregates ma
  ),
  top_material_items as (
    select *
    from ranked_materials
    where rn <= 15
  ),
  other_materials as (
    select
      coalesce(sum(rm.weight), 0)::numeric as weight,
      coalesce(sum(rm.lr_count), 0)::integer as lr_count,
      count(*)::integer as material_count
    from ranked_materials rm
    where rm.rn > 15
  ),
  top_materials as (
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'rank', i.rn,
              'material', i.material,
              'weight', round(i.weight, 3),
              'percentage', case
                when t.total_weight > 0
                  then round((i.weight / t.total_weight) * 100, 1)
                else 0
              end,
              'lr_count', i.lr_count,
              'avg_weight_per_lr', case
                when i.avg_weight_per_lr is not null
                  then round(i.avg_weight_per_lr, 3)
                else null
              end,
              'unique_consignees', i.unique_consignees
            )
            order by i.rn
          )
          from top_material_items i
          cross join totals t
        ),
        '[]'::jsonb
      ),
      'other', case
        when o.material_count > 0 then jsonb_build_object(
          'weight', round(o.weight, 3),
          'percentage', case
            when t.total_weight > 0
              then round((o.weight / t.total_weight) * 100, 1)
            else 0
          end,
          'lr_count', o.lr_count,
          'material_count', o.material_count
        )
        else null
      end
    ) as payload
    from totals t
    cross join other_materials o
  ),
  portfolio_rollup as (
    select
      case when rm.rn <= 5 then rm.material else 'Other' end as material,
      sum(rm.weight)::numeric as weight,
      sum(rm.lr_count)::integer as trip_count,
      min(case when rm.rn <= 5 then rm.rn else 6 end) as sort_key
    from ranked_materials rm
    group by case when rm.rn <= 5 then rm.material else 'Other' end
  ),
  material_portfolio as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'material', pr.material,
            'weight', round(pr.weight, 3),
            'percentage', case
              when t.total_weight > 0
                then round((pr.weight / t.total_weight) * 100, 1)
              else 0
            end,
            'trip_count', pr.trip_count
          )
          order by pr.sort_key, pr.material
        )
        from portfolio_rollup pr
        cross join totals t
      ),
      '[]'::jsonb
    ) as payload
  ),
  calendar_months as (
    select gs::date as month_start
    from generate_series(
      date_trunc('month', v_from)::date,
      date_trunc('month', v_to)::date,
      interval '1 month'
    ) gs
  ),
  monthly_weight_activity as (
    select
      date_trunc('month', b.lr_date)::date as month_start,
      sum(b.loading_weight)::numeric as weight,
      count(*)::integer as lr_count
    from base b
    group by 1
  ),
  monthly_weight_totals as (
    select
      cm.month_start,
      coalesce(mwa.weight, 0)::numeric as weight,
      coalesce(mwa.lr_count, 0)::integer as lr_count
    from calendar_months cm
    left join monthly_weight_activity mwa
      on mwa.month_start = cm.month_start
  ),
  weight_trend_months as (
    select
      mwt.month_start,
      mwt.weight,
      mwt.lr_count,
      lag(mwt.weight) over (order by mwt.month_start) as prev_weight
    from monthly_weight_totals mwt
  ),
  weight_trend as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'month', to_char(wtm.month_start, 'YYYY-MM'),
            'weight', round(wtm.weight, 3),
            'lr_count', wtm.lr_count,
            'change', case
              when wtm.prev_weight is null then null
              else round(wtm.weight - wtm.prev_weight, 3)
            end,
            'percentage_change', case
              when wtm.prev_weight is null or wtm.prev_weight = 0 then null
              else round(
                ((wtm.weight - wtm.prev_weight) / wtm.prev_weight) * 100,
                1
              )
            end,
            'comparison_available',
              wtm.prev_weight is not null
          )
          order by wtm.month_start
        )
        from weight_trend_months wtm
      ),
      '[]'::jsonb
    ) as payload
  ),
  -- Consignee detail uses the already-filtered base and only exists when
  -- an explicit consignee filter was supplied.
  detail_ranked_materials as (
    select
      b.material,
      sum(b.loading_weight)::numeric as weight,
      count(*)::integer as trip_count,
      row_number() over (
        order by sum(b.loading_weight) desc, b.material
      ) as rn
    from base b
    group by b.material
  ),
  detail_material_rollup as (
    select
      case when drm.rn <= 5 then drm.material else 'Other' end as material,
      sum(drm.weight)::numeric as weight,
      sum(drm.trip_count)::integer as trip_count,
      min(case when drm.rn <= 5 then drm.rn else 6 end) as sort_key
    from detail_ranked_materials drm
    group by case when drm.rn <= 5 then drm.material else 'Other' end
  ),
  detail_material_mix as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'material', dmr.material,
            'weight', round(dmr.weight, 3),
            'percentage', case
              when t.total_weight > 0
                then round((dmr.weight / t.total_weight) * 100, 1)
              else 0
            end,
            'trip_count', dmr.trip_count
          )
          order by dmr.sort_key, dmr.material
        )
        from detail_material_rollup dmr
        cross join totals t
      ),
      '[]'::jsonb
    ) as payload
  ),
  detail_preference as (
    select jsonb_build_object(
      'top_material', (select material from detail_ranked_materials where rn = 1),
      'top_share', (
        select case
          when t.total_weight > 0 then round((drm.weight / t.total_weight) * 100, 1)
          else 0
        end
        from detail_ranked_materials drm
        cross join totals t
        where drm.rn = 1
      ),
      'second_material', (select material from detail_ranked_materials where rn = 2),
      'second_share', (
        select case
          when t.total_weight > 0 then round((drm.weight / t.total_weight) * 100, 1)
          else 0
        end
        from detail_ranked_materials drm
        cross join totals t
        where drm.rn = 2
      ),
      'distinct_materials', (select count(*)::integer from detail_ranked_materials)
    ) as payload
  ),
  detail_top5_materials as (
    select material
    from detail_ranked_materials
    where rn <= 5
  ),
  detail_monthly_material_raw as (
    select
      date_trunc('month', b.lr_date)::date as month_start,
      case
        when exists (
          select 1
          from detail_top5_materials dtm
          where dtm.material = b.material
        ) then b.material
        else 'Other'
      end as material,
      sum(b.loading_weight)::numeric as weight
    from base b
    group by 1, 2
  ),
  detail_month_totals as (
    select
      cm.month_start,
      coalesce(sum(dmmr.weight), 0)::numeric as total_weight
    from calendar_months cm
    left join detail_monthly_material_raw dmmr
      on dmmr.month_start = cm.month_start
    group by cm.month_start
  ),
  detail_share_trend as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'month', to_char(dmt.month_start, 'YYYY-MM'),
            'total_weight', round(dmt.total_weight, 3),
            'shares', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'material', x.material,
                    'weight', round(x.weight, 3),
                    'percentage', case
                      when dmt.total_weight > 0
                        then round((x.weight / dmt.total_weight) * 100, 1)
                      else 0
                    end
                  )
                  order by
                    case when x.material = 'Other' then 1 else 0 end,
                    x.weight desc,
                    x.material
                )
                from detail_monthly_material_raw x
                where x.month_start = dmt.month_start
              ),
              '[]'::jsonb
            )
          )
          order by dmt.month_start
        )
        from detail_month_totals dmt
      ),
      '[]'::jsonb
    ) as payload
  ),
  detail_absolute_trend as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'month', to_char(dmt.month_start, 'YYYY-MM'),
            'total_weight', round(dmt.total_weight, 3),
            'materials', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'material', x.material,
                    'weight', round(x.weight, 3)
                  )
                  order by
                    case when x.material = 'Other' then 1 else 0 end,
                    x.weight desc,
                    x.material
                )
                from detail_monthly_material_raw x
                where x.month_start = dmt.month_start
              ),
              '[]'::jsonb
            )
          )
          order by dmt.month_start
        )
        from detail_month_totals dmt
      ),
      '[]'::jsonb
    ) as payload
  ),
  latest_mom as (
    select jsonb_build_object(
      'month', to_char(wtm.month_start, 'YYYY-MM'),
      'weight', round(wtm.weight, 3),
      'change', case
        when wtm.prev_weight is null then null
        else round(wtm.weight - wtm.prev_weight, 3)
      end,
      'percentage_change', case
        when wtm.prev_weight is null or wtm.prev_weight = 0 then null
        else round(
          ((wtm.weight - wtm.prev_weight) / wtm.prev_weight) * 100,
          1
        )
      end,
      'comparison_available',
        wtm.prev_weight is not null
    ) as payload
    from weight_trend_months wtm
    order by wtm.month_start desc
    limit 1
  ),
  consignee_detail as (
    select case
      when v_consignee = '' then null
      else jsonb_build_object(
        'name', v_consignee,
        'material_mix', (select payload from detail_material_mix),
        'preference', (select payload from detail_preference),
        'share_trend', (select payload from detail_share_trend),
        'absolute_trend', (select payload from detail_absolute_trend),
        'mom', (select payload from latest_mom),
        'concentration', null
      )
    end as payload
  ),
  -- Material detail: distribution and concentration across the
  -- consignees remaining in the filtered base.
  material_ranked_consignees as (
    select
      b.consignee,
      sum(b.loading_weight)::numeric as weight,
      count(*)::integer as lr_count,
      row_number() over (
        order by sum(b.loading_weight) desc, b.consignee
      ) as rn
    from base b
    group by b.consignee
  ),
  material_other_consignees as (
    select
      coalesce(sum(mrc.weight), 0)::numeric as weight,
      coalesce(sum(mrc.lr_count), 0)::integer as lr_count,
      count(*)::integer as consignee_count
    from material_ranked_consignees mrc
    where mrc.rn > 10
  ),
  material_consignee_distribution as (
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'rank', mrc.rn,
              'consignee', mrc.consignee,
              'weight', round(mrc.weight, 3),
              'percentage', case
                when t.total_weight > 0
                  then round((mrc.weight / t.total_weight) * 100, 1)
                else 0
              end,
              'lr_count', mrc.lr_count
            )
            order by mrc.rn
          )
          from material_ranked_consignees mrc
          cross join totals t
          where mrc.rn <= 10
        ),
        '[]'::jsonb
      ),
      'other', case
        when o.consignee_count > 0 then jsonb_build_object(
          'rank', 11,
          'consignee', 'Other',
          'weight', round(o.weight, 3),
          'percentage', case
            when t.total_weight > 0
              then round((o.weight / t.total_weight) * 100, 1)
            else 0
          end,
          'lr_count', o.lr_count,
          'consignee_count', o.consignee_count
        )
        else null
      end
    ) as payload
    from material_other_consignees o
    cross join totals t
  ),
  material_concentration as (
    select jsonb_build_object(
      'top_consignee', (select consignee from material_ranked_consignees where rn = 1),
      'top_weight', (
        select round(weight, 3)
        from material_ranked_consignees
        where rn = 1
      ),
      'top_share', (
        select case
          when t.total_weight > 0 then round((mrc.weight / t.total_weight) * 100, 1)
          else 0
        end
        from material_ranked_consignees mrc
        cross join totals t
        where mrc.rn = 1
      ),
      'top3_share', (
        select case
          when t.total_weight > 0
            then round((s.weight / t.total_weight) * 100, 1)
          else 0
        end
        from totals t
        cross join lateral (
          select coalesce(sum(mrc.weight), 0)::numeric as weight
          from material_ranked_consignees mrc
          where mrc.rn <= 3
        ) s
      ),
      'top5_share', (
        select case
          when t.total_weight > 0
            then round((s.weight / t.total_weight) * 100, 1)
          else 0
        end
        from totals t
        cross join lateral (
          select coalesce(sum(mrc.weight), 0)::numeric as weight
          from material_ranked_consignees mrc
          where mrc.rn <= 5
        ) s
      ),
      'consignee_count', (select count(*)::integer from material_ranked_consignees)
    ) as payload
  ),
  material_top5_consignees as (
    select consignee
    from material_ranked_consignees
    where rn <= 5
  ),
  material_monthly_consignee_raw as (
    select
      date_trunc('month', b.lr_date)::date as month_start,
      case
        when exists (
          select 1
          from material_top5_consignees mtc
          where mtc.consignee = b.consignee
        ) then b.consignee
        else 'Other'
      end as consignee,
      sum(b.loading_weight)::numeric as weight
    from base b
    group by 1, 2
  ),
  material_month_totals as (
    select
      cm.month_start,
      coalesce(sum(mmcr.weight), 0)::numeric as total_weight
    from calendar_months cm
    left join material_monthly_consignee_raw mmcr
      on mmcr.month_start = cm.month_start
    group by cm.month_start
  ),
  material_consignee_trend as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'month', to_char(mmt.month_start, 'YYYY-MM'),
            'total_weight', round(mmt.total_weight, 3),
            'shares', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'consignee', x.consignee,
                    'weight', round(x.weight, 3),
                    'percentage', case
                      when mmt.total_weight > 0
                        then round((x.weight / mmt.total_weight) * 100, 1)
                      else 0
                    end
                  )
                  order by
                    case when x.consignee = 'Other' then 1 else 0 end,
                    x.weight desc,
                    x.consignee
                )
                from material_monthly_consignee_raw x
                where x.month_start = mmt.month_start
              ),
              '[]'::jsonb
            )
          )
          order by mmt.month_start
        )
        from material_month_totals mmt
      ),
      '[]'::jsonb
    ) as payload
  ),
  material_detail as (
    select case
      when v_material = '' then null
      else jsonb_build_object(
        'name', v_material,
        'consignee_distribution', (select payload from material_consignee_distribution),
        'concentration', (select payload from material_concentration),
        'weight_trend', (select payload from weight_trend),
        'consignee_trend', (select payload from material_consignee_trend)
      )
    end as payload
  ),
  increase_markers as (
    select
      wtm.month_start,
      case
        when wtm.prev_weight is not null and wtm.weight > wtm.prev_weight then 1
        else 0
      end as is_increase
    from weight_trend_months wtm
  ),
  increase_groups as (
    select
      im.*,
      sum(case when im.is_increase = 0 then 1 else 0 end)
        over (order by im.month_start) as grp
    from increase_markers im
  ),
  longest_increase_streak as (
    select coalesce(max(x.streak_len), 0)::integer as streak_len
    from (
      select count(*)::integer as streak_len
      from increase_groups ig
      where ig.is_increase = 1
      group by ig.grp
    ) x
  ),
  insights as (
    select coalesce(
      (
        with built as (
          select 1 as ord, jsonb_build_object(
            'id', 'top_consignee',
            'message',
              rc.consignee || ' was the top consignee by weight at '
              || round(rc.weight, 3)::text || ' MT ('
              || case
                   when t.total_weight > 0
                     then round((rc.weight / t.total_weight) * 100, 1)::text
                   else '0'
                 end
              || '%).'
          ) as item
          from ranked_consignees rc
          cross join totals t
          where rc.rn = 1

          union all

          select 2, jsonb_build_object(
            'id', 'top_material',
            'message',
              rm.material || ' was the top material by weight at '
              || round(rm.weight, 3)::text || ' MT ('
              || case
                   when t.total_weight > 0
                     then round((rm.weight / t.total_weight) * 100, 1)::text
                   else '0'
                 end
              || '%).'
          )
          from ranked_materials rm
          cross join totals t
          where rm.rn = 1

          union all

          select 3, jsonb_build_object(
            'id', 'consignee_mix',
            'message',
              v_consignee || '''s top material was ' || drm.material
              || ' at '
              || case
                   when t.total_weight > 0
                     then round((drm.weight / t.total_weight) * 100, 1)::text
                   else '0'
                 end
              || '% of filtered weight.'
          )
          from detail_ranked_materials drm
          cross join totals t
          where v_consignee <> ''
            and drm.rn = 1

          union all

          select 4, jsonb_build_object(
            'id', 'material_top_consignee',
            'message',
              mrc.consignee || ' accounted for '
              || case
                   when t.total_weight > 0
                     then round((mrc.weight / t.total_weight) * 100, 1)::text
                   else '0'
                 end
              || '% of ' || v_material || ' weight.'
          )
          from material_ranked_consignees mrc
          cross join totals t
          where v_material <> ''
            and mrc.rn = 1

          union all

          select 5, jsonb_build_object(
            'id', 'mom_weight',
            'message',
              'Weight '
              || case
                   when wtm.weight > wtm.prev_weight then 'increased'
                   else 'decreased'
                 end
              || ' by '
              || case
                   when wtm.prev_weight <> 0
                     then abs(round(
                       ((wtm.weight - wtm.prev_weight) / wtm.prev_weight) * 100,
                       1
                     ))::text || '%'
                   else abs(round(wtm.weight - wtm.prev_weight, 3))::text || ' MT'
                 end
              || ' in ' || to_char(wtm.month_start, 'Mon YYYY')
              || ' versus the previous month.'
          )
          from weight_trend_months wtm
          where wtm.prev_weight is not null
            and wtm.weight <> wtm.prev_weight
            and wtm.month_start = (
              select max(latest.month_start)
              from weight_trend_months latest
              where latest.prev_weight is not null
            )

          union all

          select 6, jsonb_build_object(
            'id', 'increase_streak',
            'message',
              'Weight increased for ' || lis.streak_len::text
              || ' consecutive months.'
          )
          from longest_increase_streak lis
          where lis.streak_len >= 3

          union all

          select 7, jsonb_build_object(
            'id', 'material_concentration',
            'message',
              (mc.payload->>'top_consignee') || ' represented '
              || (mc.payload->>'top_share') || '% of '
              || v_material || ' weight, indicating high concentration.'
          )
          from material_concentration mc
          where v_material <> ''
            and coalesce((mc.payload->>'top_share')::numeric, 0) >= 40
        )
        select jsonb_agg(y.item order by y.ord)
        from (
          select b.ord, b.item
          from built b
          order by b.ord
        ) y
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
            'consignee', x.consignee,
            'material', x.material,
            'loading_weight', round(x.loading_weight, 3)
          )
          order by x.lr_date desc, x.id desc
        )
        from (
          select b.*
          from base b
          order by b.lr_date desc, b.id desc
          limit 20
        ) x
      ),
      '[]'::jsonb
    ) as payload
  )
  select jsonb_build_object(
    'window', jsonb_build_object(
      'key', v_window,
      'from', v_from,
      'to', v_to,
      'observation_days', v_observation_days
    ),
    'filters', jsonb_build_object(
      'material', v_material,
      'consignee', v_consignee
    ),
    'overview', (select payload from overview),
    'filter_options', (select payload from filter_options),
    'top_consignees', (select payload from top_consignees),
    'top_materials', (select payload from top_materials),
    'material_portfolio', (select payload from material_portfolio),
    'weight_trend', (select payload from weight_trend),
    'consignee_detail', (select payload from consignee_detail),
    'material_detail', (select payload from material_detail),
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

revoke all on function public.get_supply_intelligence(text, date, date, text, text) from public;
grant execute on function public.get_supply_intelligence(text, date, date, text, text) to authenticated;

comment on function public.get_supply_intelligence(text, date, date, text, text) is
  'Supply Intelligence (057): read-only window-scoped loading_weight analytics across materials and consignees. Requires reports view or lr view permission.';
