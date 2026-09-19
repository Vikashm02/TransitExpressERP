-- Migration: 089_allow_explicit_lr_po_snapshot_refresh
-- Module:    LR — allow explicit same-PO snapshot refresh from master
--
-- This migration modifies the lr_validate_purchase_order trigger to allow
-- an explicit refresh of an LR's po_number/po_date from its linked PO master
-- when the user intentionally triggers a refresh via the "Update from PO Master" action.
--
-- The validation still rejects arbitrary changes to po_number/po_date on linked LRs,
-- but now permits an explicit refresh where the new values exactly match the
-- current PO master for the same purchase_order_id.
--
-- Preserved:
--   - different-PO selection behavior
--   - billing party/customer validation
--   - Active PO validation
--   - allotted/used weight validation
--   - PO status validation
--   - all existing LR validation
--   - LR audit behavior
--   - RLS
--   - permissions
--   - notifications
--   - billing/POD/report behavior
--   - all unrelated trigger logic

-- ==========================================================
-- Updated lr_validate_purchase_order function
-- ==========================================================
create or replace function public.lr_validate_purchase_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
  v_party text;
  v_selection boolean;
begin
  if new.purchase_order_id is null then return new; end if;
  v_selection := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    v_selection := new.purchase_order_id is distinct from old.purchase_order_id
      or new.customer is distinct from old.customer;
  end if;
  -- SHARE serializes selection with a concurrent PO edit/deactivation.
  select * into v_po from public.purchase_orders where id = new.purchase_order_id for share;
  if not found then raise exception 'PO not found'; end if;
  select name into v_party from public.billing_parties where id = v_po.billing_party_id;
  if v_selection then
    if (select count(*) from public.billing_parties
      where upper(trim(name)) = upper(trim(new.customer)) and coalesce(entry_status, 'final') = 'final') <> 1 then
      raise exception 'Billing party must resolve to exactly one finalized master record';
    end if;
    if upper(trim(new.customer)) is distinct from upper(trim(v_party)) then
      raise exception 'PO does not belong to the selected billing party';
    end if;
    if v_po.status <> 'Active' then raise exception 'Choose an active PO'; end if;
    new.po_number := v_po.po_number;
    new.po_date := v_po.issue_date;
  elsif new.po_number is distinct from old.po_number or new.po_date is distinct from old.po_date then
    -- Allow an intentional same-PO snapshot refresh when the new values
    -- exactly match the current PO master for the same purchase_order_id.
    if not exists (
      select 1
      from public.purchase_orders p
      where p.id = new.purchase_order_id
        and p.po_number = new.po_number
        and p.issue_date = new.po_date
    ) then
      raise exception 'Select a PO from the master to change its LR snapshot';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.entry_status = 'draft' and new.entry_status = 'final' and v_po.status <> 'Active' then
      raise exception 'PO is now inactive. Choose an active PO before finalizing';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.lr_validate_purchase_order() from public, anon, authenticated;