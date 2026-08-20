-- ==========================================================
-- Migration: 042_team_dashboard_assignments
-- Module:    Secure Team Dashboard (assignments + team overview RPC)
--
-- Adds:
--   1) public.staff_manager_assignments — Tier 1 ↔ Tier 2 mapping
--   2) RLS + helpers (no recursive app_users subquery in policies)
--   3) public.get_team_overview_snapshot(date, date) — SECURITY DEFINER
--      team aggregates scoped by auth.uid() (Creator = org, Tier 1 =
--      assigned staff only, Tier 2 = rejected)
--
-- Does NOT modify migration 041.
-- Does NOT change get_overview_snapshot personal semantics.
--
-- NOT executed automatically — run manually against Supabase after review.
-- ==========================================================


-- ----------------------------------------------------------
-- PART A — staff_manager_assignments
-- ----------------------------------------------------------

create table if not exists public.staff_manager_assignments (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.app_users (id) on delete cascade,
  staff_id uuid not null references public.app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id)
);

-- One Tier 2 staff member may have at most one Tier 1 manager.
create unique index if not exists staff_manager_assignments_staff_uidx
  on public.staff_manager_assignments (staff_id);

create unique index if not exists staff_manager_assignments_pair_uidx
  on public.staff_manager_assignments (manager_id, staff_id);

create index if not exists staff_manager_assignments_manager_idx
  on public.staff_manager_assignments (manager_id);


-- Enforce role shapes + audit field rules on every write.
create or replace function public.staff_manager_assignments_enforce_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager_role text;
  v_staff_role text;
begin
  -- Audit identity is immutable after INSERT.
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is null then
      raise exception
        'staff_manager_assignments: authenticated Creator required to insert';
    end if;
    -- Never trust client-supplied created_by / created_at.
    new.created_by := auth.uid();
    new.created_at := now();
  end if;

  select role into v_manager_role
  from public.app_users
  where id = new.manager_id;

  select role into v_staff_role
  from public.app_users
  where id = new.staff_id;

  if v_manager_role is distinct from 'admin' then
    raise exception
      'staff_manager_assignments: manager_id must be Tier 1 (role = admin)';
  end if;

  if v_staff_role is distinct from 'staff' then
    raise exception
      'staff_manager_assignments: staff_id must be Tier 2 (role = staff)';
  end if;

  if new.manager_id = new.staff_id then
    raise exception 'staff_manager_assignments: manager and staff cannot be the same user';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_staff_manager_assignments_enforce_roles
  on public.staff_manager_assignments;

create trigger trg_staff_manager_assignments_enforce_roles
before insert or update on public.staff_manager_assignments
for each row
execute function public.staff_manager_assignments_enforce_roles();

revoke all on function public.staff_manager_assignments_enforce_roles() from public;
revoke all on function public.staff_manager_assignments_enforce_roles() from anon, authenticated;


-- Keep assignments consistent when roles change (e.g. Tier 2 promoted).
create or replace function public.app_users_cleanup_manager_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.role is distinct from new.role then
    if new.role is distinct from 'staff' then
      delete from public.staff_manager_assignments
      where staff_id = new.id;
    end if;
    if new.role is distinct from 'admin' then
      delete from public.staff_manager_assignments
      where manager_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_app_users_cleanup_manager_assignments on public.app_users;

create trigger trg_app_users_cleanup_manager_assignments
after update of role on public.app_users
for each row
execute function public.app_users_cleanup_manager_assignments();

revoke all on function public.app_users_cleanup_manager_assignments() from public;
revoke all on function public.app_users_cleanup_manager_assignments() from anon, authenticated;


-- ----------------------------------------------------------
-- PART B — RLS on assignments
-- ----------------------------------------------------------

alter table public.staff_manager_assignments enable row level security;

-- Creator: full management. Tier 1: select own rows only. Tier 2: none.
drop policy if exists staff_manager_assignments_select on public.staff_manager_assignments;
create policy staff_manager_assignments_select
on public.staff_manager_assignments
for select
to authenticated
using (
  public.current_app_user_role() = 'creator'
  or (
    public.current_app_user_role() = 'admin'
    and manager_id = auth.uid()
  )
);

drop policy if exists staff_manager_assignments_insert on public.staff_manager_assignments;
create policy staff_manager_assignments_insert
on public.staff_manager_assignments
for insert
to authenticated
with check (public.current_app_user_role() = 'creator');

drop policy if exists staff_manager_assignments_update on public.staff_manager_assignments;
create policy staff_manager_assignments_update
on public.staff_manager_assignments
for update
to authenticated
using (public.current_app_user_role() = 'creator')
with check (public.current_app_user_role() = 'creator');

drop policy if exists staff_manager_assignments_delete on public.staff_manager_assignments;
create policy staff_manager_assignments_delete
on public.staff_manager_assignments
for delete
to authenticated
using (public.current_app_user_role() = 'creator');


-- ----------------------------------------------------------
-- PART C — team scope helper (SECURITY DEFINER)
-- ----------------------------------------------------------
-- Returns permitted Tier 2 (and for Creator, also Tier 1) user ids for
-- team operational aggregation. Never accepts a caller-supplied scope.

create or replace function public.team_dashboard_member_ids()
returns table (member_id uuid, member_role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_app_user_role();
begin
  if v_role = 'creator' then
    return query
      select u.id, u.role
      from public.app_users u
      where u.role in ('admin', 'staff');
    return;
  end if;

  if v_role = 'admin' then
    return query
      select u.id, u.role
      from public.staff_manager_assignments a
      join public.app_users u on u.id = a.staff_id
      where a.manager_id = auth.uid()
        and u.role = 'staff';
    return;
  end if;

  -- Tier 2 / unknown: empty
  return;
end;
$$;

revoke all on function public.team_dashboard_member_ids() from public;
revoke all on function public.team_dashboard_member_ids() from anon;
grant execute on function public.team_dashboard_member_ids() to authenticated;


-- ----------------------------------------------------------
-- PART D — get_team_overview_snapshot
-- ----------------------------------------------------------
-- Parameter types are date (same as get_overview_snapshot) so the
-- existing OverviewPeriodFilter ISO dates bind correctly.
-- Metric definitions intentionally mirror get_overview_snapshot (038):
--   drafts: entry_status=draft AND (created_by OR updated_by) in scope
--   pending POD: final, not Cancelled, (created_by OR assigned_to) in scope,
--                no matching pods.lr_number
--   LRs/PODs/DCs/ASNs created: created_by in scope, created_at in [from, to)
--   LRs updated: updated_by in scope, updated_at in range, updated_at > created_at
--   completed: created_by in scope, created in range, finalized_at set, final
-- Period window: v_from_ts := p_from::timestamp; v_to_ts := (p_to + 1)::timestamp
-- (same casting as personal overview).
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
      ) else null end as completed_count
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
  'Team Overview snapshot. Creator = organization (Tier 1+2). Tier 1 = assigned Tier 2 only. Tier 2 rejected. Scope from auth.uid() only.';

-- ==========================================================
