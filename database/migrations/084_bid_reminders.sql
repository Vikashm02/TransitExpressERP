-- ==========================================================
-- Migration: 084_bid_reminders
-- Module:    Bid Management reminders (Phase 1)
--
-- REVIEW ONLY: do NOT apply automatically. Manual review first.
-- Scheduler activation (pg_cron job + Vault secret) is a separate
-- MANUAL step documented at the bottom of this file and must NOT
-- be executed as part of applying the schema.
--
-- Additive only: creates public.bid_reminders, two triggers
-- (one on bid_reminders, one on transport_bids), two helper
-- functions. No existing table altered, no backfill.
--
-- Design notes:
-- * One row per reminder: multiple independent reminders per bid.
-- * Rows are never hard-deleted by normal UI flow; Cancel/Expire/
--   Sent/Failed preserve history. Cancel means Scheduled -> Cancelled.
-- * Duplicate protection covers Scheduled AND Sending per
--   (bid, user, time), so two users may hold the same bid/time.
-- * Recipient is always the reminder owner (bid_reminders.user_id);
--   no broadcast, no team assignment in Phase 1.
-- * Missed-reminder policy is enforced by the dispatcher, not the
--   database: send if <= 15 minutes late, otherwise Expired.
-- * Terminal states: Sent, Cancelled, Expired, Failed. Only
--   Scheduled (and recoverable stale Sending) is ever dispatched.
-- ==========================================================

begin;

