-- Migration: 095_create_replacement_po_from_lr
-- Module: LR / Purchase Orders — explicit, single-LR inactive-PO replacement
--
-- Creates one fresh PO for one editable, finalized LR whose currently linked
-- PO is Inactive. The old PO is never changed and no other LR is reassigned.
begin;

create or replace function public.create_replacement_purchase_order_from_lr(
  p_lr_id uuid,
  p_po_number text,
  p_issue_date date
)
returns public.lrs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lr public.lrs%rowtype;
  v_old_po public.purchase_orders%rowtype;
  v_new_po public.purchase_orders%rowtype;
  v_billing_party_id bigint;
  v_billing_party_count integer;
  v_consignor text;
  v_normalized_po_number text;
  v_updated_lr public.lrs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Match the existing finalized-LR edit authority. This RPC is deliberately
  -- not a general PO Master create or edit API.
  if not public.has_permission('lr', 'edit') then
    raise exception 'Not permitted to edit this LR';
  end if;

  -- The exact supplied LR is locked first, serializing double-clicks/retries.
  select *
    into v_lr
  from public.lrs
  where id = p_lr_id
  for update;

  if not found then
    raise exception 'LR not found';
  end if;

  if coalesce(v_lr.entry_status, 'final') <> 'final' then
    raise exception 'Replacement PO can only be created for a finalized LR';
  end if;

  -- Uses the existing helper: Admin/Creator retain the established bypass;
  -- staff remain limited by the LR's original created_at + 48 hours.
  if not public.staff_within_48h_edit_window(v_lr.created_at) then
    raise exception 'The 48-hour staff edit window for this LR has expired';
  end if;

  if v_lr.purchase_order_id is null then
    raise exception 'This LR is not linked to a PO';
  end if;

  select *
    into v_old_po
  from public.purchase_orders
  where id = v_lr.purchase_order_id
  for share;

  if not found then
    raise exception 'Current PO not found';
  end if;

  if v_old_po.status <> 'Inactive' then
    raise exception 'A replacement PO can only be created when the current PO is Inactive';
  end if;

  v_normalized_po_number := upper(trim(coalesce(p_po_number, '')));
  if v_normalized_po_number = '' or length(v_normalized_po_number) > 100 then
    raise exception 'Enter a PO number between 1 and 100 characters';
  end if;

  if p_issue_date is null then
    raise exception 'Enter a PO issue date';
  end if;

  -- Preserve the established LR-originated PO context: Billing Party and
  -- Consignor are derived from the locked LR, never from client-supplied IDs.
  select count(*)::integer, min(id)
    into v_billing_party_count, v_billing_party_id
  from public.billing_parties
  where upper(trim(name)) = upper(trim(v_lr.customer))
    and coalesce(entry_status, 'final') = 'final';

  if v_billing_party_count <> 1 then
    raise exception 'Billing party must resolve to exactly one finalized master record';
  end if;

  v_consignor := v_lr.consignor;
  if nullif(trim(v_consignor), '') is null then
    raise exception 'Consignor is required to create a replacement PO';
  end if;

  -- A matching PO is a conflict, not a reusable record: the user explicitly
  -- requested a NEW PO and an existing PO must never be overwritten/reactivated.
  select *
    into v_new_po
  from public.purchase_orders
  where billing_party_id = v_billing_party_id
    and upper(trim(coalesce(consignor, ''))) = upper(v_consignor)
    and upper(trim(po_number)) = v_normalized_po_number
  for share;

  if found then
    raise exception 'A PO with this number already exists for this Billing Party and Consignor';
  end if;

  insert into public.purchase_orders (
    billing_party_id,
    consignor,
    po_number,
    issue_date,
    allotted_weight,
    status
  )
  values (
    v_billing_party_id,
    v_consignor,
    v_normalized_po_number,
    p_issue_date,
    null,
    'Active'
  )
  returning * into v_new_po;

  -- This is intentionally an exact-ID update. There is no old-PO bulk update.
  -- Existing LR validation, audit, and PO-usage triggers run normally.
  update public.lrs
  set purchase_order_id = v_new_po.id,
      po_number = v_new_po.po_number,
      po_date = v_new_po.issue_date
  where id = v_lr.id
  returning * into v_updated_lr;

  return v_updated_lr;
end;
$$;

revoke all on function public.create_replacement_purchase_order_from_lr(uuid, text, date)
  from public, anon;
grant execute on function public.create_replacement_purchase_order_from_lr(uuid, text, date)
  to authenticated;

comment on function public.create_replacement_purchase_order_from_lr(uuid, text, date) is
  'Creates one fresh Active PO for one editable finalized LR linked to an Inactive PO; derives Billing Party and Consignor from the locked LR and reassigns only that LR.';

commit;
