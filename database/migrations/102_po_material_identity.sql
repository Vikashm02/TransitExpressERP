-- Stage 1: Material-bound PO selection. Requires deployed M094 and M100.
-- Manual application only. No backfill, uniqueness/RLS changes, or historical RPC replacement.
-- Old PO inserts remain nullable until separately reviewed Stage 2 (103).
-- New PO selection/creation from LRs requires identities: coordinate the application rollout.
begin;
set local lock_timeout = '5s';
alter table public.purchase_orders add column material_id bigint references public.materials(id) on delete restrict;
alter table public.lrs add column material_id bigint references public.materials(id) on delete restrict;
create index purchase_orders_active_material_lookup_idx on public.purchase_orders
 (billing_party_id, upper(trim(coalesce(consignor, ''))), material_id)
 where status = 'Active' and material_id is not null;
create index purchase_orders_material_id_idx on public.purchase_orders(material_id) where material_id is not null;
create index lrs_material_id_idx on public.lrs(material_id) where material_id is not null;

create function public.lr_validate_material_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
 if tg_op = 'UPDATE' then
   if new.material_id is not distinct from old.material_id then
     -- Only a new explicit ID establishes a new snapshot, never description/text matching.
     new.material := old.material;
     return new;
   end if;
 end if;
 if new.material_id is not null then
   select material_name into v_name from public.materials where id = new.material_id for share;
   if not found then raise exception 'Select a valid Material Master record'; end if;
   new.material := v_name;
 end if;
 return new;
end;
$$;
revoke all on function public.lr_validate_material_identity() from public, anon, authenticated;
create trigger a_lr_validate_material_identity before insert or update on public.lrs
 for each row execute function public.lr_validate_material_identity();

create function public.get_lr_purchase_orders_by_party_material_id(
 p_billing_party_id bigint, p_consignor text, p_material_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not (public.has_permission('lr','create_view') or public.has_permission('lr','edit')) then
   raise exception 'Not permitted';
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'billing_party_id',p.billing_party_id,
   'material_id',p.material_id,'po_number',p.po_number,'issue_date',p.issue_date)
   order by p.issue_date desc,p.id desc),'[]'::jsonb)
 from public.purchase_orders p where p.billing_party_id=p_billing_party_id
 and upper(trim(coalesce(p.consignor,'')))=upper(trim(p_consignor))
 and p.material_id=p_material_id and p.status='Active');
end;
$$;
revoke all on function public.get_lr_purchase_orders_by_party_material_id(bigint,text,bigint) from public, anon;
grant execute on function public.get_lr_purchase_orders_by_party_material_id(bigint,text,bigint) to authenticated;

-- PO users need only PO permissions, not Material Master or LR permissions.
create function public.get_purchase_order_materials() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not (public.has_module_action('purchase_orders','create')
   or public.has_module_action('purchase_orders','edit')) then raise exception 'Not permitted'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'material_name',material_name)
   order by material_name,id),'[]'::jsonb) from public.materials
   where status='Active' and canonical_material_id is null);
end;
$$;
revoke all on function public.get_purchase_order_materials() from public, anon;
grant execute on function public.get_purchase_order_materials() to authenticated;

create or replace function public.get_purchase_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.has_permission('purchase_orders','view') then raise exception 'Not permitted to view PO master'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc),'[]'::jsonb) from (
   select p.id,p.billing_party_id,b.name as billing_party_name,p.consignor,p.po_number,p.issue_date,
     p.allotted_weight,p.status,p.material_id,m.material_name,
     coalesce((select sum(l.loading_weight) from public.lrs l where l.purchase_order_id=p.id
       and l.entry_status='final' and l.status is distinct from 'Cancelled'),0) as used_weight
   from public.purchase_orders p join public.billing_parties b on b.id=p.billing_party_id
   left join public.materials m on m.id=p.material_id) r);
end;
$$;

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
    material_id,
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
    nullif(p_payload->>'material_id', '')::bigint,
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

