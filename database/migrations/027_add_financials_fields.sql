-- ==========================================================
-- Migration: 027_add_financials_fields
-- Module:    Financials (lorry_expenses) — beneficiary, final
--            payment, remarks
--
-- Additive only. Does NOT drop diesel_advance or any existing
-- columns. Does NOT rewrite historical rows.
--
-- This file is NOT executed automatically — run it manually against
-- the target Supabase project before the new Financials fields are
-- used in production.
-- ==========================================================

alter table public.lorry_expenses
  add column if not exists beneficiary_name text not null default '',
  add column if not exists final_amount_paid numeric not null default 0,
  add column if not exists remarks text not null default '';
