-- 128 ROLLBACK: exact live definitions before 128. Run only if NO LR has
-- been reserved yet (the reserved_* columns are kept, never dropped, so no
-- data is lost; reserved drafts would just lose their special 48-hour rule).

begin;

CREATE OR REPLACE FUNCTION public.allocate_next_lr_number()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint;
  v_prefix text;
  v_length integer;
  v_next integer;
  v_number text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Create OR Edit may allocate (draft reservation or direct final create).
  if not (
    public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')
  ) then
    raise exception 'Not permitted to allocate LR numbers';
  end if;

  select id, coalesce(lr_prefix, ''), coalesce(lr_prefix_length, 4), coalesce(lr_running_number, 0)
    into v_id, v_prefix, v_length, v_next
  from public.company_settings
  order by id
  limit 1
  for update;

  if v_id is null then
    raise exception 'Company settings are not configured';
  end if;

  v_next := v_next + 1;
  if v_length < length(v_next::text) then
    v_length := length(v_next::text);
  end if;

  v_number := v_prefix || lpad(v_next::text, v_length, '0');

  update public.company_settings
  set lr_running_number = v_next
  where id = v_id;

  return v_number;
end;
$function$;

drop policy lrs_update_own_or_admin on public.lrs;
create policy lrs_update_own_or_admin on public.lrs
  as permissive for update to authenticated
  using ((((has_permission('lr'::text, 'edit'::text) OR ((entry_status = 'draft'::text) AND has_permission('lr'::text, 'create_view'::text))) AND staff_within_48h_edit_window(created_at)) OR ((auth.uid() = '15e8e879-4a4b-4805-a7af-ea332fd0b895'::uuid) AND (entry_status = 'draft'::text) AND (lr_number = ANY (ARRAY['LR19646'::text, 'LR19647'::text])))))
  with check ((((has_permission('lr'::text, 'edit'::text) OR has_permission('lr'::text, 'create_view'::text)) AND staff_within_48h_edit_window(created_at)) OR ((auth.uid() = '15e8e879-4a4b-4805-a7af-ea332fd0b895'::uuid) AND (lr_number = ANY (ARRAY['LR19646'::text, 'LR19647'::text])))));

CREATE OR REPLACE FUNCTION public.create_replacement_purchase_order_from_lr(p_lr_id uuid, p_po_number text, p_issue_date date)
 RETURNS lrs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

drop trigger if exists a_lr_protect_reservation on public.lrs;
drop function if exists public.lr_protect_reservation();
drop function if exists public.reserve_lr_number(bigint, date);
drop function if exists public.cancel_reserved_lr(uuid);
drop function if exists public.staff_within_lr_edit_window(timestamptz, timestamptz, text, timestamptz);

commit;
