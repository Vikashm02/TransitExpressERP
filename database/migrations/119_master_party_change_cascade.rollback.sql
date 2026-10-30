-- Rollback for 119_master_party_change_cascade: the live definitions of the 8 rules
-- exactly as they were on 2026-10-30, before migration 119. Run in the SQL editor if ever needed, then:
--   drop trigger record_master_party_change on public.customers;
--   drop trigger record_master_party_change on public.billing_parties;
--   drop trigger bill_snapshot_billing_party on public.bills;
-- (bills party_* columns and master_party_changes can stay; they are harmless).
begin;

CREATE OR REPLACE FUNCTION public.record_lr_edit_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Preserve migration 038 qualification exactly: final -> final and a
  -- quality business-content change. Draft saves, finalization, status-only
  -- changes, and assignment-only changes do not create an event.
  if coalesce(OLD.entry_status, 'final') = 'final'
     and coalesce(NEW.entry_status, 'final') = 'final'
     and public.lr_has_quality_content_change(OLD, NEW) then
    insert into public.lr_edit_events (
      lr_id,
      edited_by,
      lr_created_by,
      edited_at,
      changes
    )
    values (
      NEW.id,
      coalesce(NEW.updated_by, auth.uid()),
      OLD.created_by,
      now(),
      public.lr_edit_field_diffs(OLD, NEW)
    );
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.lr_create_purchase_order_from_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_party_id bigint; v_po_id bigint; v_po public.purchase_orders;
begin
 if new.entry_status <> 'final' or nullif(trim(new.po_number),'') is null or new.po_date is null then return new; end if;
 -- Existing historical links are preserved above. A previously unlinked LR
 -- must never discover or attach a legacy PO without a Consignee identity.
 if new.purchase_order_id is not null then return new; end if;
 if new.material_id is null or new.consignee_id is null then
   raise exception 'Select Material and Consignee before creating a PO from this LR';
 end if;
 v_party_id := new.billing_party_id;
 if v_party_id is not null then
   perform 1 from public.billing_parties where id = v_party_id and coalesce(entry_status, 'final') = 'final' for share;
   if not found then raise exception 'Billing party must be finalized before adding a PO'; end if;
 else
   select id into v_party_id from public.billing_parties where upper(trim(name)) = upper(trim(new.customer)) and coalesce(entry_status,'final') = 'final';
 end if;
 if v_party_id is null then raise exception 'Billing party must be finalized before adding a PO'; end if;
 select * into v_po from public.purchase_orders where billing_party_id = v_party_id
   and upper(trim(coalesce(consignor,''))) = upper(trim(new.consignor))
   and consignee_id = new.consignee_id and upper(trim(po_number)) = upper(trim(new.po_number)) for share;
 if found then
   if v_po.material_id is distinct from new.material_id or v_po.status <> 'Active' then
     raise exception 'Existing PO number conflicts with selected Material or Active status';
   end if;
   v_po_id := v_po.id;
 else
   insert into public.purchase_orders(billing_party_id, consignor, consignee_id, material_id, po_number, issue_date, allotted_weight, status)
     values(v_party_id, new.consignor, new.consignee_id, new.material_id, new.po_number, new.po_date, null, 'Active') returning id into v_po_id;
 end if;
 update public.lrs set purchase_order_id = v_po_id where id = new.id;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.lr_derive_route_from_master()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.lr_validate_purchase_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_po public.purchase_orders; v_selection boolean; v_legacy_material_enrichment boolean := false;
