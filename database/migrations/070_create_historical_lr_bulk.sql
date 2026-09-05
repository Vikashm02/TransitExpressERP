-- ==========================================================
-- Migration: 070_create_historical_lr_bulk
-- Module:    LR Entry — atomic historical bulk create
--
-- PURPOSE:
--   Insert a validated batch of historical LRs in ONE PostgreSQL
--   transaction via RPC. Either every row is inserted, or none are.
--
-- NEW RPC:
--   public.create_historical_lr_bulk(p_rows jsonb) → jsonb
--
-- BEHAVIOR:
--   - Authenticated + lr create_view|edit required
--   - Reads company_settings singleton (same source as
--     allocate_next_lr_number): lr_prefix, lr_prefix_length,
--     lr_running_number — FOR SHARE so the historical bound is
--     stable for the duration of this transaction
--   - Does NOT call allocate_next_lr_number()
--   - Does NOT update company_settings.lr_running_number
--   - Re-validates every LR number (present, normalize, historical
--     numeric < lr_running_number, not already in lrs, no in-batch
--     duplicates)
--   - Inserts entry_status=final rows; ownership/audit triggers apply
--   - Unique(lr_number) remains final TOCTOU protection; violations
--     abort the whole function transaction
--
-- DOES NOT:
--   - Alter table schema / add columns
--   - Change allocate_next_lr_number body
--   - Touch Supplier / POD / Financials / Billing
--
-- NOT applied automatically — review, then apply manually in Supabase.
-- ==========================================================

