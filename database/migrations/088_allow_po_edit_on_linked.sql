-- Migration: 088_allow_po_edit_on_linked
-- Module:    Purchase Order — allow editing all fields on linked POs
--
-- This migration modifies the purchase_order_before_write trigger to allow
-- authorized users to edit all PO fields (including billing_party_id and
-- po_number) even when LRs are already linked to the PO.
--
-- The FK relationship (lrs.purchase_order_id -> purchase_orders.id) is
-- unaffected because it references the immutable purchase_orders.id.
-- Existing LRs retain their historical snapshots via lr_validate_purchase_order.
-- Future LRs will use the corrected PO master values.
--
-- Preserved:
--   - finalized billing party validation
--   - PO number normalization
--   - uniqueness constraint (billing_party_id, upper(trim(po_number)))
--   - audit trigger behavior
--   - lr_validate_purchase_order trigger (unchanged)
--   - purchase_order_audit table and trigger
--   - RLS policies
--   - purchase_orders/edit permission requirement

-- ==========================================================
-- Updated purchase_order_before_write function
-- ==========================================================
create or replace function public.purchase_order_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.po_number := upper(trim(new.po_number));

  if not exists (
    select 1
    from public.billing_parties
    where id = new.billing_party_id
      and coalesce(entry_status, 'final') = 'final'
  ) then
    raise exception 'Choose a finalized billing party';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    -- Preserve immutable identity columns on UPDATE
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;

    -- NOTE: The previous restriction preventing billing_party_id and/or
    -- po_number changes when LRs reference the PO has been REMOVED.
    -- Authorized users (purchase_orders/edit) may now correct all fields
    -- on linked POs. Existing LRs retain their historical snapshots.
    -- Future LRs will use the corrected PO master values.
    -- The FK (lrs.purchase_order_id -> purchase_orders.id) is unaffected.
  end if;

  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.purchase_order_before_write() from public, anon, authenticated;