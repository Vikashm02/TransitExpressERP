-- ==========================================================
-- Migration: 038_lr_finalized_at_and_edit_events
-- Module:    Overview efficiency — finalized_at + exact LR edit events
--
-- Additive only. Does NOT modify migrations 034–037 bodies.
-- Replaces get_overview_snapshot with an extended payload.
-- NOT executed automatically — run manually against Supabase.
--
-- ----------------------------------------------------------
-- finalized_at semantics
-- ----------------------------------------------------------
-- First moment entry_status becomes 'final'.
-- INSERT as final → finalized_at = created_at (or now()).
-- Draft → remains NULL until first transition to final.
-- Later edits of a final LR → finalized_at is NEVER changed.
--
-- Pre-existing final rows: backfilled with created_at as the best
-- available approximation (true finalize time was never stored).
--
-- ----------------------------------------------------------
-- lr_edit_events / quality edit semantics
-- ----------------------------------------------------------
-- ONE row per qualifying UPDATE. Quality is attributed to
-- lr_created_by (original creator), NOT edited_by.
--
-- Counts as an edit when ALL of:
--   1) OLD.entry_status = 'final' AND NEW.entry_status = 'final'
--      (post-finalization corrections only)
--   2) At least one business content column changed, excluding:
--        id, created_at, created_by, updated_at, updated_by,
--        finalized_at, status, assigned_to
--
-- Explicitly does NOT count:
--   - Draft autosaves (entry_status stays draft)
--   - Draft → final (finalization; uses finalized_at instead)
--   - Status-only updates (POD Delivered, Billing Billed, etc.)
--   - assigned_to-only reassignment (reassignLR)
--   - INSERT / CREATE
--
-- Historical exact edit counts cannot be reconstructed — events
-- start at migration apply time (app_metric_epochs.lr_edit_events).
-- ==========================================================

-- ---------- finalized_at ----------
alter table public.lrs
  add column if not exists finalized_at timestamptz;

comment on column public.lrs.finalized_at is
  'First moment entry_status became final. Immutable once set.';

-- Approximate stamp for rows already final before this migration.
update public.lrs
set finalized_at = created_at
where coalesce(entry_status, 'final') = 'final'
  and finalized_at is null
  and created_at is not null;

create index if not exists idx_lrs_finalized_at
  on public.lrs (finalized_at)
  where finalized_at is not null;

create index if not exists idx_lrs_created_by_created_at
  on public.lrs (created_by, created_at);

create or replace function public.set_lr_finalized_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if coalesce(NEW.entry_status, 'final') = 'final' then
      NEW.finalized_at := coalesce(NEW.finalized_at, NEW.created_at, now());
    else
      NEW.finalized_at := null;
    end if;
    return NEW;
  end if;

  -- UPDATE: never overwrite an existing finalized_at.
  if OLD.finalized_at is not null then
    NEW.finalized_at := OLD.finalized_at;
    return NEW;
  end if;

  if coalesce(NEW.entry_status, 'final') = 'final'
     and coalesce(OLD.entry_status, 'final') is distinct from 'final' then
    NEW.finalized_at := now();
  elsif coalesce(NEW.entry_status, 'final') = 'final'
        and coalesce(OLD.entry_status, 'final') = 'final'
        and OLD.finalized_at is null then
    -- Rare: already final without a stamp (should only hit pre-trigger races).
    NEW.finalized_at := coalesce(NEW.created_at, now());
  else
    NEW.finalized_at := null;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_lrs_finalized_at on public.lrs;
create trigger trg_lrs_finalized_at
  before insert or update on public.lrs
  for each row execute function public.set_lr_finalized_at();

-- ---------- edit tracking epoch ----------
create table if not exists public.app_metric_epochs (
  metric_key text primary key,
  started_at timestamptz not null default now()
);

insert into public.app_metric_epochs (metric_key, started_at)
values ('lr_edit_events', now())
on conflict (metric_key) do nothing;

alter table public.app_metric_epochs enable row level security;

drop policy if exists app_metric_epochs_select on public.app_metric_epochs;
create policy app_metric_epochs_select on public.app_metric_epochs
  for select to authenticated
  using (true);

-- ---------- lr_edit_events ----------
create table if not exists public.lr_edit_events (
  id bigint generated always as identity primary key,
  lr_id uuid not null references public.lrs (id) on delete cascade,
  edited_by uuid references public.app_users (id),
  lr_created_by uuid references public.app_users (id),
  edited_at timestamptz not null default now()
);