create or replace function public.create_historical_lr_bulk(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prefix text;
  v_length integer;
  v_running integer;
  v_company_id smallint;
  v_count integer;
  v_i integer;
  v_item jsonb;
  v_excel_row integer;
  v_raw text;
  v_digits text;
  v_rest text;
  v_numeric integer;
  v_pad integer;
  v_formatted text;
  v_seen text[] := '{}';
  v_lr_date date;
  v_dc_date date;
  v_invoice_date date;
  v_inserted_ids bigint[] := '{}';
  v_row_id bigint;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')
  ) then
    raise exception 'Not permitted to create LRs';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Historical LR bulk payload must be a JSON array';
  end if;

  v_count := jsonb_array_length(p_rows);
  if v_count = 0 then
    raise exception 'Historical LR bulk payload is empty';
  end if;

  if v_count > 500 then
    raise exception 'Historical LR bulk batch too large (max 500 rows)';
  end if;

  -- Authoritative singleton company_settings (same row allocate_next_lr_number uses).
  -- FOR SHARE stabilizes lr_running_number for this transaction without mutating it.
  select
    id,
    coalesce(lr_prefix, ''),
    coalesce(lr_prefix_length, 4),
    coalesce(lr_running_number, 0)
  into v_company_id, v_prefix, v_length, v_running
  from public.company_settings
  order by id
  limit 1
  for share;

  if v_company_id is null then
    raise exception 'Company settings are not configured';
  end if;

  -- ---------- Pass 1: validate every row against live DB state ----------
  for v_i in 0 .. (v_count - 1) loop
    v_item := p_rows -> v_i;

    if v_item is null or jsonb_typeof(v_item) <> 'object' then
      raise exception 'Row %: invalid LR payload object.', v_i + 2;
    end if;

    begin
      v_excel_row := nullif(trim(coalesce(v_item->>'excel_row', '')), '')::integer;
    exception
      when others then
        v_excel_row := null;
    end;

    if v_excel_row is null then
      v_excel_row := v_i + 2; -- Excel-ish fallback (header is row 1)
    end if;

    v_raw := trim(coalesce(v_item->>'lr_number', ''));
    if v_raw = '' then
      raise exception 'Row %: LR Number is required.', v_excel_row;
    end if;

    v_digits := v_raw;
    if v_prefix <> '' and lower(v_raw) like lower(v_prefix) || '%' then
      v_rest := trim(substr(v_raw, char_length(v_prefix) + 1));
      if v_rest ~ '^[0-9]+$' then
        v_digits := v_rest;
      end if;
    end if;

    if v_digits !~ '^[0-9]+$' then
      raise exception
        'Row %: LR Number must be a whole number (e.g. 19305). Do not enter decimals or letters.',
        v_excel_row;
    end if;

    begin
      v_numeric := v_digits::integer;
    exception
      when others then
        raise exception 'Row %: LR Number must be a positive whole number.', v_excel_row;
    end;

    if v_numeric is null or v_numeric <= 0 then
      raise exception 'Row %: LR Number must be a positive whole number.', v_excel_row;
    end if;

    v_pad := greatest(v_length, char_length(v_numeric::text));
    v_formatted := v_prefix || lpad(v_numeric::text, v_pad, '0');

    if lower(v_formatted) = any (v_seen) then
      raise exception
        'Row %: % is duplicated in the uploaded file.',
        v_excel_row,
        v_formatted;
    end if;
    v_seen := array_append(v_seen, lower(v_formatted));

    if v_numeric >= v_running then
      raise exception
        'Row %: % is not allowed in historical bulk upload. LR Number must be older than the current running LR number.',
        v_excel_row,
        v_formatted;
    end if;

    if exists (
      select 1
      from public.lrs
      where lower(lr_number) = lower(v_formatted)
    ) then
      raise exception 'Row %: % already exists in the system.', v_excel_row, v_formatted;
    end if;

    -- Stash authoritative formatted number back onto the item for insert pass.
    p_rows := jsonb_set(p_rows, array[v_i::text, 'lr_number'], to_jsonb(v_formatted), true);
  end loop;

  -- ---------- Pass 2: insert all rows (same function = same transaction) ----------
  for v_i in 0 .. (v_count - 1) loop
    v_item := p_rows -> v_i;

    begin
      v_excel_row := nullif(trim(coalesce(v_item->>'excel_row', '')), '')::integer;
    exception
      when others then
        v_excel_row := v_i + 2;
    end;
    if v_excel_row is null then
      v_excel_row := v_i + 2;
    end if;

    v_formatted := v_item->>'lr_number';

    begin
      v_lr_date := nullif(trim(coalesce(v_item->>'lr_date', '')), '')::date;
    exception
      when others then
        raise exception 'Row %: LR Date must be a valid date (YYYY-MM-DD).', v_excel_row;
    end;

    if v_lr_date is null then
      raise exception 'Row %: LR Date is required.', v_excel_row;
    end if;

    begin
      v_dc_date := nullif(trim(coalesce(v_item->>'dc_date', '')), '')::date;
    exception
      when others then
        raise exception 'Row %: DC Date must be a valid date (YYYY-MM-DD).', v_excel_row;
    end;

    begin
      v_invoice_date := nullif(trim(coalesce(v_item->>'invoice_date', '')), '')::date;
    exception
      when others then
        raise exception 'Row %: Invoice Date must be a valid date (YYYY-MM-DD).', v_excel_row;
    end;

    begin
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
        dc_date,
        invoice_number,
        invoice_date,
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
        v_formatted,
        v_lr_date,
        coalesce(nullif(trim(v_item->>'booking_branch'), ''), ''),
        coalesce(v_item->>'customer', ''),
        coalesce(nullif(trim(v_item->>'billing_party'), ''), 'Consignor'),
        coalesce(v_item->>'consignor', ''),
        coalesce(v_item->>'consignor_gst', ''),
        coalesce(v_item->>'consignor_address', ''),
        coalesce(v_item->>'consignee', ''),
        coalesce(v_item->>'consignee_gst', ''),
        coalesce(v_item->>'consignee_address', ''),
        coalesce(v_item->>'vehicle_number', ''),
        coalesce(v_item->>'vehicle_type', ''),
        coalesce(v_item->>'transporter', ''),
        coalesce(v_item->>'driver_name', ''),
        coalesce(v_item->>'driver_mobile', ''),
        coalesce(v_item->>'from_station', ''),
        coalesce(v_item->>'to_station', ''),
        coalesce(v_item->>'material', ''),
        coalesce(v_item->>'package_type', ''),
        coalesce((v_item->>'packages')::numeric, 0),
        coalesce((v_item->>'loading_weight')::numeric, 0),
        coalesce((v_item->>'unloading_weight')::numeric, 0),
        coalesce((v_item->>'charged_weight')::numeric, 0),
        coalesce(v_item->>'po_number', ''),
        coalesce(v_item->>'vendor_code', ''),
        coalesce(v_item->>'dc_number', ''),
        v_dc_date,
        coalesce(v_item->>'invoice_number', ''),
        v_invoice_date,
        coalesce((v_item->>'invoice_value')::numeric, 0),
        coalesce(v_item->>'eway_bill_number', ''),
        coalesce((v_item->>'bill_rate')::numeric, 0),
        coalesce(nullif(trim(v_item->>'bill_rate_type'), ''), 'Fixed'),
        coalesce((v_item->>'guaranteed_weight')::numeric, 0),
        coalesce((v_item->>'lorry_hire_rate')::numeric, 0),
        coalesce(nullif(trim(v_item->>'lorry_hire_type'), ''), 'Fixed'),
        coalesce((v_item->>'lorry_hire_guaranteed_weight')::numeric, 0),
        coalesce(nullif(trim(v_item->>'freight_type'), ''), 'To Be Billed'),
        coalesce((v_item->>'driver_advance')::numeric, 0),
        coalesce((v_item->>'diesel_advance')::numeric, 0),
        coalesce((v_item->>'st_challan')::numeric, 0),
        coalesce((v_item->>'loading_charges')::numeric, 0),
        coalesce((v_item->>'unloading_charges')::numeric, 0),
        coalesce((v_item->>'hamali')::numeric, 0),
        coalesce((v_item->>'commission')::numeric, 0),
        coalesce((v_item->>'other_expense')::numeric, 0),
        coalesce((v_item->>'bill_amount')::numeric, 0),
        coalesce((v_item->>'lorry_hire_amount')::numeric, 0),
        coalesce((v_item->>'profit_amount')::numeric, 0),
        coalesce(v_item->>'remarks', ''),
        coalesce(v_item->>'internal_remarks', ''),
        coalesce(v_item->>'material_description', ''),
        coalesce(nullif(trim(v_item->>'status'), ''), 'Open'),
        'final'
      )
      returning id into v_row_id;
    exception
      when unique_violation then
        -- Final TOCTOU guard (concurrent create). Re-raise → whole batch rolls back.
        raise exception 'Row %: % already exists in the system.', v_excel_row, v_formatted;
      when others then
        -- Do not swallow; abort whole batch. Avoid leaking raw SQLERRM internals.
        raise exception
          'Row %: % — bulk insert failed. No LR records were imported.',
          v_excel_row,
          v_formatted;
    end;

    v_inserted_ids := array_append(v_inserted_ids, v_row_id);
  end loop;

  return jsonb_build_object(
    'count', v_count,
    'ids', to_jsonb(v_inserted_ids),
    'lr_running_number_unchanged', v_running
  );
end;
$$;

revoke all on function public.create_historical_lr_bulk(jsonb) from public;
revoke all on function public.create_historical_lr_bulk(jsonb) from anon;
grant execute on function public.create_historical_lr_bulk(jsonb) to authenticated;

comment on function public.create_historical_lr_bulk(jsonb) is
  'Atomically inserts a batch of historical final LRs in one transaction. Does not call allocate_next_lr_number or modify lr_running_number. Requires lr create_view or edit. Max 500 rows.';
