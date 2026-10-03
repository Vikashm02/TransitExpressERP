-- Stable LR party identities. REVIEW ONLY: apply manually after approval.
-- No historical UPDATE/backfill, no snapshot rewriting, no RLS changes.
-- Apply before deploying the matching application. Old clients remain valid.
-- RESTRICT preserves referenced masters and LRs; deactivate masters instead.
-- Index creation/table alteration take locks: schedule a reviewed maintenance window.
begin;

alter table public.lrs
  add column billing_party_id bigint references public.billing_parties(id) on delete restrict,
  add column consignor_id bigint references public.customers(id) on delete restrict,
  add column consignee_id bigint references public.customers(id) on delete restrict;

create index lrs_billing_party_identity_idx on public.lrs (billing_party_id) where billing_party_id is not null;
create index lrs_consignor_identity_idx on public.lrs (consignor_id) where consignor_id is not null;
create index lrs_consignee_identity_idx on public.lrs (consignee_id) where consignee_id is not null;

comment on column public.lrs.billing_party_id is 'Stable Billing Party Master identity; customer remains the display snapshot. NULL means unresolved, never infer authorization from text.';
comment on column public.lrs.consignor_id is 'Stable Customer Master consignor identity; legacy NULL is valid.';
comment on column public.lrs.consignee_id is 'Stable Customer Master consignee identity; legacy NULL is valid.';

-- Validate supplied IDs by PK, never discover an identity by name. The uppercase
-- alternative preserves the existing LR form normalization, not name-based resolution.
-- Unchanged historical snapshots/IDs survive master renames. Old clients changing
-- only a party snapshot cannot accidentally retain an unrelated stable identity.
create function public.lr_validate_party_identities() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_po_party bigint;
begin
  if new.billing_party_id is not null then
    if new.customer is null then
      raise exception 'Selected LR party identity requires its snapshot';
    end if;
    if tg_op = 'UPDATE' then
      if new.billing_party_id is not distinct from old.billing_party_id
         and (new.customer is not distinct from old.customer
           or new.customer = upper(old.customer)) then
        -- Existing binding, including the UI's uppercase-only formatting.
        null;
      else
        select name into v_name from public.billing_parties
          where id = new.billing_party_id and coalesce(entry_status, 'final') = 'final' for share;
        if not found or v_name is null or not (new.customer is not distinct from v_name or new.customer is not distinct from upper(v_name)) then
          if new.billing_party_id is not distinct from old.billing_party_id then
            new.billing_party_id := null; -- Legacy text-only change: leave unresolved.
          else
            raise exception 'Selected LR party identity does not match its snapshot';
          end if;
        end if;
      end if;
    else
      select name into v_name from public.billing_parties
        where id = new.billing_party_id and coalesce(entry_status, 'final') = 'final' for share;
      if not found or v_name is null or not (new.customer is not distinct from v_name or new.customer is not distinct from upper(v_name)) then
        raise exception 'Selected LR party identity does not match its snapshot';
      end if;
    end if;
  end if;
  if new.consignor_id is not null then
    if new.consignor is null then
      raise exception 'Selected LR party identity requires its snapshot';
    end if;
    if tg_op = 'UPDATE' then
      if new.consignor_id is not distinct from old.consignor_id
         and (new.consignor is not distinct from old.consignor
           or new.consignor = upper(old.consignor)) then
        -- Existing binding, including the UI's uppercase-only formatting.
        null;
      else
        select name into v_name from public.customers
          where id = new.consignor_id and coalesce(entry_status, 'final') = 'final' for share;
        if not found or v_name is null or not (new.consignor is not distinct from v_name or new.consignor is not distinct from upper(v_name)) then
          if new.consignor_id is not distinct from old.consignor_id then
            new.consignor_id := null; -- Legacy text-only change: leave unresolved.
          else
            raise exception 'Selected LR party identity does not match its snapshot';
          end if;
        end if;
      end if;
    else
      select name into v_name from public.customers
        where id = new.consignor_id and coalesce(entry_status, 'final') = 'final' for share;
      if not found or v_name is null or not (new.consignor is not distinct from v_name or new.consignor is not distinct from upper(v_name)) then
        raise exception 'Selected LR party identity does not match its snapshot';
      end if;
    end if;
  end if;
  if new.consignee_id is not null then
    if new.consignee is null then
      raise exception 'Selected LR party identity requires its snapshot';
    end if;
    if tg_op = 'UPDATE' then
      if new.consignee_id is not distinct from old.consignee_id
         and (new.consignee is not distinct from old.consignee
           or new.consignee = upper(old.consignee)) then
        -- Existing binding, including the UI's uppercase-only formatting.
        null;
      else
        select name into v_name from public.customers
          where id = new.consignee_id and coalesce(entry_status, 'final') = 'final' for share;
        if not found or v_name is null or not (new.consignee is not distinct from v_name or new.consignee is not distinct from upper(v_name)) then
          if new.consignee_id is not distinct from old.consignee_id then
            new.consignee_id := null; -- Legacy text-only change: leave unresolved.
          else
            raise exception 'Selected LR party identity does not match its snapshot';
          end if;
        end if;
      end if;
    else
      select name into v_name from public.customers
        where id = new.consignee_id and coalesce(entry_status, 'final') = 'final' for share;
      if not found or v_name is null or not (new.consignee is not distinct from v_name or new.consignee is not distinct from upper(v_name)) then
        raise exception 'Selected LR party identity does not match its snapshot';
      end if;
    end if;
  end if;
  if new.billing_party_id is not null and new.purchase_order_id is not null then
    select billing_party_id into v_po_party from public.purchase_orders where id = new.purchase_order_id for share;
    if not found or v_po_party is distinct from new.billing_party_id then
      raise exception 'PO does not belong to the selected billing party';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.lr_validate_party_identities() from public, anon, authenticated;
