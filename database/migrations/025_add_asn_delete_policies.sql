-- ==========================================================
-- Migration: 025_add_asn_delete_policies
-- Module:    ASN Creation — Delete
--
-- Additive RLS / storage policies so authenticated users with
-- `asn_creations` edit permission can delete ASN rows and clean up
-- that ASN's objects in the existing `asn-assets` bucket.
--
-- This file is NOT executed automatically — run it manually against
-- the target Supabase project before ASN Delete is used in production.
-- ==========================================================

-- Table DELETE — same permission key / edit level as UPDATE (024).
drop policy if exists asn_creations_delete on public.asn_creations;

create policy asn_creations_delete
on public.asn_creations
for delete
to authenticated
using (
  public.has_permission('asn_creations', 'edit')
);

-- Storage DELETE — only objects in the existing asn-assets bucket.
-- Application code removes only paths derived from that ASN's URLs.
drop policy if exists asn_assets_delete on storage.objects;

create policy asn_assets_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'asn-assets');
