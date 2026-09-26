-- ==========================================================
-- Migration: 098_whatsapp_assistant_access_exclusions
-- Module: WhatsApp Operations Assistant — explicit access exclusions
--
-- Adds a private, revocable server-side exclusion list. It does not create
-- WhatsApp mappings or weaken the approved/unlocked identity checks from 097.
-- This migration is NOT applied automatically.
-- ==========================================================

begin;

create table if not exists public.whatsapp_assistant_access_exclusions (
  app_user_id uuid primary key references public.app_users(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_assistant_access_exclusions is
  'Private trusted-server exclusion list for the WhatsApp Operations Assistant. An active row denies access even if the ERP user is approved, unlocked, and mapped.';

create or replace function public.set_whatsapp_assistant_access_exclusions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_whatsapp_assistant_access_exclusions_updated_at
  on public.whatsapp_assistant_access_exclusions;
create trigger trg_whatsapp_assistant_access_exclusions_updated_at
before update on public.whatsapp_assistant_access_exclusions
for each row execute function public.set_whatsapp_assistant_access_exclusions_updated_at();

-- Explicit permanent exclusion. It is based on the immutable ERP user ID,
-- never display name or current account lock state.
insert into public.whatsapp_assistant_access_exclusions (app_user_id, is_active)
values ('4a5e8b1a-430f-4cfc-9145-29d54783cf75', true)
on conflict (app_user_id) do update
  set is_active = true;

alter table public.whatsapp_assistant_access_exclusions enable row level security;

revoke all on table public.whatsapp_assistant_access_exclusions
  from public, anon, authenticated;

grant all on table public.whatsapp_assistant_access_exclusions to service_role;

commit;