create table public.bid_reminders (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.transport_bids(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  remind_at timestamptz not null,
  status text not null default 'Scheduled'
    check (status in ('Scheduled', 'Sending', 'Sent', 'Cancelled', 'Expired', 'Failed')),
  cancel_requested boolean not null default false,
  claimed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  failure_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);

-- No duplicate identical ACTIVE reminder for the same bid/user/time.
-- Covers Scheduled AND Sending so a reminder being processed cannot
-- be duplicated by a concurrent create. Other users' rows never
-- conflict; terminal rows never conflict.
create unique index bid_reminders_active_unique
  on public.bid_reminders (bid_id, user_id, remind_at)
  where status in ('Scheduled', 'Sending');
create index bid_reminders_due
  on public.bid_reminders (status, remind_at);
create index bid_reminders_stale
  on public.bid_reminders (status, claimed_at);
create index bid_reminders_bid
  on public.bid_reminders (bid_id);

alter table public.bid_reminders enable row level security;
revoke all on public.bid_reminders from anon, authenticated;
grant select, insert, update on public.bid_reminders to authenticated;

-- Owner-only access, additionally gated on Bids view access evaluated
-- for the CALLER (auth.uid() is the caller here, so the existing
-- helpers are correct in RLS policies — unlike service-role dispatch).
create policy bid_reminders_owner_select on public.bid_reminders
  for select to authenticated
  using (user_id = auth.uid() and public.has_permission('bids', 'view'));
create policy bid_reminders_owner_insert on public.bid_reminders
  for insert to authenticated
  with check (user_id = auth.uid() and public.has_permission('bids', 'view'));
create policy bid_reminders_owner_update on public.bid_reminders
  for update to authenticated
  using (user_id = auth.uid() and public.has_permission('bids', 'view'))
  with check (user_id = auth.uid() and public.has_permission('bids', 'view'));
-- No delete policy: Cancel (Scheduled -> Cancelled) preserves history.

-- State-machine + audit anti-spoofing for normal authenticated users.
-- Service role (auth.uid() null: dispatcher, lifecycle trigger) passes
-- through untouched so server maintenance keeps working.
create or replace function public.bid_reminder_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Service role: dispatcher claim/recovery/finish + lifecycle trigger.
  -- Only refresh the timestamp; never touch identity or state.
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Clients supply only bid_id + remind_at; everything else is forced.
    new.user_id := auth.uid();
    new.status := 'Scheduled';
    new.cancel_requested := false;
    new.claimed_at := null;
    new.attempt_count := 0;
    new.failure_code := null;
    new.sent_at := null;
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE by a normal user: pin identity/audit first.
  new.id := old.id;
  new.user_id := old.user_id;
  new.bid_id := old.bid_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_by := auth.uid();
  new.updated_at := now();

  -- Reschedule: Scheduled -> Scheduled, remind_at only.
  if old.status = 'Scheduled' and new.status = 'Scheduled' then
    new.cancel_requested := false;
    new.claimed_at := null;
    new.attempt_count := old.attempt_count;
    new.failure_code := old.failure_code;
    new.sent_at := null;
    return new;
  end if;

  -- Cancel: Scheduled -> Cancelled, nothing else may change.
  if old.status = 'Scheduled' and new.status = 'Cancelled' then
    new.remind_at := old.remind_at;
    new.cancel_requested := false;
    new.claimed_at := null;
    new.attempt_count := old.attempt_count;
    new.failure_code := old.failure_code;
    new.sent_at := null;
    return new;
  end if;

  -- Cancel request while in flight: only the flag may change.
  if old.status = 'Sending' and new.status = 'Sending' and new.cancel_requested = true then
    new.remind_at := old.remind_at;
    new.attempt_count := old.attempt_count;
    new.claimed_at := old.claimed_at;
    new.failure_code := old.failure_code;
    new.sent_at := null;
    return new;
  end if;

  -- Anything else (Sending/Sent/Expired/Failed/Cancelled forged states,
  -- attempt/claim/failure/sent timestamps) is rejected.
  raise exception 'Reminder update not allowed in its current state';
end;
$$;
revoke all on function public.bid_reminder_before_write() from public, anon, authenticated;

drop trigger if exists trg_bid_reminders_before_write on public.bid_reminders;
create trigger trg_bid_reminders_before_write
  before insert or update on public.bid_reminders
  for each row execute function public.bid_reminder_before_write();

create or replace function public.set_bid_reminders_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.set_bid_reminders_updated_at() from public, anon, authenticated;

-- NOTE: trg_bid_reminders_before_write already refreshes updated_at on
-- every write; this second trigger is intentionally omitted to avoid
-- double-firing. (Kept as documentation of the decision.)

-- Atomic claim for exactly one dispatcher worker. The single UPDATE is
-- the mutual-exclusion point: only a Scheduled row below the attempt
-- ceiling transitions, and only the worker receiving the RETURNED row
-- may continue. Concurrent workers receive zero rows and skip.
create or replace function public.claim_bid_reminder(p_reminder_id uuid)
returns setof public.bid_reminders
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.bid_reminders
  set status = 'Sending',
    claimed_at = now(),
    attempt_count = attempt_count + 1,
    updated_at = now()
  where id = p_reminder_id
    and status = 'Scheduled'
    and attempt_count < 3
  returning *;
end;
$$;
revoke all on function public.claim_bid_reminder(uuid) from public, anon, authenticated;
grant execute on function public.claim_bid_reminder(uuid) to service_role;

-- Bid lifecycle: leaving Live cancels still-Scheduled reminders and
-- flags already-claimed (Sending) ones so the dispatcher aborts them
-- before any external send. Fail-open (warning only) so reminder
-- housekeeping can never break the primary bid update. Reopening to
-- Live resurrects nothing.
create or replace function public.cancel_bid_reminders_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and coalesce(old.status, '') = 'Live'
    and coalesce(new.status, '') in ('Won', 'Lost', 'Cancelled', 'Not Submitted') then
    begin
      update public.bid_reminders
      set status = 'Cancelled',
        updated_at = now()
      where bid_id = new.id
        and status = 'Scheduled';
      update public.bid_reminders
      set cancel_requested = true,
        updated_at = now()
      where bid_id = new.id
        and status = 'Sending';
    exception
      when others then
        raise warning 'Bid reminder auto-cancel skipped (SQLSTATE %) for bid %', SQLSTATE, new.id;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.cancel_bid_reminders_on_close() from public, anon, authenticated;

drop trigger if exists trg_transport_bids_cancel_reminders on public.transport_bids;
create trigger trg_transport_bids_cancel_reminders
  after update on public.transport_bids
  for each row execute function public.cancel_bid_reminders_on_close();

commit;

-- ==========================================================
-- MANUAL SCHEDULER ACTIVATION (do NOT run automatically):
--
-- 1. Enable pg_cron, pg_net, supabase_vault in the project.
-- 2. Deploy supabase/functions/process-bid-reminders.
-- 3. Store a current project Secret API key in Vault as
--    bid_reminder_scheduler_api_key (key never in Git/responses).
-- 4. Then run (adds ~43,200 invocations/month at 1/minute):
--
-- select cron.schedule(
--   'bid-reminder-dispatcher-v1',
--   '* * * * *',
--   $cron$
--     select net.http_post(
--       url := '<SUPABASE_URL>/functions/v1/process-bid-reminders',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'apikey', (
--           select decrypted_secret from vault.decrypted_secrets
--           where name = 'bid_reminder_scheduler_api_key')),
--       body := '{"mode":"scheduled"}'::jsonb,
--       timeout_milliseconds := 10000);
--   $cron$
-- );
-- ==========================================================
