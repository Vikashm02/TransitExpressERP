-- ==========================================================
-- Migration: 003_create_company_settings
-- Module:    Company Master
-- Created:   Phase 8 (Company Master reference implementation)
--
-- Reference: components/company/company.schema.ts
--            components/services/company.service.ts
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- (or via your preferred migration tool) against the target Supabase
-- project before the Company Master module is used.
--
-- Notes:
--   - Company Master is a SINGLETON — exactly one row is expected.
--     `id` is fixed to 1 via a CHECK constraint, matching a standard
--     Postgres singleton-table pattern.
--   - `default_branch`, `default_currency`, and `default_freight_type`
--     are plain text with app-level defaults, NOT database enums,
--     consistent with the same "swappable source" approach used for
--     Vehicle Type.
--   - There is intentionally NO status column on this table.
--   - No seed data / inserts are included in this migration.
-- ==========================================================

create table if not exists public.company_settings (
  id smallint primary key default 1 check (id = 1),

  -- Company Identity
  company_name text not null default '',
  company_short_name text not null default '',
  gstin text not null default '',
  pan text not null default '',
  cin text not null default '',

  -- Contact
  contact_person text not null default '',
  mobile text not null default '',
  alternate_mobile text not null default '',
  email text not null default '',
  website text not null default '',

  -- Address
  address text not null default '',
  city text not null default '',
  state text not null default '',
  pincode text not null default '',

  -- Banking
  account_holder_name text not null default '',
  bank_name text not null default '',
  bank_branch text not null default '',
  account_number text not null default '',
  ifsc text not null default '',
  upi_id text not null default '',

  -- Branding (Supabase Storage URLs — nullable until uploaded)
  logo_url text,
  signature_url text,
  stamp_url text,

  -- Document Settings
  financial_year text not null default '',
  lr_prefix text not null default '',
  invoice_prefix text not null default '',
  voucher_prefix text not null default '',
  lr_prefix_length integer not null default 4,
  invoice_prefix_length integer not null default 4,
  voucher_prefix_length integer not null default 4,

  -- System Defaults
  default_branch text not null default '',
  default_currency text not null default 'INR',
  default_freight_type text not null default 'Paid',
  default_gst_percentage numeric not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_company_settings_company_name on public.company_settings (company_name);
create index if not exists idx_company_settings_company_short_name on public.company_settings (company_short_name);

-- Keeps `updated_at` current on every row update.
create or replace function public.set_company_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_company_settings_updated_at on public.company_settings;

create trigger trg_company_settings_updated_at
before update on public.company_settings
for each row
execute function public.set_company_settings_updated_at();
