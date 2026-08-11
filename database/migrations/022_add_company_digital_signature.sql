-- ==========================================================
-- Migration: 022_add_company_digital_signature
-- Module:    Company Master
--
-- Reference: components/company/company.schema.ts
--            components/services/company.service.ts
--            components/company/DigitalSignaturePad.tsx
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- (or via your preferred migration tool) against the target Supabase
-- project before this field is used.
--
-- Notes:
--   - Purely additive: ADD COLUMN IF NOT EXISTS only. No existing
--     column, table, or row is altered, renamed, or dropped.
--   - `digital_signature_url` is a NEW, separate field from the
--     existing `signature_url` ("Authorized Signature" upload) — it
--     stores a drawn (signature-pad/canvas) signature exported as a
--     PNG and uploaded to the same "company-assets" Storage bucket,
--     under its own `digital-signature/` path (see
--     uploadCompanyAsset() in company.service.ts). Nullable, same as
--     the other Branding URL columns, until a signature is drawn and
--     saved.
-- ==========================================================

alter table public.company_settings
  add column if not exists digital_signature_url text;
