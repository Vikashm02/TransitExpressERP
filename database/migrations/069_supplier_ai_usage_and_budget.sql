-- ============================================================
-- 069_supplier_ai_usage_and_budget.sql
-- ADDITIVE ONLY. Does not modify 067 / 068 or Transport tables.
--
-- Purpose:
--   Durable Supplier AI usage ledger + monthly budget settings +
--   atomic budget reservation (concurrency-safe hard stop).
--
-- Does NOT:
--   - hard-code OpenAI models or pricing
--   - store prompts / completions / API keys
--   - enable AI by default (application feature flag remains off)
--   - change conversation capture paths
--   - expose service_role to the browser
--
-- Application writes usage/reservations via service_role only.
-- Authenticated clients: SELECT where permitted; no INSERT/UPDATE/DELETE.
-- ============================================================

begin;

-- ----------------------------------------------------------
-- PART A — usage ledger (append-only)
-- ----------------------------------------------------------

create table if not exists public.supplier_ai_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- First calendar day of the billing month (e.g. 2026-09-01).
  billing_month date not null,
  user_id uuid not null
    references public.app_users (id) on delete restrict,
  organization_id uuid
    references public.supplier_organizations (id) on delete set null,
  task_type text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- Application-calculated ESTIMATE only — not an OpenAI invoice amount.
  estimated_cost_usd numeric(12, 6) not null default 0,
  currency text not null default 'USD',
  success boolean not null default false,
  error_code text,
  provider_request_id text,
  latency_ms integer,
  constraint supplier_ai_usage_billing_month_first_day
    check (billing_month = date_trunc('month', billing_month::timestamp)::date),
  constraint supplier_ai_usage_task_type_not_blank
    check (char_length(trim(task_type)) > 0),
  constraint supplier_ai_usage_provider_not_blank
    check (char_length(trim(provider)) > 0),
  constraint supplier_ai_usage_model_not_blank
    check (char_length(trim(model)) > 0),
  constraint supplier_ai_usage_input_tokens_nonneg
    check (input_tokens >= 0),
  constraint supplier_ai_usage_output_tokens_nonneg
    check (output_tokens >= 0),
  constraint supplier_ai_usage_cost_nonneg
    check (estimated_cost_usd >= 0),
  constraint supplier_ai_usage_currency_usd
    check (currency = 'USD'),
  constraint supplier_ai_usage_latency_nonneg
    check (latency_ms is null or latency_ms >= 0)
);

comment on table public.supplier_ai_usage is
  'Append-only Supplier AI usage ledger for cost control. '
  'Stores token counts and application-estimated USD cost only — '
  'never prompts, completions, or API keys.';

comment on column public.supplier_ai_usage.estimated_cost_usd is
  'Application-calculated cost estimate from configured rates. '
  'Not an authoritative provider invoice amount.';

comment on column public.supplier_ai_usage.billing_month is
  'Billing month as the first calendar day (UTC date semantics as stored).';

create index if not exists supplier_ai_usage_created_at_idx
  on public.supplier_ai_usage (created_at desc);

create index if not exists supplier_ai_usage_billing_month_idx
  on public.supplier_ai_usage (billing_month);

create index if not exists supplier_ai_usage_user_created_idx
  on public.supplier_ai_usage (user_id, created_at desc);

create index if not exists supplier_ai_usage_org_created_idx
  on public.supplier_ai_usage (organization_id, created_at desc)
  where organization_id is not null;

create index if not exists supplier_ai_usage_month_cost_idx
  on public.supplier_ai_usage (billing_month, estimated_cost_usd);


-- ----------------------------------------------------------
-- PART B — budget settings (single default row)
-- ----------------------------------------------------------

create table if not exists public.supplier_ai_budget_settings (
  id text primary key default 'default',
  monthly_budget_usd numeric(12, 2) not null,
  warning_ratio numeric(4, 3) not null default 0.800,
  hard_stop boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,
  constraint supplier_ai_budget_settings_id_default
    check (id = 'default'),
  constraint supplier_ai_budget_settings_budget_nonneg
    check (monthly_budget_usd >= 0),
  constraint supplier_ai_budget_settings_warning_ratio
    check (warning_ratio >= 0 and warning_ratio <= 1)
);

comment on table public.supplier_ai_budget_settings is
  'Durable Supplier AI monthly budget settings (single-row). '
  'Env flags may guide ops configuration; enforcement is database-backed.';

insert into public.supplier_ai_budget_settings (
  id,
  monthly_budget_usd,
  warning_ratio,
  hard_stop
)
values (
  'default',
  10.00,   -- conservative USD monthly hard budget seed
  0.800,
  true
)
on conflict (id) do nothing;


