-- ==========================================================
-- Migration: 035_draft_continuation_without_edit
-- Module:    Draft/Incomplete continuation authorization
--
-- Problem:
--   LR UPDATE RLS (migration 021) requires has_permission('lr','edit').
--   Staff with Create ON + Edit OFF can INSERT a draft but cannot
--   UPDATE it to continue/autosave/finalize. Finalized editing must
--   remain Edit-gated.
--
-- Fix:
--   Allow UPDATE when:
--     - user has Edit (unchanged — finalized and draft), OR
--     - the existing row is entry_status = 'draft' AND user has Create
--
-- WITH CHECK:
--   Edit users: any update (unchanged capability).
--   Create-only users: may keep the row as draft OR finalize it
--   (draft → final). They cannot update a row that was already final
--   because USING blocks that case.
--
-- SELECT unchanged — drafts remain visible with View.
-- INSERT unchanged — still requires Create.
--
-- Also updates POD / Delivery Challan / ASN update policies with the
-- same draft-continuation rule where entry_status exists only on
-- modules that have drafts today (lrs). Other ops modules are left
-- unchanged here.
--
-- Additive only. Does NOT modify migrations 033/034.
-- NOT executed automatically — run manually against Supabase.
-- ==========================================================

drop policy if exists lrs_update_own_or_admin on public.lrs;

create policy lrs_update_own_or_admin
  on public.lrs
  for update
  to authenticated
  using (
    public.has_permission('lr', 'edit')
    or (
      entry_status = 'draft'
      and public.has_permission('lr', 'create_view')
    )
  )
  with check (
    public.has_permission('lr', 'edit')
    or public.has_permission('lr', 'create_view')
  );