-- Run before existing PO/route validators. Does not grant permission to write LRs.
create trigger a_lr_validate_party_identities before insert or update on public.lrs
  for each row execute function public.lr_validate_party_identities();

-- Existing function retained except the three explicit INSERT fields.
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
    billing_party_id, consignor_id, consignee_id,
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
    (p_payload->>'billing_party_id')::bigint, (p_payload->>'consignor_id')::bigint, (p_payload->>'consignee_id')::bigint,
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

-- Existing guards/inserts retained, with stable identity fields and UUID LR results.
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
  v_inserted_ids uuid[] := '{}';
  v_row_id uuid;
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
        billing_party_id, consignor_id, consignee_id,
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
        (v_item->>'billing_party_id')::bigint, (v_item->>'consignor_id')::bigint, (v_item->>'consignee_id')::bigint,
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

create or replace function public.lr_validate_purchase_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_po public.purchase_orders;
  v_party text;
  v_selection boolean;
begin
  if new.purchase_order_id is null then return new; end if;
  v_selection := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    v_selection := new.purchase_order_id is distinct from old.purchase_order_id
      or new.customer is distinct from old.customer
      or new.billing_party_id is distinct from old.billing_party_id;
  end if;
  -- SHARE serializes selection with a concurrent PO edit/deactivation.
  select * into v_po from public.purchase_orders where id = new.purchase_order_id for share;
  if not found then raise exception 'PO not found'; end if;
  select name into v_party from public.billing_parties where id = v_po.billing_party_id;
  if v_selection then
    if new.billing_party_id is not null then
      perform 1 from public.billing_parties where id = new.billing_party_id
        and coalesce(entry_status, 'final') = 'final' for share;
      if not found then raise exception 'Billing party must be finalized before selecting a PO'; end if;
      if new.billing_party_id is distinct from v_po.billing_party_id then
        raise exception 'PO does not belong to the selected billing party';
      end if;
    else
    if (select count(*) from public.billing_parties
      where upper(trim(name)) = upper(trim(new.customer)) and coalesce(entry_status, 'final') = 'final') <> 1 then
      raise exception 'Billing party must resolve to exactly one finalized master record';
    end if;
    if upper(trim(new.customer)) is distinct from upper(trim(v_party)) then
      raise exception 'PO does not belong to the selected billing party';
    end if;
    end if;
    if v_po.status <> 'Active' then raise exception 'Choose an active PO'; end if;
    new.po_number := v_po.po_number;
    new.po_date := v_po.issue_date;
  elsif new.po_number is distinct from old.po_number or new.po_date is distinct from old.po_date then
    if new.po_number is distinct from v_po.po_number
       or new.po_date is distinct from v_po.issue_date then
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

create or replace function public.lr_create_purchase_order_from_snapshot() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_party_id bigint; v_po_id bigint;
begin
 if new.entry_status <> 'final' or nullif(trim(new.po_number),'') is null or new.po_date is null then return new; end if;
 -- Use the trusted binding when present; legacy rows keep their existing PO behavior.
 v_party_id := new.billing_party_id;
 if v_party_id is not null then
   perform 1 from public.billing_parties where id = v_party_id
     and coalesce(entry_status, 'final') = 'final' for share;
   if not found then raise exception 'Billing party must be finalized before adding a PO'; end if;
 else
   select id into v_party_id from public.billing_parties where upper(trim(name))=upper(trim(new.customer)) and coalesce(entry_status,'final')='final';
 end if;
 if v_party_id is null then raise exception 'Billing party must be finalized before adding a PO'; end if;
 select id into v_po_id from public.purchase_orders where billing_party_id=v_party_id and upper(trim(coalesce(consignor,'')))=upper(trim(new.consignor)) and upper(trim(po_number))=upper(trim(new.po_number));
 if v_po_id is null then insert into public.purchase_orders(billing_party_id,consignor,po_number,issue_date,allotted_weight,status) values(v_party_id,new.consignor,new.po_number,new.po_date,null,'Active') returning id into v_po_id; end if;
 update public.lrs set purchase_order_id=v_po_id where id=new.id;
 return new;
