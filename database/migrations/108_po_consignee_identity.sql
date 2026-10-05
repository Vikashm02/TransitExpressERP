-- Purchase-order Consignee identity. Forward-only, no historical backfill.
-- New PO selection uses stable Customer Master IDs; display snapshots are frozen.
-- Do not apply during this task. This migration does not alter LR numbering.
begin;
set local lock_timeout = '5s';

alter table public.purchase_orders
  add column consignee_id bigint references public.customers(id) on delete restrict,
  add column consignee text;

create index purchase_orders_active_consignee_material_lookup_idx
  on public.purchase_orders (
    billing_party_id,
    upper(trim(coalesce(consignor, ''))),
    consignee_id,
    material_id
  )
  where status = 'Active' and consignee_id is not null and material_id is not null;

-- New POs require a finalized Customer Master identity. Snapshot text is server
-- derived on insert/identity change and otherwise remains historical.
create or replace function public.purchase_order_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
revoke all on function public.purchase_order_before_write() from public, anon, authenticated;

-- Signature changes deliberately remove the old three-condition RPC so it
-- cannot be used to bypass the Consignee condition.
drop function public.get_lr_purchase_orders_by_party_material_id(bigint, text, bigint);
create function public.get_lr_purchase_orders_by_party_consignee_material_id(
  p_billing_party_id bigint, p_consignor text, p_consignee_id bigint, p_material_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_permission('lr','create_view') or public.has_permission('lr','edit')) then
    raise exception 'Not permitted';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'billing_party_id', p.billing_party_id, 'consignee_id', p.consignee_id,
    'material_id', p.material_id, 'po_number', p.po_number, 'issue_date', p.issue_date)
    order by p.issue_date desc, p.id desc), '[]'::jsonb)
    from public.purchase_orders p
    where p.billing_party_id = p_billing_party_id
      and upper(trim(coalesce(p.consignor,''))) = upper(trim(p_consignor))
      and p.consignee_id = p_consignee_id
      and p.material_id = p_material_id
      and p.status = 'Active');
end;
$$;
revoke all on function public.get_lr_purchase_orders_by_party_consignee_material_id(bigint, text, bigint, bigint) from public, anon;
grant execute on function public.get_lr_purchase_orders_by_party_consignee_material_id(bigint, text, bigint, bigint) to authenticated;

create function public.get_purchase_order_customers() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_module_action('purchase_orders','create')
    or public.has_module_action('purchase_orders','edit')) then raise exception 'Not permitted'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code)
    order by name, id), '[]'::jsonb) from public.customers
    where coalesce(entry_status, 'final') = 'final');
end;
$$;
revoke all on function public.get_purchase_order_customers() from public, anon;
grant execute on function public.get_purchase_order_customers() to authenticated;

create or replace function public.get_purchase_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.has_permission('purchase_orders','view') then raise exception 'Not permitted to view PO master'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc),'[]'::jsonb) from (
   select p.id,p.billing_party_id,b.name as billing_party_name,p.consignor,p.consignee_id,p.consignee,p.po_number,p.issue_date,
     p.allotted_weight,p.status,p.material_id,m.material_name,
     coalesce((select sum(l.loading_weight) from public.lrs l where l.purchase_order_id=p.id
       and l.entry_status='final' and l.status is distinct from 'Cancelled'),0) as used_weight
   from public.purchase_orders p join public.billing_parties b on b.id=p.billing_party_id
   left join public.materials m on m.id=p.material_id) r);
end;
$$;
revoke all on function public.get_purchase_orders() from public, anon;
grant execute on function public.get_purchase_orders() to authenticated;

create or replace function public.lr_validate_purchase_order() returns trigger
language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function public.lr_validate_purchase_order() from public, anon, authenticated;

create or replace function public.lr_create_purchase_order_from_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function public.lr_create_purchase_order_from_snapshot() from public, anon, authenticated;
grant execute on function public.lr_create_purchase_order_from_snapshot() to authenticated;

create or replace function public.create_replacement_purchase_order_from_lr(
  p_lr_id uuid, p_po_number text, p_issue_date date)
returns public.lrs language plpgsql security definer set search_path = '' as $$
declare v_lr public.lrs%rowtype; v_old_po public.purchase_orders%rowtype; v_new_po public.purchase_orders%rowtype;
  v_billing_party_id bigint; v_billing_party_count integer; v_normalized_po_number text; v_updated_lr public.lrs%rowtype;
begin
 if auth.uid() is null then raise exception 'Not authenticated'; end if;
 if not public.has_permission('lr', 'edit') then raise exception 'Not permitted to edit this LR'; end if;
 select * into v_lr from public.lrs where id = p_lr_id for update;
 if not found then raise exception 'LR not found'; end if;
 if coalesce(v_lr.entry_status, 'final') <> 'final' then raise exception 'Replacement PO can only be created for a finalized LR'; end if;
 if not public.staff_within_48h_edit_window(v_lr.created_at) then raise exception 'The 48-hour staff edit window for this LR has expired'; end if;
 if v_lr.purchase_order_id is null then raise exception 'This LR is not linked to a PO'; end if;
 select * into v_old_po from public.purchase_orders where id = v_lr.purchase_order_id for share;
 if not found then raise exception 'Current PO not found'; end if;
 if v_old_po.status <> 'Inactive' then raise exception 'A replacement PO can only be created when the current PO is Inactive'; end if;
 v_normalized_po_number := upper(trim(coalesce(p_po_number, '')));
 if v_normalized_po_number = '' or length(v_normalized_po_number) > 100 then raise exception 'Enter a PO number between 1 and 100 characters'; end if;
 if p_issue_date is null then raise exception 'Enter a PO issue date'; end if;
 if v_lr.material_id is null then raise exception 'Select and save a Material on this LR before creating a replacement PO'; end if;
 if v_lr.consignee_id is null then raise exception 'Select and save a Consignee on the LR before creating a replacement PO'; end if;
 select count(*)::integer, min(id) into v_billing_party_count, v_billing_party_id from public.billing_parties
   where upper(trim(name)) = upper(trim(v_lr.customer)) and coalesce(entry_status, 'final') = 'final';
 if v_billing_party_count <> 1 then raise exception 'Billing party must resolve to exactly one finalized master record'; end if;
 if nullif(trim(v_lr.consignor), '') is null then raise exception 'Consignor is required to create a replacement PO'; end if;
 if exists (select 1 from public.purchase_orders where billing_party_id = v_billing_party_id
   and upper(trim(coalesce(consignor, ''))) = upper(trim(v_lr.consignor))
   and upper(trim(po_number)) = v_normalized_po_number) then
   raise exception 'A PO with this number already exists for this Billing Party and Consignor';
 end if;
 insert into public.purchase_orders(billing_party_id, material_id, consignor, consignee_id, po_number, issue_date, allotted_weight, status)
   values(v_billing_party_id, v_lr.material_id, v_lr.consignor, v_lr.consignee_id, v_normalized_po_number, p_issue_date, null, 'Active') returning * into v_new_po;
 update public.lrs set purchase_order_id = v_new_po.id, po_number = v_new_po.po_number, po_date = v_new_po.issue_date
   where id = v_lr.id returning * into v_updated_lr;
 return v_updated_lr;
end;
$$;
revoke all on function public.create_replacement_purchase_order_from_lr(uuid, text, date) from public, anon;
grant execute on function public.create_replacement_purchase_order_from_lr(uuid, text, date) to authenticated;

commit;
