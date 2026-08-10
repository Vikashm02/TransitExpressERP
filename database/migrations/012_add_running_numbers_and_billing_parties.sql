-- ==========================================================
-- Migration: 012_add_running_numbers_and_billing_parties
-- Modules:   Company Master (LR / Invoice auto-numbering),
--            Billing Party Master (new)
--
-- Reference: components/company/company.schema.ts
--            components/billingParty/billingParty.schema.ts
--            components/services/company.service.ts
--            components/services/billingParty.service.ts
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- (or via your preferred migration tool) against the target Supabase
-- project before these fields/module are used.
--
-- Notes:
--   - Purely additive: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
--     EXISTS only. No existing column, table, or row is altered,
--     renamed, or dropped.
--   - `lr_running_number` / `invoice_running_number` are separate
--     counters from `lr_prefix_length` / `invoice_prefix_length`
--     (which only control zero-padding width) — see LR Number
--     generation in components/lr/LRListPage.tsx.
--   - `billing_parties` intentionally mirrors `customers` (same
--     shape/conventions) so it can reuse the exact same
--     form/table/lookup patterns, per the Billing Party Master being a
--     separate, admin-managed list rather than a reuse of Customer
--     Master.
-- ==========================================================

alter table public.company_settings
  add column if not exists lr_running_number integer not null default 0;

alter table public.company_settings
  add column if not exists invoice_running_number integer not null default 0;

create table if not exists public.billing_parties (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  gst text not null default '',
  mobile text not null default '',
  email text not null default '',
  city text not null default '',
  address text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_parties_code on public.billing_parties (code);
create index if not exists idx_billing_parties_name on public.billing_parties (name);
create index if not exists idx_billing_parties_status on public.billing_parties (status);

-- Keeps `updated_at` current on every row update.
create or replace function public.set_billing_parties_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_billing_parties_updated_at on public.billing_parties;

create trigger trg_billing_parties_updated_at
before update on public.billing_parties
for each row
execute function public.set_billing_parties_updated_at();
