-- ==========================================================
-- Migration: 037_overview_dashboard_rpc
-- Module:    Overview — personal scoped snapshot for Phase 2a
--
-- Adds get_overview_snapshot(p_from date, p_to date) which returns a
-- compact JSON payload for the authenticated user's own operational work.
--
-- Scope: ALWAYS auth.uid() — no staff_user_id parameter (Phase 2c).
-- Period metrics filter by selected dates; open queues (drafts, pending
-- POD) remain visible while unfinished regardless of create date.
--
-- Permission-aware: modules the caller cannot view are omitted / null.
-- SECURITY DEFINER with explicit has_permission checks — does not weaken RLS.
--
-- Additive only. Does NOT modify migrations 033–036.
-- NOT executed automatically — run manually against Supabase.
-- ==========================================================

-- Helper for today / month standing blocks (not granted to clients).
create or replace function public._overview_period_counts(
  p_uid uuid,
  p_from date,
  p_to date,
  p_can_lr boolean,
  p_can_pod boolean,
  p_can_dc boolean,
  p_can_asn boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_ts timestamptz := p_from::timestamp;
  v_to_ts timestamptz := (p_to + 1)::timestamp;
  v_created integer := 0;
  v_updated integer := 0;
  v_pods integer := 0;
  v_dcs integer := 0;
  v_asns integer := 0;
begin
  if p_can_lr then
    select count(*)::integer into v_created
    from public.lrs
    where created_by = p_uid
      and created_at >= v_from_ts
      and created_at < v_to_ts;

    select count(*)::integer into v_updated
    from public.lrs
    where updated_by = p_uid
      and updated_at >= v_from_ts
      and updated_at < v_to_ts
      and updated_at > created_at;
  end if;

  if p_can_pod then
    select count(*)::integer into v_pods
    from public.pods
    where created_by = p_uid
      and created_at >= v_from_ts
      and created_at < v_to_ts;
  end if;

  if p_can_dc then
    select count(*)::integer into v_dcs
    from public.delivery_challans
    where created_by = p_uid
      and created_at >= v_from_ts
      and created_at < v_to_ts;
  end if;

  if p_can_asn then
    select count(*)::integer into v_asns
    from public.asn_creations
    where created_by = p_uid
      and created_at >= v_from_ts
      and created_at < v_to_ts;
  end if;

  return jsonb_build_object(
    'lrs_created', case when p_can_lr then to_jsonb(v_created) else 'null'::jsonb end,
    'lrs_updated', case when p_can_lr then to_jsonb(v_updated) else 'null'::jsonb end,
    'pods_created', case when p_can_pod then to_jsonb(v_pods) else 'null'::jsonb end,
    'dcs_created', case when p_can_dc then to_jsonb(v_dcs) else 'null'::jsonb end,
    'asns_created', case when p_can_asn then to_jsonb(v_asns) else 'null'::jsonb end,
    'created_total',
      (case when p_can_lr then v_created else 0 end)
      + (case when p_can_pod then v_pods else 0 end)
      + (case when p_can_dc then v_dcs else 0 end)
      + (case when p_can_asn then v_asns else 0 end)
  );
end;
$$;

revoke all on function public._overview_period_counts(uuid, date, date, boolean, boolean, boolean, boolean)
  from public;
revoke all on function public._overview_period_counts(uuid, date, date, boolean, boolean, boolean, boolean)
  from authenticated;

create or replace function public.get_overview_snapshot(
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
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_month_start date;
  v_can_lr boolean;
  v_can_pod boolean;
  v_can_dc boolean;
  v_can_asn boolean;
  v_period jsonb;
  v_today_metrics jsonb;
  v_month_metrics jsonb;
  v_open jsonb;
  v_drafts jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
  v_lrs_created integer := 0;
  v_lrs_updated integer := 0;
  v_pods_created integer := 0;
  v_dcs_created integer := 0;
  v_asns_created integer := 0;
  v_draft_count integer := 0;
  v_pending_pod integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_from is null or p_to is null then
    raise exception 'From and to dates are required';
  end if;

  if p_to < p_from then
    raise exception 'To date must be on or after from date';
  end if;

  v_from_ts := p_from::timestamp;
  v_to_ts := (p_to + 1)::timestamp;
  v_month_start := date_trunc('month', v_today::timestamp)::date;

  v_can_lr := public.has_permission('lr', 'view');
  v_can_pod := public.has_permission('pod', 'view');
  v_can_dc := public.has_permission('delivery_challans', 'view');
  v_can_asn := public.has_permission('asn_creations', 'view');

  if v_can_lr then
    select count(*)::integer into v_lrs_created
    from public.lrs
    where created_by = v_uid
      and created_at >= v_from_ts
      and created_at < v_to_ts;

    select count(*)::integer into v_lrs_updated
    from public.lrs
    where updated_by = v_uid
      and updated_at >= v_from_ts
      and updated_at < v_to_ts
      and updated_at > created_at;
  end if;

  if v_can_pod then
    select count(*)::integer into v_pods_created
    from public.pods
    where created_by = v_uid
      and created_at >= v_from_ts
      and created_at < v_to_ts;
  end if;

  if v_can_dc then
    select count(*)::integer into v_dcs_created
    from public.delivery_challans
    where created_by = v_uid
      and created_at >= v_from_ts
      and created_at < v_to_ts;
  end if;

  if v_can_asn then
    select count(*)::integer into v_asns_created
    from public.asn_creations
    where created_by = v_uid
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

  if v_can_lr then
    select count(*)::integer into v_draft_count
    from public.lrs
    where coalesce(entry_status, 'final') = 'draft'
      and (created_by = v_uid or updated_by = v_uid);

    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
    into v_drafts
    from (
      select
        id::text as id,
        lr_number,
        vehicle_number,
        created_at,
        updated_at
      from public.lrs
      where coalesce(entry_status, 'final') = 'draft'
        and (created_by = v_uid or updated_by = v_uid)
      order by coalesce(updated_at, created_at) desc
      limit 10
    ) d;
  end if;

  if v_can_lr then
    select count(*)::integer into v_pending_pod
    from public.lrs l
    where coalesce(l.entry_status, 'final') = 'final'
      and coalesce(l.status, '') is distinct from 'Cancelled'
      and (l.created_by = v_uid or l.assigned_to = v_uid)
      and not exists (
        select 1 from public.pods p where p.lr_number = l.lr_number
      );
  end if;

  v_open := jsonb_build_object(
    'lr_drafts_count', case when v_can_lr then to_jsonb(v_draft_count) else 'null'::jsonb end,
    'pending_pod_count', case when v_can_lr then to_jsonb(v_pending_pod) else 'null'::jsonb end
  );

  v_today_metrics := public._overview_period_counts(
    v_uid, v_today, v_today, v_can_lr, v_can_pod, v_can_dc, v_can_asn
  );
  v_month_metrics := public._overview_period_counts(
    v_uid, v_month_start, v_today, v_can_lr, v_can_pod, v_can_dc, v_can_asn
  );

  -- Recent work UNION: cast id::text in every branch.
  -- Live DBs may have lrs.id as uuid while pods/delivery_challans/asn_creations
  -- use bigint (see migration 011 note). Mixing those in UNION raises 42804.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb)
  into v_recent
  from (
    select * from (
      (
        select
          'lr'::text as module,
          id::text as id,
          lr_number as reference,
          'created'::text as action,
          created_at as at
        from public.lrs
        where v_can_lr and created_by = v_uid
        order by created_at desc
        limit 8
      )
      union all
      (
        select
          'lr'::text,
          id::text,
          lr_number,
          'updated'::text,
          updated_at
        from public.lrs
        where v_can_lr
          and updated_by = v_uid
          and updated_at > created_at
        order by updated_at desc
        limit 8
      )
      union all
      (
        select
          'pod'::text,
          id::text,
          lr_number,
          'created'::text,
          created_at
        from public.pods
        where v_can_pod and created_by = v_uid
        order by created_at desc
        limit 8
      )
      union all
      (
        select
          'dc'::text,
          id::text,
          lr_number,
          'created'::text,
          created_at
        from public.delivery_challans
        where v_can_dc and created_by = v_uid
        order by created_at desc
        limit 8
      )
      union all
      (
        select
          'asn'::text,
          id::text,
          asn_number,
          'created'::text,
          created_at
        from public.asn_creations
        where v_can_asn and created_by = v_uid
        order by created_at desc
        limit 8
      )
    ) u
    order by u.at desc
    limit 12
  ) x;

  return jsonb_build_object(
    'user_id', v_uid,
    'from', p_from,
    'to', p_to,
    'permissions', jsonb_build_object(
      'lr', v_can_lr,
      'pod', v_can_pod,
      'delivery_challans', v_can_dc,
      'asn_creations', v_can_asn
    ),
    'period', v_period,
    'open', v_open,
    'today', v_today_metrics,
    'month', v_month_metrics,
    'drafts', coalesce(v_drafts, '[]'::jsonb),
    'recent', coalesce(v_recent, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_overview_snapshot(date, date) to authenticated;

comment on function public.get_overview_snapshot(date, date) is
  'Phase 2a personal Overview snapshot. Scoped to auth.uid() only.';
