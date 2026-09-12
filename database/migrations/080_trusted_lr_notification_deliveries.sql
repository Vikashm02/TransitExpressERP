-- ==========================================================
-- Migration: 080_trusted_lr_notification_deliveries
-- Module: durable per-target delivery ledger for trusted LR notifications
--
-- Apply manually only after production preflight confirms that existing
-- notification_inbox rows do not duplicate (event_id, user_id).
-- ==========================================================

begin;

-- A durable parent-claim timestamp allows a later controlled dispatcher
-- invocation to recover work abandoned by an interrupted Edge Function.
alter table public.notification_events
  add column if not exists dispatch_claimed_at timestamptz;

create table public.notification_deliveries (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.notification_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('inbox', 'browser', 'android')),
  -- Logical IDs only: "inbox", "subscription:<id>", or "device:<id>".
  -- Never persist an FCM token or browser endpoint in this ledger.
  target_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'unknown', 'permanent_failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  attempted_at timestamptz,
  delivered_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id, channel, target_key)
);

create index notification_deliveries_event_idx
  on public.notification_deliveries(event_id, status);

-- The ledger is defence in depth, but inbox is database-local and must also
-- have a direct uniqueness guarantee. A partial index preserves historic rows
-- without an event reference.
create unique index notification_inbox_event_user_unique
  on public.notification_inbox(event_id, user_id)
  where event_id is not null;

alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from public, anon, authenticated;

create or replace function public.set_notification_deliveries_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_notification_deliveries_updated_at on public.notification_deliveries;
create trigger trg_notification_deliveries_updated_at
before update on public.notification_deliveries
for each row
execute function public.set_notification_deliveries_updated_at();

commit;
