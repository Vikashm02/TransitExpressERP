-- ==========================================================
-- Migration: 059_staff_operations_intelligence_rpc
-- Module:    Staff Operations Intelligence
--
-- Adds a read-only staff activity, LR quality, completion, draft,
-- correction, editor, trend, insight, and field-audit reporting RPC.
-- NOT applied automatically -- review, then apply manually in Supabase.
--
-- Optional performance follow-up (not created here): consider an index on
-- public.lr_edit_events (edited_by, edited_at) after checking production
-- query plans and existing indexes.
-- ==========================================================

create or replace function public.get_staff_operations_intelligence(
  p_staff uuid,
  p_window text default '90',
  p_from date default null,
  p_to date default null,
  p_module text default 'lr'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_window text := lower(trim(coalesce(p_window, '90')));
  v_module text := lower(trim(coalesce(p_module, 'lr')));
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_from date;
  v_to date := (timezone('Asia/Kolkata', now()))::date;
  v_swap date;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_staff_name text;
  v_activity_modules jsonb := '[]'::jsonb;
  v_lr jsonb := 'null'::jsonb;
  v_field_corrections jsonb := '[]'::jsonb;
  v_editors jsonb := '[]'::jsonb;
  v_monthly jsonb := '[]'::jsonb;
  v_insights jsonb := '[]'::jsonb;
  v_audit_rows jsonb := '[]'::jsonb;
  v_created integer := 0;
  v_edit_events_by_staff integer := 0;
  v_unique_lrs_edited integer := 0;
  v_created_requiring_correction integer := 0;
  v_first_time_accuracy numeric;
  v_dashboard_quality_score numeric;
  v_completed integer := 0;
  v_avg_completion numeric;
  v_median_completion numeric;
  v_fastest_completion numeric;
  v_slowest_completion numeric;
  v_drafts_created integer := 0;
  v_pending_drafts integer := 0;
  v_pending_drafts_in_period integer := 0;
  v_final_created integer := 0;
  v_oldest_pending timestamptz;
  v_oldest_pending_age integer;
  v_draft_age_buckets jsonb := '{}'::jsonb;
  v_pending_draft_rows jsonb := '[]'::jsonb;
  v_top_field_label text;
  v_top_field_events integer;
  v_top_editor_name text;
  v_top_editor_events integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_is_admin := public.is_app_admin();

  if not (
    public.has_permission('reports', 'view')
    or v_is_admin
  ) then
    raise exception 'Not permitted to view staff operations intelligence';
  end if;

  if p_staff is null then
    raise exception 'Staff id is required';
  end if;

  if not v_is_admin and p_staff is distinct from v_uid then
    raise exception 'Staff may only view their own operations intelligence';
  end if;

  select nullif(trim(u.display_name), '')
  into v_staff_name
  from public.app_users u
  where u.id = p_staff;

  if not found then
    raise exception 'Staff user not found';
  end if;

  v_staff_name := coalesce(v_staff_name, p_staff::text);

  if v_window not in ('90', '180', '365', 'custom', 'all') then
    v_window := '90';
  end if;

  if v_module not in ('all', 'lr', 'pod', 'dc', 'asn') then
    v_module := 'lr';
  end if;

  if v_window = 'custom' then
    v_from := coalesce(p_from, coalesce(p_to, v_today) - 89);
    v_to := least(coalesce(p_to, v_today), v_today);

    if v_from > v_to then
      v_swap := v_from;
      v_from := v_to;
      v_to := v_swap;
    end if;
  elsif v_window = 'all' then
    select min(x.activity_date)
    into v_from
    from (
      select (timezone('Asia/Kolkata', l.created_at))::date as activity_date
      from public.lrs l
      where v_module in ('all', 'lr')
        and (l.created_by = p_staff or l.updated_by = p_staff)
      union all
      select (timezone('Asia/Kolkata', p.created_at))::date
      from public.pods p
      where v_module in ('all', 'pod')
        and (p.created_by = p_staff or p.updated_by = p_staff)
      union all
      select (timezone('Asia/Kolkata', d.created_at))::date
      from public.delivery_challans d
      where v_module in ('all', 'dc')
        and (d.created_by = p_staff or d.updated_by = p_staff)
      union all
      select (timezone('Asia/Kolkata', a.created_at))::date
      from public.asn_creations a
      where v_module in ('all', 'asn')
        and (a.created_by = p_staff or a.updated_by = p_staff)
      union all
      select (timezone('Asia/Kolkata', e.edited_at))::date
      from public.lr_edit_events e
      where v_module in ('all', 'lr')
        and (e.edited_by = p_staff or e.lr_created_by = p_staff)
    ) x;

    v_from := coalesce(v_from, v_today);
    v_to := v_today;
  else
    v_from := v_to - (v_window::integer - 1);
  end if;

  -- Inclusive local calendar dates represented as half-open timestamptz
  -- bounds. This keeps midnight behavior deterministic for India users.
  v_from_ts := v_from::timestamp at time zone 'Asia/Kolkata';
  v_to_ts := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  with module_rows as (
    select
      'lr'::text as module,
      'LR'::text as label,
      (
        select count(*)::integer
        from public.lrs l
        where l.created_by = p_staff
          and l.created_at >= v_from_ts
          and l.created_at < v_to_ts
      ) as created_count,
      (
        select count(*)::integer
        from public.lrs l
        where l.updated_by = p_staff
          and l.updated_at >= v_from_ts
          and l.updated_at < v_to_ts
          and l.updated_at > l.created_at
      ) as edited_count
    where v_module in ('all', 'lr')

    union all

    select
      'pod',
      'POD',
      (
        select count(*)::integer
        from public.pods p
        where p.created_by = p_staff
          and p.created_at >= v_from_ts
          and p.created_at < v_to_ts
      ),
      (
        select count(*)::integer
        from public.pods p
        where p.updated_by = p_staff
          and p.updated_at >= v_from_ts
          and p.updated_at < v_to_ts
          and p.updated_at > p.created_at
      )
    where v_module in ('all', 'pod')

    union all

    select
      'dc',
      'Delivery Challan',
      (
        select count(*)::integer
        from public.delivery_challans d
        where d.created_by = p_staff
          and d.created_at >= v_from_ts
          and d.created_at < v_to_ts
      ),
      (
        select count(*)::integer
        from public.delivery_challans d
        where d.updated_by = p_staff
          and d.updated_at >= v_from_ts
          and d.updated_at < v_to_ts
          and d.updated_at > d.created_at
      )
    where v_module in ('all', 'dc')

    union all

    select
      'asn',
      'ASN',
      (
        select count(*)::integer
        from public.asn_creations a
        where a.created_by = p_staff
          and a.created_at >= v_from_ts
          and a.created_at < v_to_ts
      ),
      (
        select count(*)::integer
        from public.asn_creations a
        where a.updated_by = p_staff
          and a.updated_at >= v_from_ts
          and a.updated_at < v_to_ts
          and a.updated_at > a.created_at
      )
    where v_module in ('all', 'asn')
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'module', m.module,
        'label', m.label,
        'created_count', m.created_count,
        'edited_count', m.edited_count
      )
      order by array_position(array['lr', 'pod', 'dc', 'asn'], m.module)
    ),
    '[]'::jsonb
  )
  into v_activity_modules
  from module_rows m;

  if v_module in ('all', 'lr') then
    select count(*)::integer
    into v_created
    from public.lrs l
    where l.created_by = p_staff
      and l.created_at >= v_from_ts
      and l.created_at < v_to_ts;

    select
      count(*)::integer,
      count(distinct e.lr_id)::integer
    into v_edit_events_by_staff, v_unique_lrs_edited
    from public.lr_edit_events e
    where e.edited_by = p_staff
      and e.edited_at >= v_from_ts
      and e.edited_at < v_to_ts;

    -- First-time accuracy is LR-based: one corrected LR counts once even
    -- if it has multiple events. Edits may happen after the creation window.
    select count(*)::integer
    into v_created_requiring_correction
    from public.lrs l
    where l.created_by = p_staff
      and l.created_at >= v_from_ts
      and l.created_at < v_to_ts
      and exists (
        select 1
        from public.lr_edit_events e
        where e.lr_id = l.id
      );

    if v_created > 0 then
      v_first_time_accuracy := round(
        ((v_created - v_created_requiring_correction)::numeric / v_created::numeric) * 100,
        1
      );

      -- Dashboard parity: intentionally event count / created LR count,
      -- matching migration 038. This is separate from first-time accuracy.
      v_dashboard_quality_score := greatest(
        0,
        round(
          100 - (
            (
              select count(*)::numeric
              from public.lr_edit_events e
              where e.lr_created_by = p_staff
                and exists (
                  select 1
                  from public.lrs l
                  where l.id = e.lr_id
                    and l.created_by = p_staff
                    and l.created_at >= v_from_ts
                    and l.created_at < v_to_ts
                )
            ) / v_created::numeric * 100
          ),
          2
        )
      );
    end if;

    select
      count(*)::integer,
      avg(extract(epoch from (l.finalized_at - l.created_at)))::numeric,
      percentile_cont(0.5) within group (
        order by extract(epoch from (l.finalized_at - l.created_at))
      )::numeric,
      min(extract(epoch from (l.finalized_at - l.created_at)))::numeric,
      max(extract(epoch from (l.finalized_at - l.created_at)))::numeric
    into
      v_completed,
      v_avg_completion,
      v_median_completion,
      v_fastest_completion,
      v_slowest_completion
    from public.lrs l
    where l.created_by = p_staff
      and l.created_at >= v_from_ts
      and l.created_at < v_to_ts
      and l.finalized_at is not null
      and coalesce(l.entry_status, 'final') = 'final';

    select
      count(*) filter (
        where coalesce(l.entry_status, 'final') = 'draft'
           or (
             l.finalized_at is not null
             and l.finalized_at > l.created_at + interval '1 second'
           )
      )::integer,
      count(*) filter (
        where coalesce(l.entry_status, 'final') = 'final'
      )::integer
    into v_drafts_created, v_final_created
    from public.lrs l
    where l.created_by = p_staff
      and l.created_at >= v_from_ts
      and l.created_at < v_to_ts;

    select
      count(*)::integer,
      count(*) filter (
        where l.created_at >= v_from_ts and l.created_at < v_to_ts
      )::integer,
      min(l.created_at)
    into v_pending_drafts, v_pending_drafts_in_period, v_oldest_pending
    from public.lrs l
    where l.created_by = p_staff
      and coalesce(l.entry_status, 'final') = 'draft';

    if v_oldest_pending is not null then
      v_oldest_pending_age := public._overview_age_days(v_oldest_pending);
    end if;

    select jsonb_build_object(
      'under_1_day', count(*) filter (where x.age_days < 1)::integer,
      'days_1_3', count(*) filter (where x.age_days between 1 and 3)::integer,
      'days_3_7', count(*) filter (where x.age_days > 3 and x.age_days <= 7)::integer,
      'days_7_30', count(*) filter (where x.age_days > 7 and x.age_days < 30)::integer,
      'days_30_plus', count(*) filter (where x.age_days >= 30)::integer
    )
    into v_draft_age_buckets
    from (
      select public._overview_age_days(l.created_at) as age_days
      from public.lrs l
      where l.created_by = p_staff
        and coalesce(l.entry_status, 'final') = 'draft'
    ) x;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'lr_number', d.lr_number,
          'created_at', d.created_at,
          'age_days', d.age_days
        )
        order by d.created_at
      ),
      '[]'::jsonb
    )
    into v_pending_draft_rows
    from (
      select
        l.id::text as id,
        l.lr_number,
        l.created_at,
        public._overview_age_days(l.created_at) as age_days
      from public.lrs l
      where l.created_by = p_staff
        and coalesce(l.entry_status, 'final') = 'draft'
      order by l.created_at
      limit 20
    ) d;

    -- All events on LRs created by the selected staff in the creation
    -- window are included, regardless of editor or later edit date.
    with corrections as (
      select
        e.lr_id,
        e.id as event_id,
        c.value ->> 'field_key' as field_key,
        c.value ->> 'field_label' as field_label
      from public.lr_edit_events e
      join public.lrs l on l.id = e.lr_id
      cross join lateral jsonb_array_elements(coalesce(e.changes, '[]'::jsonb)) c(value)
      where l.created_by = p_staff
        and l.created_at >= v_from_ts
        and l.created_at < v_to_ts
    ),
    ranked as (
      select
        c.field_key,
        coalesce(nullif(c.field_label, ''), c.field_key) as field_label,
        count(distinct c.event_id)::integer as edit_events,
        count(distinct c.lr_id)::integer as unique_lr_ids
      from corrections c
      where nullif(c.field_key, '') is not null
      group by c.field_key, coalesce(nullif(c.field_label, ''), c.field_key)
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'field_key', r.field_key,
          'field_label', r.field_label,
          'edit_events', r.edit_events,
          'unique_lr_ids', r.unique_lr_ids
        )
        order by r.edit_events desc, r.unique_lr_ids desc, r.field_key
      ),
      '[]'::jsonb
    )
    into v_field_corrections
    from ranked r;

    select
      x.field_label,
      x.edit_events
    into v_top_field_label, v_top_field_events
    from jsonb_to_recordset(v_field_corrections) as x(
      field_key text,
      field_label text,
      edit_events integer,
      unique_lr_ids integer
    )
    order by x.edit_events desc, x.field_key
    limit 1;

    with editor_totals as (
      select
        e.edited_by,
        coalesce(nullif(trim(u.display_name), ''), nullif(trim(u.email), ''), 'Unknown') as display_name,
        count(*)::integer as edit_events,
        count(distinct e.lr_id)::integer as unique_lrs
      from public.lr_edit_events e
      join public.lrs l on l.id = e.lr_id
      left join public.app_users u on u.id = e.edited_by
      where l.created_by = p_staff
        and l.created_at >= v_from_ts
        and l.created_at < v_to_ts
      group by e.edited_by, u.display_name, u.email
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'edited_by', et.edited_by,
          'display_name', et.display_name,
          'edit_events', et.edit_events,
          'unique_lrs', et.unique_lrs,
          'most_common_field', mc.field_label
        )
        order by et.edit_events desc, et.display_name
      ),
      '[]'::jsonb
    )
    into v_editors
    from editor_totals et
    left join lateral (
      select coalesce(nullif(c.value ->> 'field_label', ''), c.value ->> 'field_key') as field_label
      from public.lr_edit_events e2
      join public.lrs l2 on l2.id = e2.lr_id
      cross join lateral jsonb_array_elements(coalesce(e2.changes, '[]'::jsonb)) c(value)
      where e2.edited_by is not distinct from et.edited_by
        and l2.created_by = p_staff
        and l2.created_at >= v_from_ts
        and l2.created_at < v_to_ts
        and nullif(c.value ->> 'field_key', '') is not null
      group by c.value ->> 'field_key', c.value ->> 'field_label'
      order by count(*) desc, c.value ->> 'field_key'
      limit 1
    ) mc on true;

    select
      x.display_name,
      x.edit_events
    into v_top_editor_name, v_top_editor_events
    from jsonb_to_recordset(v_editors) as x(
      edited_by uuid,
      display_name text,
      edit_events integer,
      unique_lrs integer,
      most_common_field text
    )
    order by x.edit_events desc, x.display_name
    limit 1;

    with months as (
      select generate_series(
        date_trunc('month', v_from::timestamp),
        date_trunc('month', v_to::timestamp),
        interval '1 month'
      )::date as month_start
    ),
    month_stats as (
      select
        m.month_start,
        (m.month_start + interval '1 month')::date as next_month,
        (
          m.month_start::timestamp at time zone 'Asia/Kolkata'
        ) as month_start_ts,
        (
          (m.month_start + interval '1 month')::timestamp at time zone 'Asia/Kolkata'
        ) as next_month_ts
      from months m
    ),
    monthly_values as (
      select
        ms.month_start,
        (
          select count(*)::integer
          from public.lrs l
          where l.created_by = p_staff
            and l.created_at >= greatest(ms.month_start_ts, v_from_ts)
            and l.created_at < least(ms.next_month_ts, v_to_ts)
        ) as created,
        (
          select count(*)::integer
          from public.lr_edit_events e
          where e.edited_by = p_staff
            and e.edited_at >= greatest(ms.month_start_ts, v_from_ts)
            and e.edited_at < least(ms.next_month_ts, v_to_ts)
        ) as edit_events,
        (
          select count(distinct e.lr_id)::integer
          from public.lr_edit_events e
          where e.edited_by = p_staff
            and e.edited_at >= greatest(ms.month_start_ts, v_from_ts)
            and e.edited_at < least(ms.next_month_ts, v_to_ts)
        ) as unique_lrs_edited,
        (
          select count(*)::integer
          from public.lrs l
          where l.created_by = p_staff
            and l.created_at >= greatest(ms.month_start_ts, v_from_ts)
            and l.created_at < least(ms.next_month_ts, v_to_ts)
            and exists (
              select 1 from public.lr_edit_events e where e.lr_id = l.id
            )
        ) as created_requiring_correction,
        (
          select avg(extract(epoch from (l.finalized_at - l.created_at)))::numeric
          from public.lrs l
          where l.created_by = p_staff
            and l.created_at >= greatest(ms.month_start_ts, v_from_ts)
            and l.created_at < least(ms.next_month_ts, v_to_ts)
            and l.finalized_at is not null
            and coalesce(l.entry_status, 'final') = 'final'
        ) as avg_completion_seconds,
        (
          select count(*)::integer
          from public.lrs l
          where l.created_by = p_staff
            and l.created_at >= greatest(ms.month_start_ts, v_from_ts)
            and l.created_at < least(ms.next_month_ts, v_to_ts)
            and (
              coalesce(l.entry_status, 'final') = 'draft'
              or (
                l.finalized_at is not null
                and l.finalized_at > l.created_at + interval '1 second'
              )
            )
        ) as drafts_created
      from month_stats ms
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'month', mv.month_start,
          'created', mv.created,
          'edit_events', mv.edit_events,
          'unique_lrs_edited', mv.unique_lrs_edited,
          'created_lrs_requiring_correction', mv.created_requiring_correction,
          'first_time_accuracy_pct', case
            when mv.created = 0 then null
            else round(
              ((mv.created - mv.created_requiring_correction)::numeric / mv.created::numeric) * 100,
              1
            )
          end,
          'avg_completion_seconds', case
            when mv.avg_completion_seconds is null then null
            else round(mv.avg_completion_seconds, 1)
          end,
          'drafts_created', mv.drafts_created
        )
        order by mv.month_start
      ),
      '[]'::jsonb
    )
    into v_monthly
    from monthly_values mv;

    with candidate_insights as (
      select
        1 as priority,
        format(
          '%s of %s LRs were completed without a tracked correction (%s%% first-time accuracy).',
          v_created - v_created_requiring_correction,
          v_created,
          v_first_time_accuracy
        ) as message
      where v_created > 0

      union all

      select
        2,
        format(
          '%s finalized LRs averaged %s minutes from creation to finalization.',
          v_completed,
          round(v_avg_completion / 60, 1)
        )
      where v_completed > 0 and v_avg_completion is not null

      union all

      select
        3,
        format(
          '%s draft LRs remain open; the oldest is %s days old.',
          v_pending_drafts,
          coalesce(v_oldest_pending_age, 0)
        )
      where v_pending_drafts > 0

      union all

      select
        4,
        format(
          '%s was the most corrected field with %s edit events.',
          v_top_field_label,
          v_top_field_events
        )
      where v_top_field_label is not null

      union all

      select
        5,
        format(
          '%s made the most edits on this staff member''s LRs (%s events).',
          v_top_editor_name,
          v_top_editor_events
        )
      where v_top_editor_name is not null

      union all

      select
        6,
        format(
          '%s edit events by this staff member affected %s unique LRs during the period.',
          v_edit_events_by_staff,
          v_unique_lrs_edited
        )
      where v_edit_events_by_staff > 0
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', 'insight_' || ci.priority::text,
          'message', ci.message
        )
        order by ci.priority
      ),
      '[]'::jsonb
    )
    into v_insights
    from (
      select priority, message
      from candidate_insights
      order by priority
      limit 6
    ) ci;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event_id', a.event_id,
          'lr_id', a.lr_id,
          'lr_number', a.lr_number,
          'created_by', a.created_by,
          'created_by_name', a.created_by_name,
          'edited_by', a.edited_by,
          'edited_by_name', a.edited_by_name,
          'edited_at', a.edited_at,
          'field_key', a.field_key,
          'field_label', a.field_label,
          'old_value', a.old_value,
          'new_value', a.new_value
        )
        order by a.edited_at desc, a.event_id desc, a.field_key nulls last
      ),
      '[]'::jsonb
    )
    into v_audit_rows
    from (
      select
        e.id as event_id,
        l.id::text as lr_id,
        l.lr_number,
        l.created_by,
        coalesce(nullif(trim(cu.display_name), ''), nullif(trim(cu.email), ''), 'Unknown') as created_by_name,
        e.edited_by,
        coalesce(nullif(trim(eu.display_name), ''), nullif(trim(eu.email), ''), 'Unknown') as edited_by_name,
        e.edited_at,
        ch.value ->> 'field_key' as field_key,
        ch.value ->> 'field_label' as field_label,
        ch.value ->> 'old_value' as old_value,
        ch.value ->> 'new_value' as new_value
      from public.lr_edit_events e
      join public.lrs l on l.id = e.lr_id
      left join public.app_users cu on cu.id = l.created_by
      left join public.app_users eu on eu.id = e.edited_by
      left join lateral jsonb_array_elements(coalesce(e.changes, '[]'::jsonb)) ch(value) on true
      where (l.created_by = p_staff or e.edited_by = p_staff)
        and e.edited_at >= v_from_ts
        and e.edited_at < v_to_ts
      order by e.edited_at desc, e.id desc
      limit 50
    ) a;

    v_lr := jsonb_build_object(
      'summary', jsonb_build_object(
        'created_count', v_created,
        'edit_events_by_staff', v_edit_events_by_staff,
        'unique_lrs_edited_by_staff', v_unique_lrs_edited,
        'created_lrs_requiring_correction', v_created_requiring_correction,
        'first_time_accuracy_pct', v_first_time_accuracy,
        'dashboard_quality_score', v_dashboard_quality_score,
        'completed_count', v_completed,
        'avg_completion_seconds', case
          when v_avg_completion is null then null
          else round(v_avg_completion, 1)
        end,
        'median_completion_seconds', case
          when v_median_completion is null then null
          else round(v_median_completion, 1)
        end,
        'fastest_seconds', case
          when v_fastest_completion is null then null
          else round(v_fastest_completion, 1)
        end,
        'slowest_seconds', case
          when v_slowest_completion is null then null
          else round(v_slowest_completion, 1)
        end
      ),
      'drafts', jsonb_build_object(
        'drafts_created', v_drafts_created,
        'pending_drafts', v_pending_drafts,
        'pending_drafts_in_period', v_pending_drafts_in_period,
        'oldest_pending_draft_at', v_oldest_pending,
        'oldest_pending_age_days', v_oldest_pending_age,
        'draft_completion_rate_pct', case
          when v_created = 0 then null
          else round((v_final_created::numeric / v_created::numeric) * 100, 1)
        end,
        'draft_age_buckets', coalesce(v_draft_age_buckets, '{}'::jsonb),
        'pending_draft_rows', coalesce(v_pending_draft_rows, '[]'::jsonb),
        'approximation_note',
          'drafts_created approximates draft-path LRs as current drafts or rows finalized more than one second after creation'
      ),
      'field_corrections', coalesce(v_field_corrections, '[]'::jsonb),
      'editors', coalesce(v_editors, '[]'::jsonb),
      'monthly', coalesce(v_monthly, '[]'::jsonb),
      'insights', coalesce(v_insights, '[]'::jsonb),
      'audit_rows', coalesce(v_audit_rows, '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'staff', jsonb_build_object(
      'id', p_staff,
      'display_name', v_staff_name
    ),
    'window', jsonb_build_object(
      'key', v_window,
      'from', v_from,
      'to', v_to,
      'timezone', 'Asia/Kolkata'
    ),
    'module', v_module,
    'activity_modules', coalesce(v_activity_modules, '[]'::jsonb),
    'lr', v_lr
  );
end;
$$;

revoke all on function public.get_staff_operations_intelligence(uuid, text, date, date, text)
  from public;
revoke all on function public.get_staff_operations_intelligence(uuid, text, date, date, text)
  from anon;
grant execute on function public.get_staff_operations_intelligence(uuid, text, date, date, text)
  to authenticated;

comment on function public.get_staff_operations_intelligence(uuid, text, date, date, text) is
  'Read-only Staff Operations Intelligence. Reports permission required; non-admin callers may view only themselves. LR first-time accuracy uses unique corrected LRs while dashboard_quality_score preserves migration 038 event-count semantics.';
