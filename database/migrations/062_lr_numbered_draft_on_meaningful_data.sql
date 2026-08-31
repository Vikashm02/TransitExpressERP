-- ==========================================================
-- Migration: 062_lr_numbered_draft_on_meaningful_data
-- Module:    LR — reserve real LR number on first meaningful draft
--
-- SUPERSEDES the earlier unnumbered-draft plan (nullable lr_number).
-- Do NOT apply any prior draft of 062 that dropped NOT NULL on lr_number.
-- This file does NOT alter lr_number nullability.
--
-- BUSINESS RULE:
--   Open Create LR          → no DB row, no number
--   Consignor OR Consignee  → atomically allocate + insert draft
--   Close numbered draft    → KEEP draft + number (do not discard)
--   Final Save              → same number, entry_status = final
--
-- ROOT CAUSE OF GAPS (historical):
--   Number reserved on autosave, then Cancel deleted the draft while
--   lr_running_number stayed advanced. Fix is KEEP numbered drafts,
--   not unnumbered drafts.
--
-- NEW RPC:
--   public.create_numbered_lr_draft(p_payload jsonb) → jsonb
--   In ONE transaction:
--     1) allocate_next_lr_number()  (FOR UPDATE on company_settings)
--     2) INSERT draft row with that lr_number
--   If INSERT fails, allocation rolls back with the transaction —
--   no orphaned consumed numbers.
--
-- DOES NOT:
--   - Renumber / modify existing LRs
--   - Change lr_running_number except via allocate on new drafts
--   - Touch POD / Financials / other modules
--
-- NOT applied automatically — review, then apply manually in Supabase.
-- ==========================================================