create or replace function public.lr_validate_purchase_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_po public.purchase_orders;
  v_party text;
  v_selection boolean;
  v_legacy_material_enrichment boolean := false;
begin
  if new.purchase_order_id is null then return new; end if;
  v_selection := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    v_legacy_material_enrichment := old.entry_status = 'final' and new.entry_status = 'final'
      and old.material_id is null and new.material_id is not null
      and old.purchase_order_id is not null
      and new.purchase_order_id is not distinct from old.purchase_order_id;
    v_selection := new.purchase_order_id is distinct from old.purchase_order_id
      or new.customer is distinct from old.customer
      or new.billing_party_id is distinct from old.billing_party_id
      or new.consignor is distinct from old.consignor
      or (new.material_id is distinct from old.material_id and not v_legacy_material_enrichment)
      or (old.entry_status = 'draft' and new.entry_status = 'final');
  end if;
  -- SHARE serializes selection with a concurrent PO edit/deactivation.
  select * into v_po from public.purchase_orders where id = new.purchase_order_id for share;
  if not found then raise exception 'PO not found'; end if;
  select name into v_party from public.billing_parties where id = v_po.billing_party_id;
  if v_selection then
    if new.billing_party_id is null or new.billing_party_id is distinct from v_po.billing_party_id then
      raise exception 'PO does not belong to the selected Billing Party identity';
    end if;
    perform 1 from public.billing_parties where id=new.billing_party_id
      and coalesce(entry_status,'final')='final' for share;
    if not found then raise exception 'Billing party must be finalized before selecting a PO'; end if;
    if upper(trim(coalesce(new.consignor,''))) is distinct from upper(trim(coalesce(v_po.consignor,''))) then
      raise exception 'PO does not belong to the selected Consignor';
    end if;
    if new.material_id is null or new.material_id is distinct from v_po.material_id then
      raise exception 'Select a PO for the explicitly selected Material';
    end if;
    if v_po.status <> 'Active' then raise exception 'Choose an active PO'; end if;
    new.po_number := v_po.po_number;
    new.po_date := v_po.issue_date;
  elsif v_legacy_material_enrichment then
    -- Identity enrichment is not permission to refresh or rewrite the historical PO snapshot.
    new.po_number := old.po_number;
    new.po_date := old.po_date;
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
declare v_party_id bigint; v_po_id bigint; v_po public.purchase_orders;
begin
 if new.entry_status <> 'final' or nullif(trim(new.po_number),'') is null or new.po_date is null then return new; end if;
 -- An already attached PO has been checked by the BEFORE validator. Preserve legacy links.
 if new.purchase_order_id is not null then return new; end if;
 if new.material_id is null then raise exception 'Select Material before creating a PO from this LR'; end if;
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
 select * into v_po from public.purchase_orders where billing_party_id=v_party_id
   and upper(trim(coalesce(consignor,'')))=upper(trim(new.consignor))
   and upper(trim(po_number))=upper(trim(new.po_number)) for share;
 if found then
   if v_po.material_id is distinct from new.material_id or v_po.status <> 'Active' then
     raise exception 'Existing PO number conflicts with selected Material or Active status';
   end if;
   v_po_id := v_po.id;
 else
   insert into public.purchase_orders(billing_party_id,consignor,material_id,po_number,issue_date,allotted_weight,status)
   values(v_party_id,new.consignor,new.material_id,new.po_number,new.po_date,null,'Active') returning id into v_po_id;
 end if;
 update public.lrs set purchase_order_id=v_po_id where id=new.id;
 return new;
end;
$$;

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

  if v_lr.material_id is null then
    raise exception 'Select and save a Material on this LR before creating a replacement PO';
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
    material_id,
    consignor,
    po_number,
    issue_date,
    allotted_weight,
    status
  )
  values (
    v_billing_party_id,
    v_lr.material_id,
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
      ('material_id', 'Material Identity'),
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

-- Replacements retain existing ownership and grants; no existing triggers are dropped.
commit;
