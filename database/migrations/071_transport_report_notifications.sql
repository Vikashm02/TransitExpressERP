-- ==========================================================
-- Migration: 071_transport_report_notifications
-- Module:    Transport — monthly report + notification-center foundation
--
-- PURPOSE (V1):
--   - Admin-configured report recipient (single email)
--   - Transport monthly summary aggregation RPC (lr_date window)
--   - Report delivery history + idempotency for monthly email
--   - Does NOT implement PO alerts
--   - Does NOT replace announcements / Web Push stack
--
-- NOT applied automatically — review, then apply manually in Supabase.
-- ==========================================================

-- ---------- report_settings (singleton) ----------
create table if not exists public.report_settings (
  id smallint primary key default 1 check (id = 1),
  report_email_to text not null default '',
  monthly_transport_enabled boolean not null default false,
  -- Day-of-month to run previous-month report (1–28; default 1st).
  monthly_day integer not null default 1
    check (monthly_day >= 1 and monthly_day <= 28),
  timezone text not null default 'Asia/Kolkata',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

comment on table public.report_settings is
  'Singleton Transport report configuration. V1: one recipient email + monthly toggle.';

comment on column public.report_settings.report_email_to is
  'Admin-configured recipient for Transport monthly summary emails. Not auto-derived from staff.';

comment on column public.report_settings.monthly_transport_enabled is
  'When true, scheduled cron may send previous-month summary. Default false until August test succeeds.';

insert into public.report_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.report_settings enable row level security;

drop policy if exists report_settings_select_admin on public.report_settings;
create policy report_settings_select_admin
  on public.report_settings
  for select
  to authenticated
  using (public.is_app_admin());

drop policy if exists report_settings_update_admin on public.report_settings;
create policy report_settings_update_admin
  on public.report_settings
  for update
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- No client insert/delete — singleton seeded above.

-- ---------- report_deliveries (audit + idempotency) ----------
create table if not exists public.report_deliveries (
  id bigint generated always as identity primary key,
  report_type text not null,
  period_key text not null,
  period_from date not null,
  period_to_exclusive date not null,
  channel text not null default 'email',
  recipient text not null default '',
  status text not null
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  error_message text,
  -- Compact totals only (no full LR rows).
  summary_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id)
);

comment on table public.report_deliveries is
  'Transport report send audit. Partial unique index prevents duplicate successful monthly email sends.';

-- Idempotency for automated monthly email (one row per period for channel=email).
create unique index if not exists report_deliveries_monthly_email_uidx
  on public.report_deliveries (report_type, period_key)
  where channel = 'email';

create index if not exists idx_report_deliveries_requested_at
  on public.report_deliveries (requested_at desc);

alter table public.report_deliveries enable row level security;

drop policy if exists report_deliveries_select_admin on public.report_deliveries;
create policy report_deliveries_select_admin
  on public.report_deliveries
  for select
  to authenticated
  using (public.is_app_admin());

-- Inserts/updates performed by SECURITY DEFINER RPCs / Edge Function service role.
-- Authenticated clients do not insert directly.