comment on table public.lr_edit_events is
  'One row per qualifying post-final LR content edit. Quality attribution uses lr_created_by.';

create index if not exists idx_lr_edit_events_lr_id
  on public.lr_edit_events (lr_id);

create index if not exists idx_lr_edit_events_creator_edited_at
  on public.lr_edit_events (lr_created_by, edited_at);

-- True when business content (not audit / status / assignment) changed.
create or replace function public.lr_has_quality_content_change(
  p_old public.lrs,
  p_new public.lrs
)
returns boolean
language sql
immutable
as $$
  select (
    to_jsonb(p_new)
      - array[
        'id',
        'created_at',
        'created_by',
        'updated_at',
        'updated_by',
        'finalized_at',
        'status',
        'assigned_to'
      ]
  ) is distinct from (
    to_jsonb(p_old)
      - array[
        'id',
        'created_at',
        'created_by',
        'updated_at',
        'updated_by',
        'finalized_at',
        'status',
        'assigned_to'
      ]
  );
$$;

create or replace function public.record_lr_edit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only post-final content edits. Draft autosave, draft→final, status-only,
  -- and assigned_to-only updates are excluded (see migration header).
  if coalesce(OLD.entry_status, 'final') = 'final'
     and coalesce(NEW.entry_status, 'final') = 'final'
     and public.lr_has_quality_content_change(OLD, NEW) then
    insert into public.lr_edit_events (lr_id, edited_by, lr_created_by, edited_at)
    values (
      NEW.id,
      coalesce(NEW.updated_by, auth.uid()),
      OLD.created_by,
      now()
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_lrs_edit_event on public.lrs;
create trigger trg_lrs_edit_event
  after update on public.lrs
  for each row execute function public.record_lr_edit_event();

alter table public.lr_edit_events enable row level security;

drop policy if exists lr_edit_events_select_own on public.lr_edit_events;
create policy lr_edit_events_select_own on public.lr_edit_events
  for select to authenticated
  using (
    lr_created_by = auth.uid()
    or public.is_app_admin()
  );

-- No insert/update/delete policies for authenticated — writes are trigger-only
-- via SECURITY DEFINER record_lr_edit_event().

revoke all on table public.lr_edit_events from public;
grant select on table public.lr_edit_events to authenticated;

-- ---------- age-bucket helper (calendar days, Asia/Kolkata) ----------
create or replace function public._overview_age_days(p_at timestamptz)
returns integer
language sql
stable
as $$
  select greatest(
    0,
    (
      (timezone('Asia/Kolkata', now()))::date
      - (timezone('Asia/Kolkata', p_at))::date
    )
  );
$$;

revoke all on function public._overview_age_days(timestamptz) from public;
revoke all on function public._overview_age_days(timestamptz) from authenticated;

-- ---------- Extended personal overview snapshot ----------
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
  -- Efficiency aggregates
  v_draft_today integer := 0;
  v_draft_1_2 integer := 0;
  v_draft_3_7 integer := 0;
  v_draft_7_plus integer := 0;
  v_draft_oldest integer := null;
  v_pod_today integer := 0;
  v_pod_1_2 integer := 0;
  v_pod_3_7 integer := 0;
  v_pod_7_plus integer := 0;
  v_pod_oldest integer := null;
  v_completed_count integer := 0;
  v_avg_completion_seconds numeric := null;
  v_quality_lrs integer := 0;
  v_quality_edits integer := 0;
  v_edit_rate numeric := null;
  v_quality_score numeric := null;
  v_edit_tracking_started timestamptz := null;
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

  select started_at into v_edit_tracking_started
  from public.app_metric_epochs
  where metric_key = 'lr_edit_events';

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
    -- Open draft queue (all ages). Age from created_at calendar days.
    select count(*)::integer into v_draft_count
    from public.lrs
    where coalesce(entry_status, 'final') = 'draft'
      and (created_by = v_uid or updated_by = v_uid);

    select
      count(*) filter (where a.age_days = 0)::integer,
      count(*) filter (where a.age_days between 1 and 2)::integer,
      count(*) filter (where a.age_days between 3 and 7)::integer,
      count(*) filter (where a.age_days > 7)::integer,
      max(a.age_days)
    into v_draft_today, v_draft_1_2, v_draft_3_7, v_draft_7_plus, v_draft_oldest
    from (
      select public._overview_age_days(created_at) as age_days
      from public.lrs
      where coalesce(entry_status, 'final') = 'draft'
        and (created_by = v_uid or updated_by = v_uid)
    ) a;

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

    -- Pending POD open queue (same personal rules as 037). Age from LR created_at.
    select count(*)::integer into v_pending_pod
    from public.lrs l
    where coalesce(l.entry_status, 'final') = 'final'
      and coalesce(l.status, '') is distinct from 'Cancelled'
      and (l.created_by = v_uid or l.assigned_to = v_uid)
      and not exists (
        select 1 from public.pods p where p.lr_number = l.lr_number
      );

    select
      count(*) filter (where a.age_days = 0)::integer,
      count(*) filter (where a.age_days between 1 and 2)::integer,
      count(*) filter (where a.age_days between 3 and 7)::integer,
      count(*) filter (where a.age_days > 7)::integer,
      max(a.age_days)
    into v_pod_today, v_pod_1_2, v_pod_3_7, v_pod_7_plus, v_pod_oldest
    from (
      select public._overview_age_days(l.created_at) as age_days
      from public.lrs l
      where coalesce(l.entry_status, 'final') = 'final'
        and coalesce(l.status, '') is distinct from 'Cancelled'
        and (l.created_by = v_uid or l.assigned_to = v_uid)
        and not exists (
          select 1 from public.pods p where p.lr_number = l.lr_number
        )
    ) a;

    -- Avg completion: LRs created in period with finalized_at set.
    -- Duration = finalized_at - created_at (never updated_at).
    select
      count(*)::integer,
      avg(extract(epoch from (finalized_at - created_at)))
    into v_completed_count, v_avg_completion_seconds
    from public.lrs
    where created_by = v_uid
      and created_at >= v_from_ts
      and created_at < v_to_ts
      and finalized_at is not null
      and coalesce(entry_status, 'final') = 'final';

    -- Quality: LRs created in period; ALL tracked edits on those LRs
    -- (edits may occur after the selected creation period).
    v_quality_lrs := v_lrs_created;

    if v_quality_lrs > 0 then
      select count(*)::integer into v_quality_edits
      from public.lr_edit_events e
      where e.lr_created_by = v_uid
        and exists (
          select 1
          from public.lrs l
          where l.id = e.lr_id
            and l.created_by = v_uid
            and l.created_at >= v_from_ts
            and l.created_at < v_to_ts
        );

      v_edit_rate := round((v_quality_edits::numeric / v_quality_lrs::numeric) * 100, 2);
      v_quality_score := greatest(0, round(100 - v_edit_rate, 2));
    end if;
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
    'recent', coalesce(v_recent, '[]'::jsonb),
    -- Period semantics (documented for clients):
    -- drafts / pending_pod_age: open queues, not filtered by reporting period.
    -- completion / quality: LRs created_by caller in [from, to].
    -- quality edits: all tracked edits on those LRs (may be after period end).
    'efficiency', case
      when not v_can_lr then 'null'::jsonb
      else jsonb_build_object(
        'draft_age', jsonb_build_object(
          'today', v_draft_today,
          'days_1_2', v_draft_1_2,
          'days_3_7', v_draft_3_7,
          'days_7_plus', v_draft_7_plus,
          'oldest_days', to_jsonb(v_draft_oldest),
          'total', v_draft_count
        ),
        'pending_pod_age', jsonb_build_object(
          'today', v_pod_today,
          'days_1_2', v_pod_1_2,
          'days_3_7', v_pod_3_7,
          'days_7_plus', v_pod_7_plus,
          'oldest_days', to_jsonb(v_pod_oldest),
          'total', v_pending_pod
        ),
        'completion', jsonb_build_object(
          'completed_count', v_completed_count,
          'avg_seconds', to_jsonb(v_avg_completion_seconds)
        ),
        'quality', jsonb_build_object(
          'lrs_created', v_quality_lrs,
          'total_edits', v_quality_edits,
          'edit_rate', to_jsonb(v_edit_rate),
          'quality_score', to_jsonb(v_quality_score),
          'tracking_started_at', to_jsonb(v_edit_tracking_started)
        )
      )
    end
  );
end;
$$;

grant execute on function public.get_overview_snapshot(date, date) to authenticated;

comment on function public.get_overview_snapshot(date, date) is
  'Personal Overview snapshot (auth.uid()) including efficiency metrics. Requires migration 038.';
