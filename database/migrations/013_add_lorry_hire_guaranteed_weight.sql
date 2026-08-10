-- Adds the missing `lorry_hire_guaranteed_weight` column to `public.lrs`.
-- Mirrors the existing `guaranteed_weight` column (see 007_create_lrs.sql)
-- exactly in type/nullability/default — Lorry Hire's Guaranteed Weight is
-- independent from Bill Rate's Guaranteed Weight, so it needs its own column.
-- Additive only: does not alter, rename, or touch `guaranteed_weight` or any
-- other existing column/data.

alter table public.lrs
  add column if not exists lorry_hire_guaranteed_weight numeric not null default 0;
