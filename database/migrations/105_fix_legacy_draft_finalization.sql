-- ==========================================================
-- Migration: 105_fix_legacy_draft_finalization
-- Module:    LR — atomic finalization of legacy DRAFT-* rows
--
-- Creates an RPC that atomically allocates the next LR number and
-- finalizes an EXISTING legacy DRAFT-* row in one transaction.
-- This eliminates the gap where allocateNextLrNumber() could succeed
-- but the subsequent updateLR() could fail, leaving a consumed
-- number without a corresponding LR row.
--
-- M102/M103 are already live. This is a forward-only fix.
-- ==========================================================

begin;
set local lock_timeout = '5s';

create or replace function public.finalize_legacy_lr_draft(p_lr_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_number text;
  v_row public.lrs;
  v_lr_date date;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Same permissions as create_numbered_lr_draft and updateLR
  if not (
    public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')
  ) then
    raise exception 'Not permitted to finalize LR drafts';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Draft payload is required';
  end if;

  -- The target LR must exist and be a legacy DRAFT-* row
  select *
    into v_row
  from public.lrs
  where id = p_lr_id
  for update;

  if not found then
    raise exception 'LR not found';
  end if;

  if coalesce(v_row.entry_status, 'final') <> 'draft' then
    raise exception 'Only draft LRs can be finalized';
  end if;

  -- Legacy LR number check: allow NULL, empty/whitespace, or DRAFT-* only.
  -- Matches needsLrNumberAllocation() semantics: allocation needed when
  -- lr_number IS NULL OR trimmed = '' OR starts with 'DRAFT-'.
  -- Reject only when a real LR number already exists.
  if v_row.lr_number is not null
     and trim(v_row.lr_number) <> ''
     and not v_row.lr_number like 'DRAFT-%' then
    raise exception 'LR already has a valid number';
  end if;

  -- 48-hour staff edit window (mirrors lrs_update_own_or_admin RLS policy).
  -- Creator/Admin bypass only this window. Uses v_row.created_at (original, frozen by trg_lrs_freeze_created_at).
  if not public.is_admin() then
    if v_row.created_at is null
       or now() >= v_row.created_at + interval '48 hours'
    then
      raise exception 'LR edit window has expired (48 hours from creation)';
    end if;
  end if;

  -- Meaningful-data gate (server-side): real Consignor OR Consignee.
  -- Treat empty / DB draft sentinel "Draft" as not meaningful.
  -- Same semantics as create_numbered_lr_draft (migration 062).
  if (
        (
          nullif(trim(coalesce(p_payload->>'consignor', '')), '') is null
          or trim(coalesce(p_payload->>'consignor', '')) = 'Draft'
        )
     and (
        nullif(trim(coalesce(p_payload->>'consignee', '')), '') is null
        or trim(coalesce(p_payload->>'consignee', '')) = 'Draft'
      )
  ) then
    raise exception 'Consignor or Consignee is required to finalize an LR';
  end if;

  -- Atomic allocate + update (same transaction).
  v_number := public.allocate_next_lr_number();

  begin
    v_lr_date := nullif(trim(coalesce(p_payload->>'lr_date', '')), '')::date;
  exception
    when others then
      v_lr_date := null;
  end;

  -- Build the update using the same toRow logic as updateLR for full PO persistence
  update public.lrs
  set
    lr_number = v_number,
    lr_date = coalesce(v_lr_date, (timezone('Asia/Kolkata', now()))::date),
    booking_branch = coalesce(nullif(trim(p_payload->>'booking_branch'), ''), 'Draft'),
    customer = coalesce(p_payload->>'customer', ''),
    billing_party_id = (p_payload->>'billing_party_id')::bigint,
    consignor_id = (p_payload->>'consignor_id')::bigint,
    consignee_id = (p_payload->>'consignee_id')::bigint,
    billing_party = coalesce(nullif(trim(p_payload->>'billing_party'), ''), 'Consignor'),
    consignor = coalesce(nullif(trim(p_payload->>'consignor'), ''), 'Draft'),
    consignor_gst = coalesce(p_payload->>'consignor_gst', ''),
    consignor_address = coalesce(p_payload->>'consignor_address', ''),
    consignee = coalesce(nullif(trim(p_payload->>'consignee'), ''), 'Draft'),
    consignee_gst = coalesce(p_payload->>'consignee_gst', ''),
    consignee_address = coalesce(p_payload->>'consignee_address', ''),
    vehicle_number = coalesce(nullif(trim(p_payload->>'vehicle_number'), ''), 'DRAFT'),
    vehicle_type = coalesce(p_payload->>'vehicle_type', ''),
    transporter = coalesce(p_payload->>'transporter', ''),
    driver_name = coalesce(p_payload->>'driver_name', ''),
    driver_mobile = coalesce(p_payload->>'driver_mobile', ''),
    from_station = coalesce(nullif(trim(p_payload->>'from_station'), ''), 'Draft'),
    to_station = coalesce(nullif(trim(p_payload->>'to_station'), ''), 'Draft'),
    material = coalesce(nullif(trim(p_payload->>'material'), ''), 'Draft'),
    material_id = nullif(p_payload->>'material_id', '')::bigint,
    package_type = coalesce(p_payload->>'package_type', ''),
    packages = coalesce((p_payload->>'packages')::numeric, 0),
    loading_weight = coalesce((p_payload->>'loading_weight')::numeric, 0),
    unloading_weight = coalesce((p_payload->>'unloading_weight')::numeric, 0),
    charged_weight = coalesce((p_payload->>'charged_weight')::numeric, 0),
    po_number = coalesce(p_payload->>'po_number', ''),
    po_date = case
                when p_payload->>'po_date' is null then null
                when trim(p_payload->>'po_date') = '' then null
                else (p_payload->>'po_date')::date
              end,
    purchase_order_id = nullif(p_payload->>'purchase_order_id', '')::bigint,
    vendor_code = coalesce(p_payload->>'vendor_code', ''),
    dc_number = coalesce(p_payload->>'dc_number', ''),
    invoice_number = coalesce(p_payload->>'invoice_number', ''),
    invoice_value = coalesce((p_payload->>'invoice_value')::numeric, 0),
    eway_bill_number = coalesce(p_payload->>'eway_bill_number', ''),
    bill_rate = coalesce((p_payload->>'bill_rate')::numeric, 0),
    bill_rate_type = coalesce(nullif(trim(p_payload->>'bill_rate_type'), ''), 'Fixed'),
    guaranteed_weight = coalesce((p_payload->>'guaranteed_weight')::numeric, 0),
    lorry_hire_rate = coalesce((p_payload->>'lorry_hire_rate')::numeric, 0),
    lorry_hire_type = coalesce(nullif(trim(p_payload->>'lorry_hire_type'), ''), 'Fixed'),
    lorry_hire_guaranteed_weight = coalesce((p_payload->>'lorry_hire_guaranteed_weight')::numeric, 0),
    freight_type = coalesce(nullif(trim(p_payload->>'freight_type'), ''), 'To Be Billed'),
    driver_advance = coalesce((p_payload->>'driver_advance')::numeric, 0),
    diesel_advance = coalesce((p_payload->>'diesel_advance')::numeric, 0),
    st_challan = coalesce((p_payload->>'st_challan')::numeric, 0),
    loading_charges = coalesce((p_payload->>'loading_charges')::numeric, 0),
    unloading_charges = coalesce((p_payload->>'unloading_charges')::numeric, 0),
    hamali = coalesce((p_payload->>'hamali')::numeric, 0),
    commission = coalesce((p_payload->>'commission')::numeric, 0),
    other_expense = coalesce((p_payload->>'other_expense')::numeric, 0),
    bill_amount = coalesce((p_payload->>'bill_amount')::numeric, 0),
    lorry_hire_amount = coalesce((p_payload->>'lorry_hire_amount')::numeric, 0),
    profit_amount = coalesce((p_payload->>'profit_amount')::numeric, 0),
    remarks = coalesce(p_payload->>'remarks', ''),
    internal_remarks = coalesce(p_payload->>'internal_remarks', ''),
    material_description = coalesce(p_payload->>'material_description', ''),
    status = coalesce(nullif(trim(p_payload->>'status'), ''), 'Open'),
    entry_status = 'final',
    updated_at = now()
  where id = p_lr_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.finalize_legacy_lr_draft(uuid, jsonb) from public;
revoke all on function public.finalize_legacy_lr_draft(uuid, jsonb) from anon;
grant execute on function public.finalize_legacy_lr_draft(uuid, jsonb) to authenticated;

comment on function public.finalize_legacy_lr_draft(uuid, jsonb) is
  'Atomically allocates the next LR number and finalizes an EXISTING legacy DRAFT-* row in one transaction. Use only for finalizing legacy DRAFT-* rows. Returns the finalized LR row. 48-hour staff edit window enforced (mirrors lrs_update_own_or_admin RLS policy). Creator/Admin bypass only this window.';

commit;
