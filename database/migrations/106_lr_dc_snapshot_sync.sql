-- ==========================================================
-- Migration: 106_lr_dc_snapshot_sync
-- Module:    LR -> Delivery Challan automatic snapshot sync
--
-- WHAT THIS IS
--   - Behavioral DB migration.
--   - Adds ONE trigger function (public.sync_delivery_challans_from_lr)
--     and ONE AFTER UPDATE trigger on public.lrs.
--
-- WHAT THIS IS NOT
--   - No table columns added/dropped/altered.
--   - No rows deleted.
--   - No automatic backfill / repair of existing stale DCs
--     (e.g. historical LR19612 rows are NOT rewritten by this file).
--   - No LR renumbering / allocation logic changes.
--   - No PO identity or PO validation changes.
--   - No RLS policy weakening or change.
--   - No purchase_orders rows touched.
--   - No frontend notification events emitted.
--
-- BEHAVIOR (additive, system-owned)
--   Whenever an LR row is updated and the FINAL persisted row is
--   entry_status='final', every delivery_challans row linked by the
--   existing text key `lr_number` is rewritten so its LR-owned
--   snapshot columns follow the FINAL persisted LR values:
--
--     delivery_challans.lr_date        <- lrs.lr_date
--     delivery_challans.consignor      <- lrs.consignor
--     delivery_challans.consignor_address <- lrs.consignor_address
--     delivery_challans.consignor_gst  <- lrs.consignor_gst
--     delivery_challans.consignee      <- lrs.consignee
--     delivery_challans.consignee_address <- lrs.consignee_address
--     delivery_challans.consignee_gst  <- lrs.consignee_gst
--     delivery_challans.description    <- lrs.material
--     delivery_challans.qty            <- lrs.loading_weight
--     delivery_challans.vehicle_number <- lrs.vehicle_number
--     delivery_challans.po_number      <- lrs.po_number
--     delivery_challans.po_date        <- lrs.po_date (NULL-preserving)
--
--   DC-owned/manual columns are NEVER overwritten:
--     delivery_challans.by_name, delivery_challans.hsn
--   DC identity/server-owned columns (id, created_at, created_by)
--   are never written; updated_at / updated_by continue to be
--   maintained by the existing DC audit/updated_at triggers.
--
-- PO DATE NULL EDGE CASE
--   delivery_challans.po_date is NOT NULL while lrs.po_date is
--   nullable. When the final persisted LR has po_date IS NULL, the
--   existing DC po_date is preserved. This migration never writes
--   NULL into delivery_challans.po_date and never loosens the
--   constraint.
--
-- ATOMICITY
--   The DC UPDATE executes inside the same transaction as the LR
--   UPDATE (trigger semantics). A real DC update failure rolls back
--   the LR UPDATE too.
--
-- PERMISSIONS / SECURITY
--   The function is SECURITY DEFINER only because automatic DC
--   synchronization is a system consequence of an ALREADY-authorized
--   LR UPDATE. Authorization remains gated exclusively by the
--   existing LR UPDATE policies (lrs_update_own_or_admin) and the
--   permission checks inside the LR RPCs. This function must not
--   become a direct-call capability; EXECUTE is revoked from
--   PUBLIC/anon/authenticated (trigger firing does not require an
--   EXECUTE grant). search_path is fixed; all objects are
--   schema-qualified; no dynamic SQL; no user-controlled object
--   names. delivery_challans RLS policies are untouched.
--
-- CHANGE GUARD
--   No-op when the update is unrelated to the synchronized snapshot
--   (e.g. status-only or bill_amount-only edits): the WHEN clause +
--   in-function IS DISTINCT FROM guard only proceed when at least
--   one synchronized source column changed, OR the row transitioned
--   into entry_status='final' (draft->final must sync even if the
--   visible values are unchanged).
--
-- NOT EXECUTED AUTOMATICALLY - run manually against Supabase.
-- ==========================================================

create or replace function public.sync_delivery_challans_from_lr()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean;
begin
  -- Only finalized LRs own active DC snapshots. Ordinary draft edits
  -- never synchronize.
  if new.entry_status is distinct from 'final' then
    return new;
  end if;

  v_changed :=
    -- draft/non-final -> final must always be allowed to sync,
    -- even when the visible snapshot values did not change.
    old.entry_status is distinct from 'final'
    or old.lr_date            is distinct from new.lr_date
    or old.consignor          is distinct from new.consignor
    or old.consignor_address  is distinct from new.consignor_address
    or old.consignor_gst      is distinct from new.consignor_gst
    or old.consignee          is distinct from new.consignee
    or old.consignee_address  is distinct from new.consignee_address
    or old.consignee_gst      is distinct from new.consignee_gst
    or old.material           is distinct from new.material
    or old.loading_weight     is distinct from new.loading_weight
    or old.vehicle_number     is distinct from new.vehicle_number
    or old.po_number          is distinct from new.po_number
    or old.po_date            is distinct from new.po_date;

  if not v_changed then
    return new;
  end if;

  -- No LR number -> nothing can be linked.
  if new.lr_number is null or btrim(new.lr_number) = '' then
    return new;
  end if;

  update public.delivery_challans as dc
  set
    lr_date           = new.lr_date,
    consignor         = new.consignor,
    consignor_address = new.consignor_address,
    consignor_gst     = new.consignor_gst,
    consignee         = new.consignee,
    consignee_address = new.consignee_address,
    consignee_gst     = new.consignee_gst,
    description       = new.material,
    qty               = new.loading_weight,
    vehicle_number    = new.vehicle_number,
    po_number         = new.po_number,
    -- dc.po_date is NOT NULL; never write NULL. Preserve the existing
    -- DC date when the final LR has no PO date.
    po_date           = coalesce(new.po_date, dc.po_date)
  where dc.lr_number = new.lr_number;

  return new;
end;
$$;

comment on function public.sync_delivery_challans_from_lr() is
  'AFTER UPDATE on lrs: rewrites only the LR-derived snapshot columns of delivery_challans rows linked by lr_number, using the final persisted LR row. Preserves by_name/hsn/id/created_at/created_by and, when lrs.po_date is NULL, the existing DC po_date. SECURITY DEFINER so sync does not require delivery_challans.edit; LR authorization remains the gate. No direct-call EXECUTE granted.';

-- Trigger functions fire on table events; nobody needs EXECUTE to call
-- one, so revoke it to keep this from being invoked directly as a
-- capability it was not designed for.
revoke all on function public.sync_delivery_challans_from_lr() from public;
revoke all on function public.sync_delivery_challans_from_lr() from anon;
revoke all on function public.sync_delivery_challans_from_lr() from authenticated;

drop trigger if exists trg_lrs_sync_delivery_challans on public.lrs;

create trigger trg_lrs_sync_delivery_challans
  after update on public.lrs
  for each row
  when (
    new.entry_status = 'final'
    and (
      old.entry_status is distinct from new.entry_status
      or old.lr_date            is distinct from new.lr_date
      or old.consignor          is distinct from new.consignor
      or old.consignor_address  is distinct from new.consignor_address
      or old.consignor_gst      is distinct from new.consignor_gst
      or old.consignee          is distinct from new.consignee
      or old.consignee_address  is distinct from new.consignee_address
      or old.consignee_gst      is distinct from new.consignee_gst
      or old.material           is distinct from new.material
      or old.loading_weight     is distinct from new.loading_weight
      or old.vehicle_number     is distinct from new.vehicle_number
      or old.po_number          is distinct from new.po_number
      or old.po_date            is distinct from new.po_date
    )
  )
  execute function public.sync_delivery_challans_from_lr();