-- ----------------------------------------------------------
-- PART C — budget reservations (concurrency-safe hard stop)
-- ----------------------------------------------------------
--
-- Phase 10D gateway flow (application):
--   1) estimate max cost for the proposed call
--   2) CALL supplier_ai_try_reserve_budget(...)  -- atomic
--   3) on refuse → return budget_exhausted (no provider call)
--   4) on ok → call provider
--   5) INSERT supplier_ai_usage (actual estimate from tokens)
--   6) CALL supplier_ai_consume_reservation(...) OR
--           supplier_ai_release_reservation(...) on failure
--
-- Concurrent requests cannot both pass a naive SELECT-then-INSERT race:
-- reservation takes a row lock on budget settings and accounts for
-- finalized usage + active reservations in one transaction.

create table if not exists public.supplier_ai_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  billing_month date not null,
  user_id uuid not null
    references public.app_users (id) on delete restrict,
  reserved_cost_usd numeric(12, 6) not null,
  status text not null default 'reserved',
  usage_id uuid references public.supplier_ai_usage (id) on delete set null,
  expires_at timestamptz not null,
  released_at timestamptz,
  consumed_at timestamptz,
  constraint supplier_ai_budget_reservations_billing_month_first_day
    check (billing_month = date_trunc('month', billing_month::timestamp)::date),
  constraint supplier_ai_budget_reservations_cost_positive
    check (reserved_cost_usd > 0),
  constraint supplier_ai_budget_reservations_status_check
    check (status in ('reserved', 'consumed', 'released', 'expired')),
  constraint supplier_ai_budget_reservations_consumed_needs_usage
    check (
      (status <> 'consumed')
      or (usage_id is not null and consumed_at is not null)
    )
);

comment on table public.supplier_ai_budget_reservations is
  'Short-lived Supplier AI budget holds. Reserved amount counts against '
  'the monthly hard budget until consumed, released, or expired.';

create index if not exists supplier_ai_budget_reservations_month_status_idx
  on public.supplier_ai_budget_reservations (billing_month, status);

create index if not exists supplier_ai_budget_reservations_active_expiry_idx
  on public.supplier_ai_budget_reservations (expires_at)
  where status = 'reserved';


-- ----------------------------------------------------------
-- PART D — atomic reserve / consume / release functions
-- ----------------------------------------------------------

create or replace function public.supplier_ai_billing_month(p_ts timestamptz default now())
returns date
language sql
stable
as $$
  select date_trunc('month', coalesce(p_ts, now()))::date;
$$;

comment on function public.supplier_ai_billing_month(timestamptz) is
  'Returns the first calendar day of the month for p_ts (billing_month key).';

revoke all on function public.supplier_ai_billing_month(timestamptz) from public;
revoke all on function public.supplier_ai_billing_month(timestamptz) from anon, authenticated;
grant execute on function public.supplier_ai_billing_month(timestamptz) to service_role;


