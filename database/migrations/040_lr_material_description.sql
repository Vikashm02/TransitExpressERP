-- ==========================================================
-- Migration: 040_lr_material_description
-- Module:    LR — staff-entered material description
--
-- Adds lrs.material_description for LR-specific text that is
-- independent of Material Master.description (reference only).
--
-- Additive only. Existing rows receive '' via DEFAULT.
-- Does NOT alter materials, RLS, or unrelated columns.
--
-- This file is NOT executed automatically — run it manually
-- against the target Supabase project before the new field is
-- used in production.
-- ==========================================================

alter table public.lrs
  add column if not exists material_description text not null default '';

comment on column public.lrs.material_description is
  'Staff-entered LR-specific material description. Independent of materials.description.';
