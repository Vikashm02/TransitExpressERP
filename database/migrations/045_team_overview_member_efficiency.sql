-- ==========================================================
-- Migration: 045_team_overview_member_efficiency.sql
-- Module:    Team Overview — per-member Avg Completion + LR Quality
-- ==========================================================
-- Extends get_team_overview_snapshot member rows with the SAME
-- completion / quality definitions as personal get_overview_snapshot
-- (migration 038). No new tables/columns. Self Performance unchanged.
-- ==========================================================

create or replace function public.get_team_overview_snapshot(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_scope text;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_can_lr boolean;
  v_can_pod boolean;
  v_can_dc boolean;
  v_can_asn boolean;
  v_member_ids uuid[];
  v_summary jsonb;
  v_period jsonb;
  v_open jsonb;
  v_members jsonb := '[]'::jsonb;
  v_trends jsonb := '[]'::jsonb;
  v_lrs_created integer := 0;
  v_lrs_updated integer := 0;
  v_pods_created integer := 0;
  v_dcs_created integer := 0;
  v_asns_created integer := 0;
  v_draft_count integer := 0;
  v_pending_pod integer := 0;
  v_completed_count integer := 0;
  v_team_members integer := 0;
  v_tier1_count integer := 0;
  v_tier2_count integer := 0;
  v_active_approved integer := 0;
  v_pending_approval integer := 0;
  v_locked integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_role := public.current_app_user_role();

  if v_role is null or v_role = 'staff' then
    raise exception 'Team overview is available to Creator and Tier 1 only';
  end if;

  if v_role not in ('creator', 'admin') then
    raise exception 'Team overview is available to Creator and Tier 1 only';
  end if;

  if p_from is null or p_to is null then
    raise exception 'From and to dates are required';
  end if;

  if p_to < p_from then
    raise exception 'To date must be on or after from date';
  end if;

  v_scope := case when v_role = 'creator' then 'organization' else 'assigned_team' end;
  v_from_ts := p_from::timestamp;
  v_to_ts := (p_to + 1)::timestamp;

  -- Creator / Tier 1 retain admin module bypass via has_permission.
  v_can_lr := public.has_permission('lr', 'view');
  v_can_pod := public.has_permission('pod', 'view');
  v_can_dc := public.has_permission('delivery_challans', 'view');
  v_can_asn := public.has_permission('asn_creations', 'view');

  select coalesce(array_agg(m.member_id), array[]::uuid[])
  into v_member_ids
  from public.team_dashboard_member_ids() m;

  -- Roster summary (scoped members only).
  select
    count(*)::integer,
    count(*) filter (where u.role = 'admin')::integer,
    count(*) filter (where u.role = 'staff')::integer,
    count(*) filter (
      where u.approval_status = 'approved' and not coalesce(u.is_locked, false)
    )::integer,
    count(*) filter (where u.approval_status = 'pending')::integer,
    count(*) filter (where coalesce(u.is_locked, false))::integer
  into
    v_team_members,
    v_tier1_count,
    v_tier2_count,
    v_active_approved,
    v_pending_approval,
    v_locked
  from public.app_users u
  where u.id = any (v_member_ids);

  v_summary := jsonb_build_object(
    'team_members', v_team_members,
    'tier1_count', v_tier1_count,
    'tier2_count', v_tier2_count,
    'active_approved', v_active_approved,
    'pending_approval', v_pending_approval,
    'locked', v_locked
  );

  if cardinality(v_member_ids) = 0 then
    return jsonb_build_object(
      'caller_id', v_uid,
      'scope', v_scope,
      'from', p_from,
      'to', p_to,
      'permissions', jsonb_build_object(
        'lr', v_can_lr,
        'pod', v_can_pod,
        'delivery_challans', v_can_dc,
        'asn_creations', v_can_asn
      ),
      'summary', v_summary,
      'period', jsonb_build_object(
        'lrs_created', case when v_can_lr then to_jsonb(0) else 'null'::jsonb end,
        'lrs_updated', case when v_can_lr then to_jsonb(0) else 'null'::jsonb end,
        'pods_created', case when v_can_pod then to_jsonb(0) else 'null'::jsonb end,
        'dcs_created', case when v_can_dc then to_jsonb(0) else 'null'::jsonb end,
        'asns_created', case when v_can_asn then to_jsonb(0) else 'null'::jsonb end
      ),
      'open', jsonb_build_object(
        'lr_drafts_count', case when v_can_lr then to_jsonb(0) else 'null'::jsonb end,
        'pending_pod_count', case when v_can_lr then to_jsonb(0) else 'null'::jsonb end
      ),
      'completed_count', case when v_can_lr then to_jsonb(0) else 'null'::jsonb end,
      'members', '[]'::jsonb,
      'trends', '[]'::jsonb
    );
  end if;

  if v_can_lr then
    select count(*)::integer into v_lrs_created
    from public.lrs
    where created_by = any (v_member_ids)
      and created_at >= v_from_ts
      and created_at < v_to_ts;

    select count(*)::integer into v_lrs_updated
    from public.lrs
    where updated_by = any (v_member_ids)
      and updated_at >= v_from_ts
      and updated_at < v_to_ts
      and updated_at > created_at;

    select count(*)::integer into v_draft_count
    from public.lrs
    where coalesce(entry_status, 'final') = 'draft'
      and (created_by = any (v_member_ids) or updated_by = any (v_member_ids));

    select count(*)::integer into v_pending_pod
    from public.lrs l
    where coalesce(l.entry_status, 'final') = 'final'
      and coalesce(l.status, '') is distinct from 'Cancelled'
      and (l.created_by = any (v_member_ids) or l.assigned_to = any (v_member_ids))
      and not exists (
        select 1 from public.pods p where p.lr_number = l.lr_number
      );

    -- Same completion definition as personal overview: created in period
    -- with finalized_at set and final entry_status.
    select count(*)::integer into v_completed_count
    from public.lrs
    where created_by = any (v_member_ids)
      and created_at >= v_from_ts
      and created_at < v_to_ts
      and finalized_at is not null
      and coalesce(entry_status, 'final') = 'final';
  end if;

  if v_can_pod then
    select count(*)::integer into v_pods_created
    from public.pods
    where created_by = any (v_member_ids)
      and created_at >= v_from_ts
      and created_at < v_to_ts;
  end if;

  if v_can_dc then
    select count(*)::integer into v_dcs_created
    from public.delivery_challans
    where created_by = any (v_member_ids)
      and created_at >= v_from_ts
      and created_at < v_to_ts;
  end if;

  if v_can_asn then
    select count(*)::integer into v_asns_created
    from public.asn_creations
    where created_by = any (v_member_ids)
      and created_at >= v_from_ts
      and created_at < v_to_ts;
  end if;

  v_period := jsonb_build_object(
    'lrs_created', case when v_can_lr then to_jsonb(v_lrs_created) else 'null'::jsonb end,
    'lrs_updated', case when v_can_lr then to_jsonb(v_lrs_updated) else 'null'::jsonb end,
    'pods_created', case when v_can_pod then to_jsonb(v_pods_created) else 'null'::jsonb end,
    'dcs_created', case when v_can_dc then to_jsonb(v_dcs_created) else 'null'::jsonb end,
    'asns_created', case when v_can_asn then to_jsonb(v_asns_created) else 'null'::jsonb end
  );

  v_open := jsonb_build_object(
    'lr_drafts_count', case when v_can_lr then to_jsonb(v_draft_count) else 'null'::jsonb end,
    'pending_pod_count', case when v_can_lr then to_jsonb(v_pending_pod) else 'null'::jsonb end
  );

  -- Per-member breakdown (display fields + operational counts).
  select coalesce(jsonb_agg(to_jsonb(x) order by x.display_name), '[]'::jsonb)
  into v_members
  from (
    select
      u.id::text as user_id,
      coalesce(nullif(trim(u.display_name), ''), u.email, 'Unnamed') as display_name,
      u.role,
      u.approval_status,
      coalesce(u.is_locked, false) as is_locked,
      case when v_can_lr then (
        select count(*)::integer
        from public.lrs l
        where coalesce(l.entry_status, 'final') = 'draft'
          and (l.created_by = u.id or l.updated_by = u.id)
      ) else null end as drafts,
      case when v_can_lr then (
        select count(*)::integer
        from public.lrs l
        where coalesce(l.entry_status, 'final') = 'final'
          and coalesce(l.status, '') is distinct from 'Cancelled'
          and (l.created_by = u.id or l.assigned_to = u.id)
          and not exists (
            select 1 from public.pods p where p.lr_number = l.lr_number
          )
      ) else null end as pending_pods,
      case when v_can_lr then (
        select count(*)::integer
        from public.lrs l
        where l.created_by = u.id
          and l.created_at >= v_from_ts
          and l.created_at < v_to_ts
      ) else null end as lrs_created,
      case when v_can_lr then (
        select count(*)::integer
        from public.lrs l
        where l.updated_by = u.id
          and l.updated_at >= v_from_ts
          and l.updated_at < v_to_ts
          and l.updated_at > l.created_at
      ) else null end as lrs_updated,
      case when v_can_pod then (
        select count(*)::integer
        from public.pods p
        where p.created_by = u.id
          and p.created_at >= v_from_ts
          and p.created_at < v_to_ts
      ) else null end as pods_created,
      case when v_can_dc then (
        select count(*)::integer
        from public.delivery_challans d
        where d.created_by = u.id
          and d.created_at >= v_from_ts
          and d.created_at < v_to_ts
      ) else null end as dcs_created,
      case when v_can_asn then (
        select count(*)::integer
        from public.asn_creations a
        where a.created_by = u.id
          and a.created_at >= v_from_ts
          and a.created_at < v_to_ts
      ) else null end as asns_created,
      case when v_can_lr then (
        select count(*)::integer
        from public.lrs l
        where l.created_by = u.id
          and l.created_at >= v_from_ts
          and l.created_at < v_to_ts
          and l.finalized_at is not null
          and coalesce(l.entry_status, 'final') = 'final'
      ) else null end as completed_count,
      -- Same Avg LR Completion as personal get_overview_snapshot (038):
      -- created_by member, created in period, finalized_at set, final entry.
      case when v_can_lr then (
        select avg(extract(epoch from (l.finalized_at - l.created_at)))
        from public.lrs l
        where l.created_by = u.id
          and l.created_at >= v_from_ts
          and l.created_at < v_to_ts
          and l.finalized_at is not null
          and coalesce(l.entry_status, 'final') = 'final'
      ) else null end as avg_completion_seconds,
      -- Same LR Quality as personal get_overview_snapshot (038):
      -- quality_score = max(0, round(100 - edit_rate, 2))
      -- edit_rate = round(edits/lrs_created*100, 2); edits on LRs created in period.
      case when v_can_lr then (
        select case
          when q.lrs_created <= 0 then null
          else greatest(
            0,
            round(
              100 - round((q.total_edits::numeric / q.lrs_created::numeric) * 100, 2),
              2
            )
          )
        end
        from (
          select
            (
              select count(*)::integer
              from public.lrs l
              where l.created_by = u.id
                and l.created_at >= v_from_ts
                and l.created_at < v_to_ts
            ) as lrs_created,
            (
              select count(*)::integer
              from public.lr_edit_events e
              where e.lr_created_by = u.id
                and exists (
                  select 1
                  from public.lrs l
                  where l.id = e.lr_id
                    and l.created_by = u.id
                    and l.created_at >= v_from_ts
                    and l.created_at < v_to_ts
                )
            ) as total_edits
        ) q
      ) else null end as quality_score
    from public.app_users u
    where u.id = any (v_member_ids)
  ) x;

  -- Calendar-week trends within [p_from, p_to].
  -- Week boundaries are Asia/Kolkata ISO weeks (Monday start), matching
  -- the timezone used by personal overview calendar helpers.
  -- Per-week event bounds use the same ::timestamp casting as
  -- get_overview_snapshot period windows (metric parity).
  select coalesce(jsonb_agg(to_jsonb(t) order by t.week_start), '[]'::jsonb)
  into v_trends
  from (
    select
      gs.week_start::date as week_start,
      least(gs.week_start::date + 6, p_to) as week_end,
      case when v_can_lr then (
        select count(*)::integer
        from public.lrs l
        where l.created_by = any (v_member_ids)
          and l.created_at >= gs.week_start::timestamp
          and l.created_at < (least(gs.week_start::date + 7, p_to + 1))::timestamp
      ) else null end as lrs_created,
      case when v_can_pod then (
        select count(*)::integer
        from public.pods p
        where p.created_by = any (v_member_ids)
          and p.created_at >= gs.week_start::timestamp
          and p.created_at < (least(gs.week_start::date + 7, p_to + 1))::timestamp
      ) else null end as pods_created,
      case when v_can_lr then (
        select count(*)::integer
        from public.lrs l
        where l.created_by = any (v_member_ids)
          and l.created_at >= gs.week_start::timestamp
          and l.created_at < (least(gs.week_start::date + 7, p_to + 1))::timestamp
          and l.finalized_at is not null
          and coalesce(l.entry_status, 'final') = 'final'
      ) else null end as completed_count
    from generate_series(
      (
        date_trunc(
          'week',
          timezone(
            'Asia/Kolkata',
            p_from::timestamp AT TIME ZONE 'Asia/Kolkata'
          )
        )
      )::date,
      p_to,
      interval '7 days'
    ) as gs(week_start)
  ) t;

  return jsonb_build_object(
    'caller_id', v_uid,
    'scope', v_scope,
    'from', p_from,
    'to', p_to,
    'permissions', jsonb_build_object(
      'lr', v_can_lr,
      'pod', v_can_pod,
      'delivery_challans', v_can_dc,
      'asn_creations', v_can_asn
    ),
    'summary', v_summary,
    'period', v_period,
    'open', v_open,
    'completed_count', case when v_can_lr then to_jsonb(v_completed_count) else 'null'::jsonb end,
    'members', coalesce(v_members, '[]'::jsonb),
    'trends', coalesce(v_trends, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_team_overview_snapshot(date, date) from public;
revoke all on function public.get_team_overview_snapshot(date, date) from anon;
grant execute on function public.get_team_overview_snapshot(date, date) to authenticated;


comment on function public.get_team_overview_snapshot(date, date) is
  'Team Overview snapshot. Creator = organization (Tier 1+2). Tier 1 = assigned Tier 2 only. Tier 2 rejected. Scope from auth.uid() only. Member rows include avg_completion_seconds + quality_score (same formulas as personal overview 038).';