create or replace function public.supplier_ai_expire_stale_reservations(
  p_billing_month date default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.supplier_ai_budget_reservations r
  set
    status = 'expired',
    released_at = coalesce(r.released_at, now())
  where r.status = 'reserved'
    and r.expires_at < now()
    and (p_billing_month is null or r.billing_month = p_billing_month);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.supplier_ai_expire_stale_reservations(date) is
  'Marks expired reserved holds as expired so they no longer consume budget.';

revoke all on function public.supplier_ai_expire_stale_reservations(date) from public;
revoke all on function public.supplier_ai_expire_stale_reservations(date) from anon, authenticated;
grant execute on function public.supplier_ai_expire_stale_reservations(date) to service_role;


create or replace function public.supplier_ai_try_reserve_budget(
  p_user_id uuid,
  p_reserved_cost_usd numeric,
  p_billing_month date default null,
  p_ttl_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  v_budget numeric(12, 2);
  v_warning_ratio numeric(4, 3);
  v_hard_stop boolean;
  v_spent numeric(14, 6);
  v_held numeric(14, 6);
  v_ttl integer;
  v_id uuid;
  v_expires timestamptz;
begin
  if p_user_id is null then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'invalid_user',
      'message', 'user_id is required'
    );
  end if;

  if p_reserved_cost_usd is null or p_reserved_cost_usd <= 0 then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'invalid_amount',
      'message', 'reserved_cost_usd must be > 0'
    );
  end if;

  v_month := coalesce(
    p_billing_month,
    public.supplier_ai_billing_month(now())
  );

  if v_month <> date_trunc('month', v_month::timestamp)::date then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'invalid_billing_month',
      'message', 'billing_month must be the first day of a month'
    );
  end if;

  v_ttl := greatest(coalesce(p_ttl_seconds, 120), 15);
  v_ttl := least(v_ttl, 900);

  -- Serialize budget decisions for this settings row.
  select
    s.monthly_budget_usd,
    s.warning_ratio,
    s.hard_stop
  into
    v_budget,
    v_warning_ratio,
    v_hard_stop
  from public.supplier_ai_budget_settings s
  where s.id = 'default'
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'budget_settings_missing',
      'message', 'supplier_ai_budget_settings default row is missing'
    );
  end if;

  perform public.supplier_ai_expire_stale_reservations(v_month);

  select coalesce(sum(u.estimated_cost_usd), 0)
  into v_spent
  from public.supplier_ai_usage u
  where u.billing_month = v_month;

  select coalesce(sum(r.reserved_cost_usd), 0)
  into v_held
  from public.supplier_ai_budget_reservations r
  where r.billing_month = v_month
    and r.status = 'reserved';

  if v_hard_stop
     and (v_spent + v_held + p_reserved_cost_usd) > v_budget then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'budget_exhausted',
      'message', 'Monthly Supplier AI budget would be exceeded',
      'billing_month', v_month,
      'monthly_budget_usd', v_budget,
      'spent_usd', v_spent,
      'reserved_usd', v_held,
      'requested_usd', p_reserved_cost_usd,
      'warning_ratio', v_warning_ratio,
      'hard_stop', v_hard_stop
    );
  end if;

  v_id := gen_random_uuid();
  v_expires := now() + make_interval(secs => v_ttl);

  insert into public.supplier_ai_budget_reservations (
    id,
    billing_month,
    user_id,
    reserved_cost_usd,
    status,
    expires_at
  )
  values (
    v_id,
    v_month,
    p_user_id,
    p_reserved_cost_usd,
    'reserved',
    v_expires
  );

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_id,
    'billing_month', v_month,
    'reserved_cost_usd', p_reserved_cost_usd,
    'expires_at', v_expires,
    'monthly_budget_usd', v_budget,
    'spent_usd', v_spent,
    'reserved_usd', v_held + p_reserved_cost_usd,
    'warning_ratio', v_warning_ratio,
    'hard_stop', v_hard_stop,
    'warning',
      (v_spent + v_held + p_reserved_cost_usd) >= (v_budget * v_warning_ratio)
  );
end;
$$;

comment on function public.supplier_ai_try_reserve_budget(uuid, numeric, date, integer) is
  'Atomically reserves Supplier AI budget for the billing month under a '
  'row lock on budget settings. Counts finalized usage + active holds.';

revoke all on function public.supplier_ai_try_reserve_budget(uuid, numeric, date, integer)
  from public;
revoke all on function public.supplier_ai_try_reserve_budget(uuid, numeric, date, integer)
  from anon, authenticated;
grant execute on function public.supplier_ai_try_reserve_budget(uuid, numeric, date, integer)
  to service_role;


create or replace function public.supplier_ai_consume_reservation(
  p_reservation_id uuid,
  p_usage_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.supplier_ai_budget_reservations%rowtype;
begin
  if p_reservation_id is null or p_usage_id is null then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'invalid_args',
      'message', 'reservation_id and usage_id are required'
    );
  end if;

  select * into v_row
  from public.supplier_ai_budget_reservations
  where id = p_reservation_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'not_found',
      'message', 'reservation not found'
    );
  end if;

  if v_row.status = 'consumed' and v_row.usage_id = p_usage_id then
    return jsonb_build_object('ok', true, 'status', 'consumed', 'idempotent', true);
  end if;

  if v_row.status <> 'reserved' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'invalid_status',
      'message', 'reservation is not in reserved status',
      'status', v_row.status
    );
  end if;

  if not exists (
    select 1 from public.supplier_ai_usage u where u.id = p_usage_id
  ) then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'usage_missing',
      'message', 'usage_id does not exist'
    );
  end if;

  update public.supplier_ai_budget_reservations
  set
    status = 'consumed',
    usage_id = p_usage_id,
    consumed_at = now()
  where id = p_reservation_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'consumed',
    'reservation_id', p_reservation_id,
    'usage_id', p_usage_id
  );
end;
$$;

comment on function public.supplier_ai_consume_reservation(uuid, uuid) is
  'Marks a budget reservation consumed after supplier_ai_usage is inserted. '
  'Reserved hold is replaced by the durable usage row cost.';

revoke all on function public.supplier_ai_consume_reservation(uuid, uuid) from public;
revoke all on function public.supplier_ai_consume_reservation(uuid, uuid) from anon, authenticated;
grant execute on function public.supplier_ai_consume_reservation(uuid, uuid) to service_role;


