-- ==========================================================
-- Migration: 048_creator_only_delete
-- Module:    ERP-wide DELETE — Creator only (corrects 047)
--
-- Context:
--   Migration 047 gated DELETE with public.is_admin(), which is true
--   for Creator AND Tier 1 (role = 'admin'). Final product rule:
--   user-facing DELETE is Creator-only.
--
--   Tier 1 / Tier 2 must not DELETE ERP records via RLS.
--   public.is_admin() is intentionally left unchanged for all other
--   Creator+Tier-1 module administrator behavior.
--
-- Changes:
--   1) Replace ERP DELETE policies from is_admin() → is_creator().
--   2) ASN storage DELETE → is_creator().
--
-- Does NOT modify:
--   - public.is_admin() / isAdmin meaning
--   - SELECT / INSERT / UPDATE policies
--   - discard_own_lr_draft / discard_unlined_bill / rollback_upload_batch
--     (narrow compensation RPCs — not general delete)
--   - LR numbering, Financials RPCs, existing data
--
-- NOT executed automatically — run manually against Supabase.
-- ==========================================================


-- ----------------------------------------------------------
-- PART A — Operational tables
-- ----------------------------------------------------------

drop policy if exists lrs_delete_admin_only on public.lrs;
drop policy if exists lrs_delete_creator_only on public.lrs;
drop policy if exists lrs_delete_permitted on public.lrs;
create policy lrs_delete_creator_only
  on public.lrs
  for delete
  to authenticated
  using (public.is_creator());

drop policy if exists pods_delete_admin_only on public.pods;
drop policy if exists pods_delete_creator_only on public.pods;
drop policy if exists pods_delete_permitted on public.pods;
create policy pods_delete_creator_only
  on public.pods
  for delete
  to authenticated
  using (public.is_creator());

drop policy if exists delivery_challans_delete_admin_only on public.delivery_challans;
drop policy if exists delivery_challans_delete_creator_only on public.delivery_challans;
drop policy if exists delivery_challans_delete_permitted on public.delivery_challans;
create policy delivery_challans_delete_creator_only
  on public.delivery_challans
  for delete
  to authenticated
  using (public.is_creator());

drop policy if exists asn_creations_delete_admin_only on public.asn_creations;
drop policy if exists asn_creations_delete_creator_only on public.asn_creations;
drop policy if exists asn_creations_delete on public.asn_creations;
create policy asn_creations_delete_creator_only
  on public.asn_creations
  for delete
  to authenticated
  using (public.is_creator());

drop policy if exists lorry_expenses_delete_admin_only on public.lorry_expenses;
drop policy if exists lorry_expenses_delete_creator_only on public.lorry_expenses;
drop policy if exists lorry_expenses_delete_permitted on public.lorry_expenses;
create policy lorry_expenses_delete_creator_only
  on public.lorry_expenses
  for delete
  to authenticated
  using (public.is_creator());


-- ----------------------------------------------------------
-- PART B — ASN storage DELETE
-- ----------------------------------------------------------

drop policy if exists asn_assets_delete on storage.objects;
create policy asn_assets_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'asn-assets'
    and public.is_creator()
  );


-- ----------------------------------------------------------
-- PART C — Masters / billing tables (enabled in 047)
-- ----------------------------------------------------------

drop policy if exists customers_delete_admin_only on public.customers;
drop policy if exists customers_delete_creator_only on public.customers;
create policy customers_delete_creator_only
  on public.customers for delete to authenticated
  using (public.is_creator());

drop policy if exists billing_parties_delete_admin_only on public.billing_parties;
drop policy if exists billing_parties_delete_creator_only on public.billing_parties;
create policy billing_parties_delete_creator_only
  on public.billing_parties for delete to authenticated
  using (public.is_creator());

drop policy if exists vehicles_delete_admin_only on public.vehicles;
drop policy if exists vehicles_delete_creator_only on public.vehicles;
create policy vehicles_delete_creator_only
  on public.vehicles for delete to authenticated
  using (public.is_creator());

drop policy if exists materials_delete_admin_only on public.materials;
drop policy if exists materials_delete_creator_only on public.materials;
create policy materials_delete_creator_only
  on public.materials for delete to authenticated
  using (public.is_creator());

drop policy if exists drivers_delete_admin_only on public.drivers;
drop policy if exists drivers_delete_creator_only on public.drivers;
create policy drivers_delete_creator_only
  on public.drivers for delete to authenticated
  using (public.is_creator());

drop policy if exists transporters_delete_admin_only on public.transporters;
drop policy if exists transporters_delete_creator_only on public.transporters;
create policy transporters_delete_creator_only
  on public.transporters for delete to authenticated
  using (public.is_creator());

drop policy if exists bills_delete_admin_only on public.bills;
drop policy if exists bills_delete_creator_only on public.bills;
create policy bills_delete_creator_only
  on public.bills for delete to authenticated
  using (public.is_creator());

drop policy if exists bill_lrs_delete_admin_only on public.bill_lrs;
drop policy if exists bill_lrs_delete_creator_only on public.bill_lrs;
create policy bill_lrs_delete_creator_only
  on public.bill_lrs for delete to authenticated
  using (public.is_creator());

drop policy if exists credit_notes_delete_admin_only on public.credit_notes;
drop policy if exists credit_notes_delete_creator_only on public.credit_notes;
create policy credit_notes_delete_creator_only
  on public.credit_notes for delete to authenticated
  using (public.is_creator());

drop policy if exists debit_notes_delete_admin_only on public.debit_notes;
drop policy if exists debit_notes_delete_creator_only on public.debit_notes;
create policy debit_notes_delete_creator_only
  on public.debit_notes for delete to authenticated
  using (public.is_creator());

-- ==========================================================
-- END 048
-- ==========================================================
