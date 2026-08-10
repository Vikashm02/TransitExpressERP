-- ==========================================================
-- Migration: 010_rename_lr_packaging_columns
-- Module:    LR Master
-- Created:   Phase 13.2 (LR Master — live schema catch-up, round 3)
--
-- Reference: database/migrations/007_create_lrs.sql
--            database/migrations/009_update_lrs_schema.sql
--            components/services/lr.service.ts
--
-- Purpose: the live `public.lrs` table already stores this data, but under
-- legacy column names from before 007_create_lrs.sql was written:
--   packaging -> should be package_type
--   articles  -> should be packages
--
-- The application (lr.service.ts / lr.schema.ts) only ever reads/writes
-- `package_type` and `packages`. Adding new columns under those names
-- (as 009 originally attempted) would create empty duplicates alongside
-- the legacy, populated ones instead of reconciling them — 009 has been
-- corrected to exclude both.
--
-- This migration renames the two legacy columns in place. RENAME COLUMN
-- only changes the identifier — it does NOT change type, nullability,
-- default, or any existing constraint. Before applying, verify (e.g. via
-- the Supabase SQL Editor, since this agent has no service-role/schema
-- access to confirm it directly):
--   1. `articles` is numeric-compatible (matches `packages numeric not
--      null default 0` in 007_create_lrs.sql). If it's `text` or another
--      non-numeric type, a type conversion (`alter column ... type
--      numeric using articles::numeric`) will additionally be required —
--      not included here since it wasn't requested and isn't safe to
--      guess blindly.
--   2. Neither column carries a CHECK/UNIQUE constraint tied to old
--      "packaging"/"articles" semantics that would reject values the app
--      now sends under the new names.
--   3. Whether either column allows NULL where 007 expects NOT NULL —
--      if so, existing NULL rows should be backfilled before/along with
--      tightening the constraint (also not included here, as it risks
--      being unsafe without knowing current data).
--
-- This migration performs renames only — no type change, no constraint
-- change, no data backfill, no table recreation.
-- ==========================================================

alter table public.lrs
  rename column packaging to package_type;

alter table public.lrs
  rename column articles to packages;
