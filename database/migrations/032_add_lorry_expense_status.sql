-- ==========================================================
-- Migration: 032_add_lorry_expense_status
-- Module:    Financials (lorry_expenses) — expense entry status
--
-- Adds expense_status so users can save incomplete Financials
-- entries as Pending and finalize them as Completed later.
--
-- Additive only. Does NOT drop or alter unrelated columns.
-- Existing rows default to 'completed' so historical expenses
-- are not treated as unfinished work.
--
-- This file is NOT executed automatically — run it manually against
-- the target Supabase project before the new status field is used
-- in production.
-- ==========================================================

alter table public.lorry_expenses
  add column if not exists expense_status text not null default 'completed'
    check (expense_status in ('pending', 'completed'));

create index if not exists idx_lorry_expenses_expense_status
  on public.lorry_expenses (expense_status);
