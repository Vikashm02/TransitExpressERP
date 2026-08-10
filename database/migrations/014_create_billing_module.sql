-- ==========================================================
-- Migration: 014_create_billing_module
-- Module:    Billing (Tax Invoice generated against selected LRs)
--
-- Reference: components/billing/billing.schema.ts
--            components/services/billing.service.ts
--            components/billingParty/billingParty.schema.ts
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- against the target Supabase project before the Billing module is used.
--
-- Notes:
--   - Purely additive: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
--     EXISTS only. No existing column, table, or row is altered,
--     renamed, or dropped.
--   - `bill_lrs` freezes `weight` / `rate` / `freight` per LR at the
--     moment of billing (per the four Bill Rate Type rules — Loading
--     Weight, POD Unloading Weight, Bill Rate's own Guaranteed Weight,
--     or the flat Fixed rate) so a later LR/POD edit can never silently
--     change the amount on an already-generated Bill.
--   - `unique (lr_id)` on `bill_lrs` enforces "an LR can only ever be
--     billed once" at the database level, in addition to the
--     application-level check against LR status.
--   - Contains zero references to any Lorry Hire column — by design,
--     per the Billing module's "zero dependency on Lorry Hire" rule.
-- ==========================================================

-- Billing Party Master: two new fields, auto-used when creating a Bill.
alter table public.billing_parties
  add column if not exists po_number text not null default '';

alter table public.billing_parties
  add column if not exists concern_person text not null default '';

-- One row per generated Bill (Tax Invoice).
create table if not exists public.bills (
  id bigint generated always as identity primary key,
  bill_number text not null unique,
  bill_date date not null,
  billing_party_id bigint not null references public.billing_parties(id),
  po_number text not null default '',
  total_weight numeric not null default 0,
  total_freight numeric not null default 0,
  grand_total numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bills_billing_party_id on public.bills (billing_party_id);
create index if not exists idx_bills_bill_date on public.bills (bill_date);

-- One row per LR included in a Bill.
create table if not exists public.bill_lrs (
  id bigint generated always as identity primary key,
  bill_id bigint not null references public.bills(id) on delete cascade,
  lr_id uuid not null references public.lrs(id) unique,
  weight numeric not null default 0,
  rate numeric not null default 0,
  freight numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_bill_lrs_bill_id on public.bill_lrs (bill_id);

-- Keeps `updated_at` current on every row update.
create or replace function public.set_bills_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_bills_updated_at on public.bills;

create trigger trg_bills_updated_at
before update on public.bills
for each row
execute function public.set_bills_updated_at();