-- ---------- Aggregation RPC ----------
create or replace function public.get_transport_monthly_summary(
  p_from date,
  p_to_exclusive date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Admin-only for V1 (report / test email). Supply Intelligence remains separate.
  if not public.is_app_admin() then
    raise exception 'Not permitted to view transport monthly summary';
  end if;

  if p_from is null or p_to_exclusive is null then
    raise exception 'Report period is required';
  end if;

  if p_from >= p_to_exclusive then
    raise exception 'Invalid report period';
  end if;

  with base as (
    select
      l.id,
      coalesce(nullif(trim(l.consignee), ''), 'Unknown') as consignee,
      coalesce(l.loading_weight, 0)::numeric as loading_weight,
      nullif(trim(l.vehicle_number), '') as vehicle_number
    from public.lrs l
    where coalesce(l.entry_status, 'final') = 'final'
      and l.status is distinct from 'Cancelled'
      and l.lr_date >= p_from
      and l.lr_date < p_to_exclusive
  ),
  totals as (
    select
      count(*)::integer as total_lrs,
      coalesce(sum(loading_weight), 0)::numeric as total_loading_weight,
      count(distinct vehicle_number)::integer as unique_vehicles
    from base
  ),
  by_consignee as (
    select
      consignee,
      count(*)::integer as lr_count,
      coalesce(sum(loading_weight), 0)::numeric as loading_weight
    from base
    group by consignee
    order by coalesce(sum(loading_weight), 0) desc, consignee asc
    limit 10
  )
  select jsonb_build_object(
    'period_from', p_from,
    'period_to_exclusive', p_to_exclusive,
    'total_lrs', (select total_lrs from totals),
    'total_loading_weight', (select total_loading_weight from totals),
    'unique_vehicles', (select unique_vehicles from totals),
    'top_consignees', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'consignee', c.consignee,
            'loading_weight', c.loading_weight,
            'lr_count', c.lr_count
          )
          order by c.loading_weight desc, c.consignee asc
        )
        from by_consignee c
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_transport_monthly_summary(date, date) from public;
revoke all on function public.get_transport_monthly_summary(date, date) from anon;
grant execute on function public.get_transport_monthly_summary(date, date) to authenticated;

comment on function public.get_transport_monthly_summary(date, date) is
  'Admin-only Transport monthly summary. Filters: final, not Cancelled, lr_date in [from, to). Returns totals + top 10 consignees by loading_weight.';

-- ---------- Settings helpers ----------
create or replace function public.get_report_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.report_settings%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_app_admin() then
    raise exception 'Not permitted';
  end if;

  select * into v_row from public.report_settings where id = 1;
  if not found then
    insert into public.report_settings (id) values (1)
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'report_email_to', v_row.report_email_to,
    'monthly_transport_enabled', v_row.monthly_transport_enabled,
    'monthly_day', v_row.monthly_day,
    'timezone', v_row.timezone
  );
end;
$$;

revoke all on function public.get_report_settings() from public;
revoke all on function public.get_report_settings() from anon;
grant execute on function public.get_report_settings() to authenticated;

create or replace function public.update_report_settings(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_enabled boolean;
  v_day integer;
  v_row public.report_settings%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_app_admin() then
    raise exception 'Not permitted';
  end if;

  v_email := trim(coalesce(p_payload->>'report_email_to', ''));
  if v_email <> '' and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid report email address';
  end if;

  v_enabled := coalesce((p_payload->>'monthly_transport_enabled')::boolean, false);
  begin
    v_day := coalesce((p_payload->>'monthly_day')::integer, 1);
  exception
    when others then
      v_day := 1;
  end;
  if v_day < 1 or v_day > 28 then
    raise exception 'monthly_day must be between 1 and 28';
  end if;

  update public.report_settings
  set
    report_email_to = v_email,
    monthly_transport_enabled = v_enabled,
    monthly_day = v_day,
    updated_at = now(),
    updated_by = v_uid
  where id = 1
  returning * into v_row;

  if not found then
    insert into public.report_settings (
      id, report_email_to, monthly_transport_enabled, monthly_day, updated_by
    ) values (1, v_email, v_enabled, v_day, v_uid)
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'report_email_to', v_row.report_email_to,
    'monthly_transport_enabled', v_row.monthly_transport_enabled,
    'monthly_day', v_row.monthly_day,
    'timezone', v_row.timezone
  );
end;
$$;

revoke all on function public.update_report_settings(jsonb) from public;
revoke all on function public.update_report_settings(jsonb) from anon;
grant execute on function public.update_report_settings(jsonb) to authenticated;

-- ---------- Seed optional notification rule (manual admin test) ----------
insert into public.notification_rules (
  rule_key, category, name, description, enabled, delivery_mode, scheduled_time, sort_order
)
values (
  'admin.test',
  'System',
  'Admin test notification',
  'Manual test push/in-app from Settings. Keep enabled to allow test push delivery.',
  true,
  'immediate',
  '08:00',
  900
)
on conflict (rule_key) do nothing;
