-- ==========================================================
-- Migration: 031_fix_notification_events_insert_rls
-- Module:    notification_events enqueue RLS (insert + returning)
--
-- Additive only. Does NOT modify ERP business tables or historical
-- notification data.
--
-- Root cause addressed:
--   Client inserts with .select("id") (INSERT … RETURNING).
--   INSERT policy allows authenticated inserts, but SELECT policy is
--   (is_app_admin() OR created_by = auth.uid()). If created_by is null
--   or not equal to auth.uid(), RETURNING fails with 42501
--   "new row violates row-level security policy".
--
-- Fix:
--   1) BEFORE INSERT trigger always sets created_by = auth.uid()
--   2) INSERT WITH CHECK requires created_by = auth.uid()
--   Existing SELECT policy unchanged (still own rows / admin).
-- ==========================================================

create or replace function public.set_notification_event_created_by()
returns trigger
language plpgsql
as $$
begin
  -- Always attribute the event to the JWT subject. Client may omit or
  -- mis-set created_by; auth.uid() is the source of truth.
  new.created_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_notification_events_created_by on public.notification_events;
create trigger trg_notification_events_created_by
before insert on public.notification_events
for each row
execute function public.set_notification_event_created_by();

-- Recreate INSERT policy: authenticated may enqueue only as themselves.
drop policy if exists notification_events_insert on public.notification_events;
create policy notification_events_insert on public.notification_events
for insert to authenticated
with check (created_by = auth.uid());

-- SELECT policy intentionally unchanged:
--   is_app_admin() OR created_by = auth.uid()
-- so INSERT … RETURNING works for the inserting user.