begin
  if new.purchase_order_id is null then return new; end if;
  v_selection := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    v_legacy_material_enrichment := old.entry_status = 'final' and new.entry_status = 'final'
      and old.material_id is null and new.material_id is not null
      and old.purchase_order_id is not null and new.purchase_order_id is not distinct from old.purchase_order_id;
    v_selection := new.purchase_order_id is distinct from old.purchase_order_id
      or new.customer is distinct from old.customer
      or new.billing_party_id is distinct from old.billing_party_id
      or new.consignor is distinct from old.consignor
      or new.consignee_id is distinct from old.consignee_id
      or (new.material_id is distinct from old.material_id and not v_legacy_material_enrichment)
      or (old.entry_status = 'draft' and new.entry_status = 'final');
  end if;
  select * into v_po from public.purchase_orders where id = new.purchase_order_id for share;
  if not found then raise exception 'PO not found'; end if;
  if v_selection then
    if new.billing_party_id is null or new.billing_party_id is distinct from v_po.billing_party_id then
      raise exception 'PO does not belong to the selected Billing Party identity';
    end if;
    perform 1 from public.billing_parties where id = new.billing_party_id
      and coalesce(entry_status,'final') = 'final' for share;
    if not found then raise exception 'Billing party must be finalized before selecting a PO'; end if;
    if upper(trim(coalesce(new.consignor,''))) is distinct from upper(trim(coalesce(v_po.consignor,''))) then
      raise exception 'PO does not belong to the selected Consignor';
    end if;
    if new.consignee_id is null or new.consignee_id is distinct from v_po.consignee_id then
      raise exception 'PO does not belong to the selected Consignee identity';
    end if;
    if new.material_id is null or new.material_id is distinct from v_po.material_id then
      raise exception 'Select a PO for the explicitly selected Material';
    end if;
    if v_po.status <> 'Active' then raise exception 'Choose an active PO'; end if;
    new.po_number := v_po.po_number; new.po_date := v_po.issue_date;
  elsif v_legacy_material_enrichment then
    new.po_number := old.po_number; new.po_date := old.po_date;
  elsif new.po_number is distinct from old.po_number or new.po_date is distinct from old.po_date then
    if new.po_number is distinct from v_po.po_number or new.po_date is distinct from v_po.issue_date then
      raise exception 'Select a PO from the master to change its LR snapshot';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.entry_status = 'draft' and new.entry_status = 'final' and v_po.status <> 'Active' then
    raise exception 'PO is now inactive. Choose an active PO before finalizing';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transport_bid_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.bid_reference := nullif(trim(coalesce(new.bid_reference, '')), '');
  new.billing_party_name := trim(coalesce(new.billing_party_name, ''));
  new.pickup_location := trim(new.pickup_location);
  new.dropoff_location := trim(new.dropoff_location);
  new.vehicle_type := nullif(trim(coalesce(new.vehicle_type, '')), '');
  new.material_name := trim(coalesce(new.material_name, ''));
  new.material_description := nullif(trim(coalesce(new.material_description, '')), '');

  if not exists (select 1 from public.billing_parties
    where id = new.billing_party_id and coalesce(entry_status, 'final') = 'final') then
    raise exception 'Choose a finalized billing party';
  end if;

  if new.consignor_id is not null
    and not exists (select 1 from public.customers where id = new.consignor_id) then
    raise exception 'Choose a consignor from Customer Master';
  end if;
  if new.consignee_id is not null
    and not exists (select 1 from public.customers where id = new.consignee_id) then
    raise exception 'Choose a consignee from Customer Master';
  end if;
  if new.material_id is not null
    and not exists (select 1 from public.materials where id = new.material_id) then
    raise exception 'Choose a material from Material Master';
  end if;

  if tg_op = 'INSERT'
    or new.billing_party_id is distinct from old.billing_party_id then
    select name into new.billing_party_name
    from public.billing_parties where id = new.billing_party_id;
  else
    new.billing_party_name := old.billing_party_name;
  end if;
  if tg_op = 'INSERT' or new.consignor_id is distinct from old.consignor_id then
    if new.consignor_id is null then
      new.consignor_name := '';
    else
      select name into new.consignor_name
      from public.customers where id = new.consignor_id;
    end if;
  else
    new.consignor_name := old.consignor_name;
  end if;
  if tg_op = 'INSERT' or new.consignee_id is distinct from old.consignee_id then
    if new.consignee_id is null then
      new.consignee_name := '';
    else
      select name into new.consignee_name
      from public.customers where id = new.consignee_id;
    end if;
  else
    new.consignee_name := old.consignee_name;
  end if;
  if tg_op = 'INSERT' or new.material_id is distinct from old.material_id then
    if new.material_id is null then
      new.material_name := '';
    else
      select material_name into new.material_name
      from public.materials where id = new.material_id;
    end if;
  else
    new.material_name := old.material_name;
  end if;

  if new.winning_rate is not null and new.winning_rate_basis is null then
    raise exception 'Winning rate requires a rate basis (Per MT or Per Vehicle)';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.status in ('Won', 'Lost') and not public.is_admin() then
      if new.status is distinct from old.status
        or new.billing_party_id is distinct from old.billing_party_id
        or new.consignor_id is distinct from old.consignor_id
        or new.consignee_id is distinct from old.consignee_id
        or new.pickup_location is distinct from old.pickup_location
        or new.dropoff_location is distinct from old.dropoff_location
        or new.distance_km is distinct from old.distance_km
        or new.material_id is distinct from old.material_id
        or new.material_description is distinct from old.material_description
        or new.vehicle_type is distinct from old.vehicle_type
        or new.total_quantity_mt is distinct from old.total_quantity_mt
        or new.expected_load_mt is distinct from old.expected_load_mt
        or new.market_vehicle_quote is distinct from old.market_vehicle_quote
        or new.market_vehicle_cost_basis is distinct from old.market_vehicle_cost_basis
        or new.bid_rate_basis is distinct from old.bid_rate_basis
        or new.bid_rate is distinct from old.bid_rate then
        raise exception 'Closed bid economics are frozen; ask an administrator to correct them';
      end if;
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_order_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_consignee text;
begin
  new.po_number := upper(trim(new.po_number));
  if not exists (
    select 1 from public.billing_parties
    where id = new.billing_party_id and coalesce(entry_status, 'final') = 'final'
  ) then
    raise exception 'Choose a finalized billing party';
  end if;

  if tg_op = 'INSERT' and new.consignee_id is null then
    raise exception 'Choose a consignee from Customer Master';
  end if;
  if tg_op = 'UPDATE' and old.consignee_id is not null and new.consignee_id is null then
    raise exception 'An assigned PO Consignee cannot be cleared';
  end if;
  if new.consignee_id is not null then
    select name into v_consignee from public.customers
      where id = new.consignee_id and coalesce(entry_status, 'final') = 'final'
      for share;
    if not found then raise exception 'Choose a finalized consignee from Customer Master'; end if;
  end if;

  if tg_op = 'INSERT' then
    new.consignee := v_consignee;
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.consignee_id is distinct from old.consignee_id then
      new.consignee := v_consignee;
    else
      new.consignee := old.consignee;
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_consignee_conversations_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_by := auth.uid();
    new.updated_at := now();

    new.ai_status := 'pending';
    new.ai_processed_at := null;
    new.ai_category := null;
    new.ai_subcategory := null;
    new.ai_issue_summary := null;
    new.ai_impact := null;
    new.ai_conclusion := null;
    new.ai_nature := null;
    new.ai_nature_confidence := null;
    new.ai_resolution_text := null;
    new.ai_resolution_date := null;
    new.ai_raw_response := null;
    new.follow_up_due_date := null;

    return new;
  end if;

  if TG_OP = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.original_remark := old.original_remark;
    new.input_type := old.input_type;
    new.customer_id := old.customer_id;
    new.customer_name := old.customer_name;
    new.customer_code := old.customer_code;

    -- Service-side AI path: no user JWT, so auth.uid() is null.
    -- Do not treat this as a human edit.
    if auth.uid() is null then
      new.updated_by := old.updated_by;
      new.updated_at := old.updated_at;
    else
      new.updated_by := auth.uid();
      new.updated_at := now();
    end if;

    return new;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.make_purchase_order_permanent(p_purchase_order_id bigint, p_po_number text, p_issue_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_po public.purchase_orders;
  v_new text := upper(trim(coalesce(p_po_number, '')));
  v_old text;
  v_lr_count integer;
  v_bills jsonb;
begin
  if auth.uid() is null or not public.has_module_action('purchase_orders', 'edit') then
    raise exception 'You do not have permission to edit POs in PO Master.';
  end if;
  if v_new = '' then
    raise exception 'Enter the permanent PO number.';
  end if;
  if p_issue_date is null then
    raise exception 'Enter the permanent PO date.';
  end if;

  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if not found then
    raise exception 'This PO was not found. Refresh PO Master and try again.';
  end if;
  if not coalesce(v_po.is_temporary, false) then
    raise exception 'PO % is already permanent.', v_po.po_number;
  end if;
  if exists (
    select 1 from public.purchase_orders
    where billing_party_id = v_po.billing_party_id
      and upper(trim(po_number)) = v_new
      and id <> v_po.id
  ) then
    raise exception 'PO number % already exists for this billing party. Check the number, or ask your administrator to merge the two POs.', v_new;
  end if;

  v_old := v_po.po_number;

  update public.purchase_orders
  set po_number = v_new, issue_date = p_issue_date, is_temporary = false
  where id = v_po.id;

  -- System refresh of linked LR snapshots to the PO master values: no
  -- per-LR "LR updated" alert (purchase_order_audit records each LR change).
  perform set_config('app.suppress_lr_updated_notifications', 'on', true);
  update public.lrs
  set po_number = v_new, po_date = p_issue_date
  where purchase_order_id = v_po.id
    and (po_number is distinct from v_new or po_date is distinct from p_issue_date);
  get diagnostics v_lr_count = row_count;
  perform set_config('app.suppress_lr_updated_notifications', 'off', true);

  select coalesce(jsonb_agg(jsonb_build_object('billNumber', b.bill_number, 'billDate', b.bill_date) order by b.bill_date), '[]'::jsonb)
    into v_bills
  from public.bills b
  where b.billing_party_id = v_po.billing_party_id
    and upper(trim(coalesce(b.po_number, ''))) = upper(trim(v_old));

  return jsonb_build_object(
    'oldPoNumber', v_old,
    'newPoNumber', v_new,
    'lrsUpdated', v_lr_count,
    'billsWithOldNumber', v_bills
  );
end;
$function$;

commit;
