-- ==========================================================
-- Migration: 008_update_lrs_schema
-- Module:    LR Master
-- Created:   Phase 13.2 (LR Master — live schema catch-up)
--
-- Reference: components/services/lr.service.ts
--
-- Purpose: the live `public.lrs` table (created out-of-band, outside any
-- committed migration) is missing the three computed commercial columns
-- that `007_create_lrs.sql` already documents and that `lr.service.ts`
-- unconditionally writes/reads on every create/update/read. This surfaced
-- as a live 400 from PostgREST:
--   PGRST204: Could not find the 'bill_amount' column of 'lrs' in the
--   schema cache
--
-- This migration only ALTERs the existing table — it does not recreate,
-- drop, or touch any other column. Safe to run multiple times
-- (`add column if not exists`).
-- ==========================================================

alter table public.lrs
  add column if not exists bill_amount numeric not null default 0,
  add column if not exists lorry_hire_amount numeric not null default 0,
  add column if not exists profit_amount numeric not null default 0;
