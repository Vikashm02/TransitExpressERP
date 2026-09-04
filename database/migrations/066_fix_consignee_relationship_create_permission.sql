-- ==========================================================
-- Migration: 066_fix_consignee_relationship_create_permission
-- Module:    Consignee Relationship Intelligence — INSERT policy fix
--
-- Migration 065 (already applied) gated INSERT with:
--   has_permission('consignee_intelligence', 'create_view')
--
-- Consignee Intelligence module actions are defined as:
--   view | create
-- (see lib/permissions.ts MODULE_SUPPORTED_ACTIONS).
--
-- This additive migration replaces ONLY the INSERT RLS policy so it
-- checks the create action via has_module_action(..., 'create'),
-- matching the UI hasAction('consignee_intelligence', 'create') check.
--
-- Does NOT:
--   - edit migration 065
--   - alter table / columns / indexes / triggers
--   - change SELECT or DELETE policies
--   - change RPCs
--
-- NOT applied automatically — review, then apply manually in Supabase.
-- ==========================================================

drop policy if exists consignee_conversations_insert_permitted
  on public.consignee_conversations;

create policy consignee_conversations_insert_permitted
  on public.consignee_conversations
  for insert
  to authenticated
  with check (public.has_module_action('consignee_intelligence', 'create'));

-- ==========================================================
-- END 066
-- ==========================================================
