-- ==========================================================
-- Migration: 026_add_lorry_expense_settlement_fields
-- Module:    Lorry Expenses — settlement fields
--
-- Additive columns so Lorry Expenses can own expense/settlement
-- entry (Driver Advance 1/2 dates, Detention, Broker, and the
-- settlement fields previously entered on POD).
--
-- IMPORTANT:
--   - Does NOT drop or alter existing `lorry_expenses` columns.
--   - Does NOT touch `pods` settlement columns (`st_chalan`,
--     `tds_percentage`, `other_deduction`, `balance_paid_on`).
--   - Does NOT copy or rewrite historical POD settlement data.
--
-- Types match migration 017 POD settlement columns:
--   st_chalan numeric, tds_percentage numeric check (0,1),
--   other_deduction numeric, balance_paid_on date.
--
-- This file is NOT executed automatically — run it manually against
-- the target Supabase project before the new Lorry Expenses fields
-- are used in production.
-- ==========================================================

alter table public.lorry_expenses
  add column if not exists driver_advance_1_date date,
  add column if not exists driver_advance_2 numeric not null default 0,
  add column if not exists driver_advance_2_date date,
  add column if not exists detention_charges numeric not null default 0,
  add column if not exists broker_name text not null default '',
  add column if not exists st_chalan numeric not null default 0,
  add column if not exists tds_percentage numeric not null default 0
    check (tds_percentage in (0, 1)),
  add column if not exists other_deduction numeric not null default 0,
  add column if not exists balance_paid_on date;

-- Existing `driver_advance` remains the Driver Advance 1 amount
-- (UI label only). No rename.