create or replace function public.create_numbered_lr_draft(p_payload jsonb)
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

  if not (
    public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')
  ) then
    raise exception 'Not permitted to create LR drafts';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Draft payload is required';
  end if;

  -- Meaningful-data gate (server-side): real Consignor OR Consignee.
  -- Treat empty / DB draft sentinel "Draft" as not meaningful.
  if (
        nullif(trim(coalesce(p_payload->>'consignor', '')), '') is null
        or trim(coalesce(p_payload->>'consignor', '')) = 'Draft'
      )
     and (
        nullif(trim(coalesce(p_payload->>'consignee', '')), '') is null
        or trim(coalesce(p_payload->>'consignee', '')) = 'Draft'
      ) then
    raise exception 'Consignor or Consignee is required to reserve an LR number';
  end if;

  -- Atomic allocate + insert (same transaction).
  v_number := public.allocate_next_lr_number();

  begin
    v_lr_date := nullif(trim(coalesce(p_payload->>'lr_date', '')), '')::date;
  exception
    when others then
      v_lr_date := null;
  end;

  insert into public.lrs (
    lr_number,
    lr_date,
    booking_branch,
    customer,
    billing_party,
    consignor,
    consignor_gst,
    consignor_address,
    consignee,
    consignee_gst,
    consignee_address,
    vehicle_number,
    vehicle_type,
    transporter,
    driver_name,
    driver_mobile,
    from_station,
    to_station,
    material,
    package_type,
    packages,
    loading_weight,
    unloading_weight,
    charged_weight,
    po_number,
    vendor_code,
    dc_number,
    invoice_number,
    invoice_value,
    eway_bill_number,
    bill_rate,
    bill_rate_type,
    guaranteed_weight,
    lorry_hire_rate,
    lorry_hire_type,
    lorry_hire_guaranteed_weight,
    freight_type,
    driver_advance,
    diesel_advance,
    st_challan,
    loading_charges,
    unloading_charges,
    hamali,
    commission,
    other_expense,
    bill_amount,
    lorry_hire_amount,
    profit_amount,
    remarks,
    internal_remarks,
    material_description,
    status,
    entry_status
  )
  values (
    v_number,
    coalesce(v_lr_date, (timezone('Asia/Kolkata', now()))::date),
    coalesce(nullif(trim(p_payload->>'booking_branch'), ''), 'Draft'),
    coalesce(p_payload->>'customer', ''),
    coalesce(nullif(trim(p_payload->>'billing_party'), ''), 'Consignor'),
    coalesce(nullif(trim(p_payload->>'consignor'), ''), 'Draft'),
    coalesce(p_payload->>'consignor_gst', ''),
    coalesce(p_payload->>'consignor_address', ''),
    coalesce(nullif(trim(p_payload->>'consignee'), ''), 'Draft'),
    coalesce(p_payload->>'consignee_gst', ''),
    coalesce(p_payload->>'consignee_address', ''),
    coalesce(nullif(trim(p_payload->>'vehicle_number'), ''), 'DRAFT'),
    coalesce(p_payload->>'vehicle_type', ''),
    coalesce(p_payload->>'transporter', ''),
    coalesce(p_payload->>'driver_name', ''),
    coalesce(p_payload->>'driver_mobile', ''),
    coalesce(nullif(trim(p_payload->>'from_station'), ''), 'Draft'),
    coalesce(nullif(trim(p_payload->>'to_station'), ''), 'Draft'),
    coalesce(nullif(trim(p_payload->>'material'), ''), 'Draft'),
    coalesce(p_payload->>'package_type', ''),
    coalesce((p_payload->>'packages')::numeric, 0),
    coalesce((p_payload->>'loading_weight')::numeric, 0),
    coalesce((p_payload->>'unloading_weight')::numeric, 0),
    coalesce((p_payload->>'charged_weight')::numeric, 0),
    coalesce(p_payload->>'po_number', ''),
    coalesce(p_payload->>'vendor_code', ''),
    coalesce(p_payload->>'dc_number', ''),
    coalesce(p_payload->>'invoice_number', ''),
    coalesce((p_payload->>'invoice_value')::numeric, 0),
    coalesce(p_payload->>'eway_bill_number', ''),
    coalesce((p_payload->>'bill_rate')::numeric, 0),
    coalesce(nullif(trim(p_payload->>'bill_rate_type'), ''), 'Fixed'),
    coalesce((p_payload->>'guaranteed_weight')::numeric, 0),
    coalesce((p_payload->>'lorry_hire_rate')::numeric, 0),
    coalesce(nullif(trim(p_payload->>'lorry_hire_type'), ''), 'Fixed'),
    coalesce((p_payload->>'lorry_hire_guaranteed_weight')::numeric, 0),
    coalesce(nullif(trim(p_payload->>'freight_type'), ''), 'To Be Billed'),
    coalesce((p_payload->>'driver_advance')::numeric, 0),
    coalesce((p_payload->>'diesel_advance')::numeric, 0),
    coalesce((p_payload->>'st_challan')::numeric, 0),
    coalesce((p_payload->>'loading_charges')::numeric, 0),
    coalesce((p_payload->>'unloading_charges')::numeric, 0),
    coalesce((p_payload->>'hamali')::numeric, 0),
    coalesce((p_payload->>'commission')::numeric, 0),
    coalesce((p_payload->>'other_expense')::numeric, 0),
    coalesce((p_payload->>'bill_amount')::numeric, 0),
    coalesce((p_payload->>'lorry_hire_amount')::numeric, 0),
    coalesce((p_payload->>'profit_amount')::numeric, 0),
    coalesce(p_payload->>'remarks', ''),
    coalesce(p_payload->>'internal_remarks', ''),
    coalesce(p_payload->>'material_description', ''),
    coalesce(nullif(trim(p_payload->>'status'), ''), 'Open'),
    'draft'
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.create_numbered_lr_draft(jsonb) from public;
revoke all on function public.create_numbered_lr_draft(jsonb) from anon;
grant execute on function public.create_numbered_lr_draft(jsonb) to authenticated;

comment on function public.create_numbered_lr_draft(jsonb) is
  'Atomically allocates the next LR number and inserts an entry_status=draft row in one transaction. Call once when Consignor or Consignee is first entered. Do not call for updates of existing drafts.';

comment on function public.allocate_next_lr_number() is
  'Atomically reserves the next LR number (company_settings FOR UPDATE). Used by create_numbered_lr_draft on first meaningful draft, by finalize for legacy DRAFT-* rows, and by direct final create / bulk upload. Never call on dialog open or empty cancel.';