create or replace function public.supplier_ai_release_reservation(
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_reservation_id is null then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'invalid_args',
      'message', 'reservation_id is required'
    );
  end if;

  select status into v_status
  from public.supplier_ai_budget_reservations
  where id = p_reservation_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'not_found',
      'message', 'reservation not found'
    );
  end if;

  if v_status in ('released', 'expired') then
    return jsonb_build_object('ok', true, 'status', v_status, 'idempotent', true);
  end if;

  if v_status = 'consumed' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'already_consumed',
      'message', 'consumed reservations cannot be released'
    );
  end if;

  update public.supplier_ai_budget_reservations
  set
    status = 'released',
    released_at = now()
  where id = p_reservation_id
    and status = 'reserved';

  return jsonb_build_object(
    'ok', true,
    'status', 'released',
    'reservation_id', p_reservation_id
  );
end;
$$;

comment on function public.supplier_ai_release_reservation(uuid) is
  'Releases an unused reservation (provider failure / cancelled call) so '
  'the hold no longer counts against the monthly budget.';

revoke all on function public.supplier_ai_release_reservation(uuid) from public;
revoke all on function public.supplier_ai_release_reservation(uuid) from anon, authenticated;
grant execute on function public.supplier_ai_release_reservation(uuid) to service_role;


-- ----------------------------------------------------------
-- PART E — privileges + RLS
-- ----------------------------------------------------------

alter table public.supplier_ai_usage enable row level security;
alter table public.supplier_ai_budget_settings enable row level security;
alter table public.supplier_ai_budget_reservations enable row level security;

revoke all on table public.supplier_ai_usage from public, anon, authenticated;
revoke all on table public.supplier_ai_budget_settings from public, anon, authenticated;
revoke all on table public.supplier_ai_budget_reservations from public, anon, authenticated;

-- Authenticated: usage is SELECT-only. Budget settings: SELECT + UPDATE privilege;
-- RLS still restricts UPDATE to is_admin() via supplier_ai_budget_settings_update_admin.
grant select on table public.supplier_ai_usage to authenticated;
grant select, update on table public.supplier_ai_budget_settings to authenticated;
-- Reservations are internal control-plane; no authenticated SELECT.
-- (service_role bypasses RLS and has full access below.)

grant all on table public.supplier_ai_usage to service_role;
grant all on table public.supplier_ai_budget_settings to service_role;
grant all on table public.supplier_ai_budget_reservations to service_role;

-- usage: viewers with supplier_intelligence can SELECT (ops transparency);
-- writes only via service_role (no authenticated write policies).
drop policy if exists supplier_ai_usage_select_permitted
  on public.supplier_ai_usage;
create policy supplier_ai_usage_select_permitted
  on public.supplier_ai_usage for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

-- budget settings: SELECT for supplier viewers; UPDATE admin-only.
drop policy if exists supplier_ai_budget_settings_select_permitted
  on public.supplier_ai_budget_settings;
create policy supplier_ai_budget_settings_select_permitted
  on public.supplier_ai_budget_settings for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_ai_budget_settings_update_admin
  on public.supplier_ai_budget_settings;
create policy supplier_ai_budget_settings_update_admin
  on public.supplier_ai_budget_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No authenticated policies on reservations (service_role only).
-- No authenticated INSERT/UPDATE/DELETE policies on usage.

commit;

-- ============================================================
-- MANUAL ROLLBACK (comments only — do not auto-run)
--
--   revoke execute on function public.supplier_ai_release_reservation(uuid)
--     from service_role;
--   revoke execute on function public.supplier_ai_consume_reservation(uuid, uuid)
--     from service_role;
--   revoke execute on function public.supplier_ai_try_reserve_budget(uuid, numeric, date, integer)
--     from service_role;
--   revoke execute on function public.supplier_ai_expire_stale_reservations(date)
--     from service_role;
--   revoke execute on function public.supplier_ai_billing_month(timestamptz)
--     from service_role;
--
--   drop function if exists public.supplier_ai_release_reservation(uuid);
--   drop function if exists public.supplier_ai_consume_reservation(uuid, uuid);
--   drop function if exists public.supplier_ai_try_reserve_budget(uuid, numeric, date, integer);
--   drop function if exists public.supplier_ai_expire_stale_reservations(date);
--   drop function if exists public.supplier_ai_billing_month(timestamptz);
--
--   drop table if exists public.supplier_ai_budget_reservations;
--   drop table if exists public.supplier_ai_usage;
--   drop table if exists public.supplier_ai_budget_settings;
-- ============================================================
