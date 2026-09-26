-- ==========================================================
-- Migration: 097_whatsapp_assistant_foundation
-- Module: WhatsApp AI Assistant — secure webhook foundation
--
-- Creates only private control-plane records for an explicit WhatsApp-to-ERP
-- user mapping and inbound-message replay/rate-limit handling. It stores no
-- message text, raw Meta payloads, client records, or assistant responses.
--
-- This migration is NOT applied automatically.
-- ==========================================================

begin;

create table if not exists public.whatsapp_user_links (
  id bigint generated always as identity primary key,
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  whatsapp_phone_e164 text not null
    check (whatsapp_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null
);

-- One active WhatsApp identity can resolve to exactly one ERP user.
create unique index if not exists whatsapp_user_links_active_phone_unique
  on public.whatsapp_user_links (whatsapp_phone_e164)
  where is_active;

create unique index if not exists whatsapp_user_links_active_app_user_unique
  on public.whatsapp_user_links (app_user_id)
  where is_active;

comment on table public.whatsapp_user_links is
  'Private explicit WhatsApp-to-app_users mapping. No browser/RLS access; provision or revoke only through a controlled server/admin process.';

create or replace function public.set_whatsapp_user_links_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_whatsapp_user_links_updated_at on public.whatsapp_user_links;
create trigger trg_whatsapp_user_links_updated_at
before update on public.whatsapp_user_links
for each row execute function public.set_whatsapp_user_links_updated_at();

create table if not exists public.whatsapp_inbound_events (
  id bigint generated always as identity primary key,
  meta_message_id text not null unique
    check (char_length(meta_message_id) between 1 and 512),
  sender_phone_e164 text not null
    check (sender_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  message_type text not null
    check (char_length(message_type) between 1 and 64),
  meta_timestamp timestamptz,
  received_at timestamptz not null default now(),
  processing_status text not null default 'received'
    check (processing_status in ('received', 'authorized', 'unauthorized', 'ignored')),
  app_user_id uuid references public.app_users(id) on delete set null
);

create index if not exists whatsapp_inbound_events_sender_received_idx
  on public.whatsapp_inbound_events (sender_phone_e164, received_at desc);

comment on table public.whatsapp_inbound_events is
  'Private replay and rate-limit control-plane data for Meta WhatsApp inbound messages. Never stores message text or raw Meta payloads.';

alter table public.whatsapp_user_links enable row level security;
alter table public.whatsapp_inbound_events enable row level security;

revoke all on table public.whatsapp_user_links from public, anon, authenticated;
revoke all on table public.whatsapp_inbound_events from public, anon, authenticated;
revoke all on sequence public.whatsapp_user_links_id_seq from public, anon, authenticated;
revoke all on sequence public.whatsapp_inbound_events_id_seq from public, anon, authenticated;

grant all on table public.whatsapp_user_links to service_role;
grant all on table public.whatsapp_inbound_events to service_role;
grant usage, select on sequence public.whatsapp_user_links_id_seq to service_role;
grant usage, select on sequence public.whatsapp_inbound_events_id_seq to service_role;

commit;
