-- ==========================================================
-- Migration: 028_notifications_announcements_pwa
-- Module:    Admin Notification Settings + Announcements + Push
--
-- Additive only. Does NOT alter existing ERP business tables'
-- columns except no business columns are touched — new tables only.
--
-- Apply manually in Supabase SQL Editor before using Settings.
-- After applying, deploy Edge Function `process-notifications` and
-- schedule it (see docs/NOTIFICATIONS_SETUP.md).
-- ==========================================================

-- ---------- Notification rules (Admin toggles) ----------
create table if not exists public.notification_rules (
  id bigint generated always as identity primary key,
  rule_key text not null unique,
  category text not null,
  name text not null,
  description text not null default '',
  enabled boolean not null default true,
  -- 'immediate' | 'scheduled'
  delivery_mode text not null default 'immediate'
    check (delivery_mode in ('immediate', 'scheduled')),
  -- Local time HH:MM (24h) used when delivery_mode = 'scheduled'
  scheduled_time text not null default '08:00',
  -- Future targeting: 'all' | 'role' | 'user' (only 'all' used initially)
  target_scope text not null default 'all'
    check (target_scope in ('all', 'role', 'user')),
  target_role text,
  target_user_id uuid,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_notification_rules_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_notification_rules_updated_at on public.notification_rules;
create trigger trg_notification_rules_updated_at
before update on public.notification_rules
for each row execute function public.set_notification_rules_updated_at();

-- ---------- Push subscriptions ----------
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

-- ---------- Outbox / event queue ----------
create table if not exists public.notification_events (
  id bigint generated always as identity primary key,
  rule_key text not null,
  title text not null,
  body text not null default '',
  href text not null default '/',
  -- pending | processing | sent | failed | cancelled
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  -- When this event becomes eligible for delivery (immediate = now)
  deliver_after timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_by uuid,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_notification_events_pending
  on public.notification_events (status, deliver_after);

-- ---------- In-app notification history ----------
create table if not exists public.notification_inbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id bigint references public.notification_events (id) on delete set null,
  title text not null,
  body text not null default '',
  href text not null default '/',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_inbox_user
  on public.notification_inbox (user_id, created_at desc);

-- ---------- Announcements ----------
create table if not exists public.announcements (
  id bigint generated always as identity primary key,
  title text not null,
  message text not null default '',
  image_url text,
  -- home | financials | lr | pod | delivery_challans | all
  display_location text not null default 'home',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  -- soft archive instead of hard delete
  archived_at timestamptz,
  -- bumped on edit so dismissed banners can reappear when content changes
  content_version text not null default '1',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_announcements_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at
before update on public.announcements
for each row execute function public.set_announcements_updated_at();

create table if not exists public.announcement_dismissals (
  id bigint generated always as identity primary key,
  announcement_id bigint not null references public.announcements (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- bumps when announcement content changes so it can reappear
  content_version text not null default '1',
  dismissed_at timestamptz not null default now(),
  unique (announcement_id, user_id, content_version)
);

-- ---------- Seed practical default rules ----------
insert into public.notification_rules (rule_key, category, name, description, enabled, delivery_mode, scheduled_time, sort_order)
values
  ('lr.created', 'LR', 'LR Created', 'When a new Lorry Receipt is created.', true, 'immediate', '08:00', 10),
  ('lr.updated', 'LR', 'LR Edited', 'When an existing Lorry Receipt is updated.', true, 'immediate', '08:00', 20),
  ('lr.deleted', 'LR', 'LR Deleted', 'When a Lorry Receipt is deleted.', false, 'immediate', '08:00', 30),
  ('dc.created', 'Delivery Challan', 'Delivery Challan Created', 'When a Delivery Challan is created.', true, 'immediate', '08:00', 40),
  ('dc.updated', 'Delivery Challan', 'Delivery Challan Edited', 'When a Delivery Challan is updated.', false, 'immediate', '08:00', 50),
  -- dc.deleted is reserved: no Delivery Challan delete service/UI exists yet; leave disabled/untriggered.
  ('dc.deleted', 'Delivery Challan', 'Delivery Challan Deleted', 'Reserved for future DC delete. No delete hook yet.', false, 'immediate', '08:00', 60),
  ('pod.created', 'POD', 'POD Created', 'When a POD is created.', true, 'immediate', '08:00', 70),
  ('pod.updated', 'POD', 'POD Edited', 'When a POD is updated.', false, 'immediate', '08:00', 80),
  ('pod.deleted', 'POD', 'POD Deleted', 'When a POD is deleted.', false, 'immediate', '08:00', 90),
  ('pod.proof_uploaded', 'POD', 'POD Proof Uploaded', 'When a Proof of POD file is uploaded.', true, 'immediate', '08:00', 100),
  ('financials.created', 'Financials', 'Financial Entry Created', 'When Financials are saved for an LR.', true, 'immediate', '08:00', 110),
  ('financials.updated', 'Financials', 'Financial Entry Edited', 'When Financials are updated.', true, 'immediate', '08:00', 120),
  ('financials.settlement_updated', 'Financials', 'Settlement Updated', 'When settlement fields change on Financials.', true, 'immediate', '08:00', 130)
on conflict (rule_key) do nothing;

-- ---------- RLS ----------
alter table public.notification_rules enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_events enable row level security;
alter table public.notification_inbox enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_dismissals enable row level security;

-- Helpers: reuse app_users.role = 'admin'
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users u
    where u.id = auth.uid() and u.role = 'admin'
  );
$$;

-- Rules: everyone authenticated can read (to know enabled state); only admin writes
drop policy if exists notification_rules_select on public.notification_rules;
create policy notification_rules_select on public.notification_rules
for select to authenticated using (true);

drop policy if exists notification_rules_admin_write on public.notification_rules;
create policy notification_rules_admin_write on public.notification_rules
for all to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

-- Push subscriptions: own rows only
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Events: authenticated may insert (emit); select own/admin; updates via service role / admin
drop policy if exists notification_events_insert on public.notification_events;
create policy notification_events_insert on public.notification_events
for insert to authenticated
with check (true);

drop policy if exists notification_events_select on public.notification_events;
create policy notification_events_select on public.notification_events
for select to authenticated
using (public.is_app_admin() or created_by = auth.uid());

-- Inbox: own rows
drop policy if exists notification_inbox_own on public.notification_inbox;
create policy notification_inbox_own on public.notification_inbox
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Announcements: all approved users read active; admin writes
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
for select to authenticated using (true);

drop policy if exists announcements_admin_write on public.announcements;
create policy announcements_admin_write on public.announcements
for all to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

drop policy if exists announcement_dismissals_own on public.announcement_dismissals;
create policy announcement_dismissals_own on public.announcement_dismissals
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Storage: announcement images for company announcements.
-- Bucket is intentionally PUBLIC so banner <img> tags can use getPublicUrl()
-- without signed URLs. Upload/update/delete remain admin-only via RLS.
insert into storage.buckets (id, name, public)
values ('announcement-assets', 'announcement-assets', true)
on conflict (id) do nothing;

drop policy if exists announcement_assets_insert on storage.objects;
create policy announcement_assets_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'announcement-assets' and public.is_app_admin());

drop policy if exists announcement_assets_select on storage.objects;
create policy announcement_assets_select
on storage.objects for select to authenticated
using (bucket_id = 'announcement-assets');

drop policy if exists announcement_assets_update on storage.objects;
create policy announcement_assets_update
on storage.objects for update to authenticated
using (bucket_id = 'announcement-assets' and public.is_app_admin());

drop policy if exists announcement_assets_delete on storage.objects;
create policy announcement_assets_delete
on storage.objects for delete to authenticated
using (bucket_id = 'announcement-assets' and public.is_app_admin());