end;
$$;

create or replace function public.lr_derive_route_from_master() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_from text; v_to text;
begin
  if new.entry_status <> 'final' then return new; end if;
  if new.consignor_id is not null then
    select city into v_from from public.customers where id = new.consignor_id
      and coalesce(entry_status, 'final') = 'final' for share;
  else
  select city into v_from from public.customers
    where upper(trim(name)) = upper(trim(new.consignor)) and coalesce(entry_status, 'final') = 'final';
  end if;
  if new.consignee_id is not null then
    select city into v_to from public.customers where id = new.consignee_id
      and coalesce(entry_status, 'final') = 'final' for share;
  else
  select city into v_to from public.customers
    where upper(trim(name)) = upper(trim(new.consignee)) and coalesce(entry_status, 'final') = 'final';
  end if;
  if nullif(trim(v_from), '') is null then raise exception 'Consignor city is required in Customer Master'; end if;
  if nullif(trim(v_to), '') is null then raise exception 'Consignee city is required in Customer Master'; end if;
  -- Party selection fills the default in the browser. Preserve a staff-entered
  -- route when the actual pickup or delivery location differs from the master.
  if nullif(trim(new.from_station), '') is null then new.from_station := v_from; end if;
  if nullif(trim(new.to_station), '') is null then new.to_station := v_to; end if;
  return new;
end;
$$;

create or replace function public.get_lr_purchase_orders(p_billing_party text, p_consignor text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not (public.has_permission('lr', 'create_view') or public.has_permission('lr', 'edit')) then raise exception 'Not permitted'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'billing_party_id',p.billing_party_id,'po_number',p.po_number,'issue_date',p.issue_date) order by p.issue_date desc,p.id desc),'[]'::jsonb) from public.purchase_orders p join public.billing_parties b on b.id=p.billing_party_id where upper(trim(b.name))=upper(trim(p_billing_party)) and upper(trim(coalesce(p.consignor,'')))=upper(trim(p_consignor)) and p.status='Active');
end;
$$;

-- ID-bound lookup survives Billing Party renames. Existing name-based overload
-- remains available unchanged in meaning for legacy clients and NULL-ID LRs.
create function public.get_lr_purchase_orders_by_party_id(p_billing_party_id bigint, p_consignor text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')) then raise exception 'Not permitted'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'billing_party_id', p.billing_party_id, 'po_number', p.po_number,
    'issue_date', p.issue_date) order by p.issue_date desc, p.id desc), '[]'::jsonb)
    from public.purchase_orders p
    where p.billing_party_id = p_billing_party_id
      and upper(trim(coalesce(p.consignor, ''))) = upper(trim(p_consignor))
      and p.status = 'Active');
end;
$$;
revoke all on function public.get_lr_purchase_orders_by_party_id(bigint, text) from public, anon;
grant execute on function public.get_lr_purchase_orders_by_party_id(bigint, text) to authenticated;

create or replace function public.lr_edit_field_diffs(
  p_old public.lrs,
  p_new public.lrs
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'field_key', d.field_key,
        'field_label', d.field_label,
        'old_value', coalesce(to_jsonb(p_old) ->> d.field_key, ''),
        'new_value', coalesce(to_jsonb(p_new) ->> d.field_key, '')
      )
      order by d.field_key
    ),
    '[]'::jsonb
  )
  from (
    values
      ('bill_rate', 'Bill Rate'),
      ('bill_rate_type', 'Bill Rate Type'),
      ('charged_weight', 'Charged Weight'),
      ('consignee', 'Consignee'),
      ('consignee_gst', 'Consignee GST'),
      ('consignor', 'Consignor'),
      ('customer', 'Billing Party'),
      ('billing_party_id', 'Billing Party Identity'),
      ('consignor_id', 'Consignor Identity'),
      ('consignee_id', 'Consignee Identity'),
      ('driver_mobile', 'Driver Mobile'),
      ('driver_name', 'Driver Name'),
      ('freight_type', 'Freight Type'),
      ('from_station', 'From Location'),
      ('to_station', 'To Location'),
      ('guaranteed_weight', 'Guaranteed Weight'),
      ('loading_weight', 'Loading Weight'),
      ('lorry_hire_rate', 'Lorry Hire Rate'),
      ('lorry_hire_type', 'Lorry Hire Type'),
      ('lr_date', 'LR Date'),
      ('material', 'Material'),
      ('package_type', 'Package Type'),
      ('packages', 'Packages'),
      ('transporter', 'Transporter'),
      ('unloading_weight', 'Unloading Weight'),
      ('vehicle_number', 'Vehicle Number'),
      ('vehicle_type', 'Vehicle Type'),
      ('vendor_code', 'Vendor Code')
  ) as d(field_key, field_label)
  where (to_jsonb(p_old) -> d.field_key)
    is distinct from (to_jsonb(p_new) -> d.field_key);
$$;

-- CREATE OR REPLACE retains existing function ownership and execution grants.
commit;
