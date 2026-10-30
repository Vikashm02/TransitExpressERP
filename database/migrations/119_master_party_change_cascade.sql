-- ==========================================================
-- Migration: 119_master_party_change_cascade
-- Module:    Customer / Billing Party Master → update older records
--
-- NOT executed automatically — review and run manually in the Supabase SQL
-- editor, in one go. Everything runs in one transaction.
--
-- What it does:
--   A. Bills keep the billing party name / address / city / GST they were
--      made with (new party_* columns). Existing bills are filled from
--      today's master, which is exactly what their reprints show today, so
--      nothing visible changes. New bills copy the details when created.
--   B. Every saved change to a final customer or billing party's name, GST,
--      address or city is recorded in master_party_changes (old → new).
--   C. master_party_change(type, id, action) — every approved update keeps
--      the exact old value of each field it changes (master_party_updates /
--      master_party_update_items), so it can be undone:
--        'preview'          → counts of LRs, DCs, POs, Bids, conversations and
--                             bills that use the party (no change)
--        'apply'            → updates those older records (not bills)
--        'apply_with_bills' → also updates the existing bills (user approved
--                             the GST warning)
--        'skip'             → leaves older records as they are
--      Older LRs linked only by name are matched by the old name, but only
--      when no other master record has that name.
--   E. master_party_undo(update_id): puts the master back first, then every
--      changed value, only where nothing was changed again since.
--      master_party_history lists updates (with Undo) for the master pages.
--   D. A "system update" switch (app.system_snapshot_refresh) used only by C
--      and by Make Permanent (migration 118). While on, these existing rules
--      do not act: LR edit history (staff accuracy), PO auto-create from LR,
--      route defaults, LR PO re-validation for the same PO; and the frozen
--      name copies on Bids, POs (consignee) and consignee conversations are
--      allowed to keep the name the update sets. Normal saves are unchanged.
--      Each rule below is the exact live definition plus that one check.
--
-- Data safety:
--   - No row is deleted. Only new empty bill columns are filled (A).
--   - Older records change only when someone approves in the ERP (C).
--   - Bills change only with the explicit, separately ticked approval.
--   - Rollback: re-run the previous definitions of the 8 rules (live copies
--     kept with this migration's review notes), drop the two triggers.
-- ==========================================================

begin;

-- ---------- D. System update switch in existing rules (live definitions + one check) ----------
CREATE OR REPLACE FUNCTION public.record_lr_edit_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- System snapshot refresh (master rename / undo / Make Permanent) is not a staff edit.
  if coalesce(current_setting('app.system_snapshot_refresh', true), 'off') = 'on' then return new; end if;
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
 -- System snapshot refresh never creates or relinks POs.
 if coalesce(current_setting('app.system_snapshot_refresh', true), 'off') = 'on' then return new; end if;
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
  -- System snapshot refresh keeps the stored route as it is.
  if coalesce(current_setting('app.system_snapshot_refresh', true), 'off') = 'on' then return new; end if;
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
  -- System snapshot refresh of party names with the same PO link: nothing to validate.
  if tg_op = 'UPDATE' and coalesce(current_setting('app.system_snapshot_refresh', true), 'off') = 'on' and new.purchase_order_id is not distinct from old.purchase_order_id then return new; end if;
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
    -- System update (master change / undo) sets this copy itself.
    if not (coalesce(current_setting('app.system_snapshot_refresh', true), 'off') = 'on') then
      new.billing_party_name := old.billing_party_name;
    end if;
  end if;
  if tg_op = 'INSERT' or new.consignor_id is distinct from old.consignor_id then
    if new.consignor_id is null then
      new.consignor_name := '';
    else
      select name into new.consignor_name
      from public.customers where id = new.consignor_id;
    end if;
  else
    -- System update (master change / undo) sets this copy itself.
    if not (coalesce(current_setting('app.system_snapshot_refresh', true), 'off') = 'on') then
      new.consignor_name := old.consignor_name;
    end if;
  end if;
  if tg_op = 'INSERT' or new.consignee_id is distinct from old.consignee_id then
    if new.consignee_id is null then
      new.consignee_name := '';
    else
      select name into new.consignee_name
      from public.customers where id = new.consignee_id;
    end if;
  else
    -- System update (master change / undo) sets this copy itself.
    if not (coalesce(current_setting('app.system_snapshot_refresh', true), 'off') = 'on') then
      new.consignee_name := old.consignee_name;
    end if;
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
    elsif not (coalesce(current_setting('app.system_snapshot_refresh', true), 'off') = 'on') then
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
    -- System update (master change / undo) sets this copy itself.
    if not (coalesce(current_setting('app.system_snapshot_refresh', true), 'off') = 'on') then
      new.customer_name := old.customer_name;
    end if;
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
  perform set_config('app.system_snapshot_refresh', 'on', true);
  update public.lrs
  set po_number = v_new, po_date = p_issue_date
  where purchase_order_id = v_po.id
    and (po_number is distinct from v_new or po_date is distinct from p_issue_date);
  get diagnostics v_lr_count = row_count;
  perform set_config('app.suppress_lr_updated_notifications', 'off', true);
  perform set_config('app.system_snapshot_refresh', 'off', true);

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

-- ---------- A. Bills keep the billing party details they were made with ----------
alter table public.bills
  add column if not exists party_name text,
  add column if not exists party_address text,
  add column if not exists party_city text,
  add column if not exists party_gst text;

-- Fill from today's master = exactly what reprints show today (no visible
-- change). "Last updated" on bills is left untouched.
alter table public.bills disable trigger trg_bills_updated_at;
update public.bills b
set party_name = bp.name, party_address = bp.address, party_city = bp.city, party_gst = bp.gst
from public.billing_parties bp
where bp.id = b.billing_party_id and b.party_name is null;
alter table public.bills enable trigger trg_bills_updated_at;

create or replace function public.bill_snapshot_billing_party()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.party_name is null then
    select name, address, city, gst
      into new.party_name, new.party_address, new.party_city, new.party_gst
    from public.billing_parties where id = new.billing_party_id;
  end if;
  return new;
end;
$$;
revoke all on function public.bill_snapshot_billing_party() from public, anon, authenticated;
drop trigger if exists bill_snapshot_billing_party on public.bills;
create trigger bill_snapshot_billing_party
  before insert on public.bills
  for each row execute function public.bill_snapshot_billing_party();

-- ---------- B. History of customer / billing party detail changes ----------
create table if not exists public.master_party_changes (
  id bigint generated always as identity primary key,
  party_type text not null check (party_type in ('customer', 'billing_party')),
  party_id bigint not null,
  old_values jsonb not null,
  new_values jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'applied', 'skipped')),
  applied_by uuid,
  applied_at timestamptz,
  result jsonb
);
create index if not exists master_party_changes_pending
  on public.master_party_changes (party_type, party_id) where status = 'pending';
alter table public.master_party_changes enable row level security;
revoke all on public.master_party_changes from anon, authenticated;

create or replace function public.record_master_party_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Undo restoring the master is not a new change.
  if coalesce(current_setting('app.system_snapshot_refresh', true), 'off') = 'on' then
    return null;
  end if;
  if coalesce(old.entry_status, 'final') <> 'final' or coalesce(new.entry_status, 'final') <> 'final' then
    return null;
  end if;
  if (old.name, old.gst, old.address, old.city) is not distinct from (new.name, new.gst, new.address, new.city) then
    return null;
  end if;
  insert into public.master_party_changes (party_type, party_id, old_values, new_values, changed_by)
  values (
    case when tg_table_name = 'customers' then 'customer' else 'billing_party' end,
    new.id,
    jsonb_build_object('name', old.name, 'gst', old.gst, 'address', old.address, 'city', old.city),
    jsonb_build_object('name', new.name, 'gst', new.gst, 'address', new.address, 'city', new.city),
    auth.uid()
  );
  return null;
end;
$$;
revoke all on function public.record_master_party_change() from public, anon, authenticated;
drop trigger if exists record_master_party_change on public.customers;
create trigger record_master_party_change
  after update on public.customers
  for each row execute function public.record_master_party_change();
drop trigger if exists record_master_party_change on public.billing_parties;
create trigger record_master_party_change
  after update on public.billing_parties
  for each row execute function public.record_master_party_change();


-- ---------- C. Approved updates are kept with every old value (for Undo) ----------
create table if not exists public.master_party_updates (
  id bigint generated always as identity primary key,
  party_type text not null check (party_type in ('customer', 'billing_party')),
  party_id bigint not null,
  change_ids bigint[] not null,
  master_old jsonb not null,
  master_new jsonb not null,
  include_bills boolean not null default false,
  summary jsonb,
  applied_by uuid,
  applied_at timestamptz not null default now(),
  undone_by uuid,
  undone_at timestamptz,
  undo_result jsonb
);
alter table public.master_party_updates enable row level security;
revoke all on public.master_party_updates from anon, authenticated;

create table if not exists public.master_party_update_items (
  id bigint generated always as identity primary key,
  update_id bigint not null references public.master_party_updates(id) on delete restrict,
  table_name text not null check (table_name in ('lrs', 'purchase_orders', 'transport_bids', 'consignee_conversations', 'bills')),
  record_id text not null,
  column_name text not null,
  old_value text,
  new_value text
);
create index if not exists master_party_update_items_update on public.master_party_update_items (update_id);
alter table public.master_party_update_items enable row level security;
revoke all on public.master_party_update_items from anon, authenticated;

-- ---------- D. Preview / apply / skip ----------
-- p_action: 'preview' (counts only, no change) | 'apply' | 'apply_with_bills' | 'skip'
create or replace function public.master_party_change(
  p_party_type text,
  p_party_id bigint,
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perm text := case p_party_type when 'customer' then 'customers' when 'billing_party' then 'billing_parties' end;
  v_change_ids bigint[];
  v_first jsonb;
  v_name text; v_gst text; v_address text; v_city text;
  v_name_changed boolean; v_gst_changed boolean; v_address_changed boolean;
  v_old_names text[];
  v_safe_names text[];
  v_unsafe_names text[];
  v_po_a bigint[] := '{}';
  v_po_b bigint[] := '{}';
  v_bids bigint[] := '{}';
  v_convs bigint[] := '{}';
  v_bills bigint[] := '{}';
  v_lr_a_ids uuid[] := '{}';   -- customer: LRs where it is consignor; billing party: LRs billed to it
  v_lr_b_ids uuid[] := '{}';   -- customer: LRs where it is consignee
  v_skipped integer := 0;
  v_dcs integer := 0;
  v_result jsonb;
  v_update_id bigint;
begin
  if v_perm is null or p_action not in ('preview', 'apply', 'apply_with_bills', 'skip') then
    raise exception 'Unknown master change request.';
  end if;
  if auth.uid() is null or not public.has_module_action(v_perm, 'edit') then
    raise exception 'You do not have permission to edit this master.';
  end if;

  select array_agg(id order by id) into v_change_ids
  from public.master_party_changes
  where party_type = p_party_type and party_id = p_party_id and status = 'pending';
  if v_change_ids is null then
    return null;  -- nothing waiting
  end if;

  if p_action = 'skip' then
    update public.master_party_changes
    set status = 'skipped', applied_by = auth.uid(), applied_at = now()
    where id = any(v_change_ids);
    return jsonb_build_object('skipped', true);
  end if;

  if p_party_type = 'customer' then
    select name, gst, address, city into v_name, v_gst, v_address, v_city from public.customers where id = p_party_id;
  else
    select name, gst, address, city into v_name, v_gst, v_address, v_city from public.billing_parties where id = p_party_id;
  end if;
  if not found then raise exception 'This record was not found. Refresh and try again.'; end if;

  select old_values into v_first from public.master_party_changes where id = v_change_ids[1];
  v_name_changed := (v_first->>'name') is distinct from v_name;
  v_gst_changed := (v_first->>'gst') is distinct from v_gst;
  v_address_changed := (v_first->>'address') is distinct from v_address;

  -- Older records linked only by name: use every earlier name, but only names
  -- no other master record uses (otherwise another party's records could change).
  select array_agg(distinct upper(trim(c.old_values->>'name'))) into v_old_names
  from public.master_party_changes c
  where c.id = any(v_change_ids) and nullif(trim(c.old_values->>'name'), '') is not null;
  v_old_names := coalesce(v_old_names, '{}');
  if p_party_type = 'customer' then
    select coalesce(array_agg(n), '{}') into v_safe_names from unnest(v_old_names) n
      where not exists (select 1 from public.customers x where x.id <> p_party_id and upper(trim(x.name)) = n);
  else
    select coalesce(array_agg(n), '{}') into v_safe_names from unnest(v_old_names) n
      where not exists (select 1 from public.billing_parties x where x.id <> p_party_id and upper(trim(x.name)) = n);
  end if;
  select coalesce(array_agg(n), '{}') into v_unsafe_names from unnest(v_old_names) n where not (n = any(v_safe_names));

  if p_party_type = 'customer' then
    select coalesce(array_agg(id), '{}') into v_lr_a_ids from public.lrs
      where consignor_id = p_party_id or (consignor_id is null and upper(trim(consignor)) = any(v_safe_names));
    select coalesce(array_agg(id), '{}') into v_lr_b_ids from public.lrs
      where consignee_id = p_party_id or (consignee_id is null and upper(trim(consignee)) = any(v_safe_names));
    select count(*) into v_skipped from public.lrs
      where (consignor_id is null and upper(trim(consignor)) = any(v_unsafe_names))
         or (consignee_id is null and upper(trim(consignee)) = any(v_unsafe_names));
    if v_name_changed then
      select coalesce(array_agg(id), '{}') into v_po_a from public.purchase_orders where upper(trim(consignor)) = any(v_safe_names);
      select coalesce(array_agg(id), '{}') into v_po_b from public.purchase_orders where consignee_id = p_party_id;
      select coalesce(array_agg(id), '{}') into v_bids from public.transport_bids where consignor_id = p_party_id or consignee_id = p_party_id;
      select coalesce(array_agg(id), '{}') into v_convs from public.consignee_conversations where customer_id = p_party_id;
    end if;
  else
    if v_name_changed then
      select coalesce(array_agg(id), '{}') into v_lr_a_ids from public.lrs
        where billing_party_id = p_party_id or (billing_party_id is null and upper(trim(customer)) = any(v_safe_names));
      select count(*) into v_skipped from public.lrs
        where billing_party_id is null and upper(trim(customer)) = any(v_unsafe_names);
      select coalesce(array_agg(id), '{}') into v_bids from public.transport_bids where billing_party_id = p_party_id;
    end if;
    select coalesce(array_agg(id), '{}') into v_bills from public.bills where billing_party_id = p_party_id;
  end if;

  select count(*) into v_dcs from public.delivery_challans d
    where d.lr_number in (select lr_number from public.lrs where id = any(v_lr_a_ids || v_lr_b_ids));

  v_result := jsonb_build_object(
    'partyType', p_party_type,
    'oldValues', v_first,
    'newValues', jsonb_build_object('name', v_name, 'gst', v_gst, 'address', v_address, 'city', v_city),
    'changed', jsonb_build_object('name', v_name_changed, 'gst', v_gst_changed, 'address', v_address_changed),
    'lrs', (select count(distinct x) from unnest(v_lr_a_ids || v_lr_b_ids) x),
    'deliveryChallans', v_dcs,
    'purchaseOrders', (select count(distinct x) from unnest(v_po_a || v_po_b) x),
    'bids', cardinality(v_bids),
    'conversations', cardinality(v_convs),
    'bills', cardinality(v_bills),
    'olderLrsNotMatched', v_skipped
  );

  if p_action = 'preview' then
    return v_result;
  end if;

  insert into public.master_party_updates (party_type, party_id, change_ids, master_old, master_new, include_bills, applied_by)
  values (p_party_type, p_party_id, v_change_ids, v_first, v_result->'newValues', p_action = 'apply_with_bills', auth.uid())
  returning id into v_update_id;

  -- Keep every value that is about to change (exactly what Undo puts back).
  if p_party_type = 'customer' then
    insert into public.master_party_update_items (update_id, table_name, record_id, column_name, old_value, new_value)
    select v_update_id, 'lrs', l.id::text, x.col, x.old, x.new
    from public.lrs l
    cross join lateral (values
      ('consignor', l.consignor, v_name, v_name_changed and l.id = any(v_lr_a_ids)),
      ('consignor_gst', l.consignor_gst, v_gst, v_gst_changed and l.id = any(v_lr_a_ids)),
      ('consignor_address', l.consignor_address, v_address, v_address_changed and l.id = any(v_lr_a_ids)),
      ('consignee', l.consignee, v_name, v_name_changed and l.id = any(v_lr_b_ids)),
      ('consignee_gst', l.consignee_gst, v_gst, v_gst_changed and l.id = any(v_lr_b_ids)),
      ('consignee_address', l.consignee_address, v_address, v_address_changed and l.id = any(v_lr_b_ids))
    ) as x(col, old, new, applies)
    where l.id = any(v_lr_a_ids || v_lr_b_ids) and x.applies and x.old is distinct from x.new;

    insert into public.master_party_update_items (update_id, table_name, record_id, column_name, old_value, new_value)
    select v_update_id, 'purchase_orders', id::text, 'consignor', consignor, v_name from public.purchase_orders
      where id = any(v_po_a) and consignor is distinct from v_name
    union all
    select v_update_id, 'purchase_orders', id::text, 'consignee', consignee, v_name from public.purchase_orders
      where id = any(v_po_b) and consignee is distinct from v_name
    union all
    select v_update_id, 'transport_bids', id::text, 'consignor_name', consignor_name, v_name from public.transport_bids
      where id = any(v_bids) and consignor_id = p_party_id and consignor_name is distinct from v_name
    union all
    select v_update_id, 'transport_bids', id::text, 'consignee_name', consignee_name, v_name from public.transport_bids
      where id = any(v_bids) and consignee_id = p_party_id and consignee_name is distinct from v_name
    union all
    select v_update_id, 'consignee_conversations', id::text, 'customer_name', customer_name, v_name from public.consignee_conversations
      where id = any(v_convs) and customer_name is distinct from v_name;
  else
    insert into public.master_party_update_items (update_id, table_name, record_id, column_name, old_value, new_value)
    select v_update_id, 'lrs', id::text, 'customer', customer, v_name from public.lrs
      where id = any(v_lr_a_ids) and customer is distinct from v_name
    union all
    select v_update_id, 'transport_bids', id::text, 'billing_party_name', billing_party_name, v_name from public.transport_bids
      where id = any(v_bids) and billing_party_name is distinct from v_name;
    if p_action = 'apply_with_bills' then
      insert into public.master_party_update_items (update_id, table_name, record_id, column_name, old_value, new_value)
      select v_update_id, 'bills', b.id::text, x.col, x.old, x.new
      from public.bills b
      cross join lateral (values
        ('party_name', b.party_name, v_name),
        ('party_address', b.party_address, v_address),
        ('party_city', b.party_city, v_city),
        ('party_gst', b.party_gst, v_gst)
      ) as x(col, old, new)
      where b.id = any(v_bills) and x.old is distinct from x.new;
    end if;
  end if;

  -- Apply. System update: no per-LR "LR updated" alerts, not counted as staff
  -- edits, routes/POs untouched; DCs follow their LRs through the existing sync.
  perform set_config('app.suppress_lr_updated_notifications', 'on', true);
  perform set_config('app.system_snapshot_refresh', 'on', true);

  if p_party_type = 'customer' then
    update public.lrs set
      consignor = case when v_name_changed then v_name else consignor end,
      consignor_gst = case when v_gst_changed then v_gst else consignor_gst end,
      consignor_address = case when v_address_changed then v_address else consignor_address end
    where id = any(v_lr_a_ids);
    update public.lrs set
      consignee = case when v_name_changed then v_name else consignee end,
      consignee_gst = case when v_gst_changed then v_gst else consignee_gst end,
      consignee_address = case when v_address_changed then v_address else consignee_address end
    where id = any(v_lr_b_ids);
    update public.purchase_orders set consignor = v_name where id = any(v_po_a);
    update public.purchase_orders set consignee = v_name where id = any(v_po_b);
    update public.transport_bids set consignor_name = v_name where id = any(v_bids) and consignor_id = p_party_id;
    update public.transport_bids set consignee_name = v_name where id = any(v_bids) and consignee_id = p_party_id;
    update public.consignee_conversations set customer_name = v_name where id = any(v_convs);
  else
    update public.lrs set customer = v_name where id = any(v_lr_a_ids);
    update public.transport_bids set billing_party_name = v_name where id = any(v_bids);
    if p_action = 'apply_with_bills' then
      update public.bills set party_name = v_name, party_address = v_address, party_city = v_city, party_gst = v_gst
      where id = any(v_bills);
    end if;
  end if;

  perform set_config('app.suppress_lr_updated_notifications', 'off', true);
  perform set_config('app.system_snapshot_refresh', 'off', true);

  v_result := v_result || jsonb_build_object('billsUpdated', p_action = 'apply_with_bills' and cardinality(v_bills) > 0, 'updateId', v_update_id);
  update public.master_party_updates set summary = v_result where id = v_update_id;
  update public.master_party_changes
  set status = 'applied', applied_by = auth.uid(), applied_at = now(), result = v_result
  where id = any(v_change_ids);
  return v_result;
end;
$$;
revoke all on function public.master_party_change(text, bigint, text) from public, anon;
grant execute on function public.master_party_change(text, bigint, text) to authenticated;

-- ---------- E. Undo an approved update ----------
-- Puts back the exact old values, record by record, plus the master's old
-- details. A value that was changed again since is left alone and reported.
create or replace function public.master_party_undo(p_update_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_update public.master_party_updates;
  v_perm text;
  v_item record;
  v_restored integer := 0;
  v_skipped integer := 0;
  v_rows integer;
  v_master_restored boolean := false;
  v_result jsonb;
begin
  select * into v_update from public.master_party_updates where id = p_update_id for update;
  if not found then raise exception 'This update was not found. Refresh and try again.'; end if;
  v_perm := case v_update.party_type when 'customer' then 'customers' else 'billing_parties' end;
  if auth.uid() is null or not public.has_module_action(v_perm, 'edit') then
    raise exception 'You do not have permission to edit this master.';
  end if;
  if v_update.undone_at is not null then
    raise exception 'This update was already undone.';
  end if;

  perform set_config('app.suppress_lr_updated_notifications', 'on', true);
  perform set_config('app.system_snapshot_refresh', 'on', true);

  -- Master first: linked LRs are checked against the master's current name.
  if v_update.party_type = 'customer' then
    update public.customers set
      name = v_update.master_old->>'name', gst = v_update.master_old->>'gst',
      address = v_update.master_old->>'address', city = v_update.master_old->>'city'
    where id = v_update.party_id
      and (name, gst, address, city) is not distinct from
          (v_update.master_new->>'name', v_update.master_new->>'gst', v_update.master_new->>'address', v_update.master_new->>'city');
  else
    update public.billing_parties set
      name = v_update.master_old->>'name', gst = v_update.master_old->>'gst',
      address = v_update.master_old->>'address', city = v_update.master_old->>'city'
    where id = v_update.party_id
      and (name, gst, address, city) is not distinct from
          (v_update.master_new->>'name', v_update.master_new->>'gst', v_update.master_new->>'address', v_update.master_new->>'city');
  end if;
  get diagnostics v_rows = row_count;
  v_master_restored := v_rows > 0;
  if not v_master_restored then
    raise exception 'This party''s details were changed again after this update. Undo the later update first (or edit the master back by hand).';
  end if;

  for v_item in
    select * from public.master_party_update_items where update_id = p_update_id order by id desc
  loop
    if (v_item.table_name, v_item.column_name) not in (
      ('lrs', 'consignor'), ('lrs', 'consignor_gst'), ('lrs', 'consignor_address'),
      ('lrs', 'consignee'), ('lrs', 'consignee_gst'), ('lrs', 'consignee_address'), ('lrs', 'customer'),
      ('purchase_orders', 'consignor'), ('purchase_orders', 'consignee'),
      ('transport_bids', 'consignor_name'), ('transport_bids', 'consignee_name'), ('transport_bids', 'billing_party_name'),
      ('consignee_conversations', 'customer_name'),
      ('bills', 'party_name'), ('bills', 'party_address'), ('bills', 'party_city'), ('bills', 'party_gst')
    ) then
      raise exception 'Unexpected undo item.';
    end if;
    execute format(
      'update public.%I set %I = $1 where id::text = $2 and %I is not distinct from $3',
      v_item.table_name, v_item.column_name, v_item.column_name
    ) using v_item.old_value, v_item.record_id, v_item.new_value;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_restored := v_restored + 1; else v_skipped := v_skipped + 1; end if;
  end loop;


  perform set_config('app.suppress_lr_updated_notifications', 'off', true);
  perform set_config('app.system_snapshot_refresh', 'off', true);

  v_result := jsonb_build_object('valuesRestored', v_restored, 'changedSinceAndKept', v_skipped, 'masterRestored', v_master_restored);
  update public.master_party_updates set undone_by = auth.uid(), undone_at = now(), undo_result = v_result where id = p_update_id;
  return v_result;
end;
$$;
revoke all on function public.master_party_undo(bigint) from public, anon;
grant execute on function public.master_party_undo(bigint) to authenticated;

-- ---------- F. History for the master pages ----------
create or replace function public.master_party_history(p_party_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_perm text := case p_party_type when 'customer' then 'customers' when 'billing_party' then 'billing_parties' end;
begin
  if v_perm is null then raise exception 'Unknown master.'; end if;
  if auth.uid() is null or not public.has_module_action(v_perm, 'edit') then
    raise exception 'You do not have permission to view this history.';
  end if;
  return (
    select coalesce(jsonb_agg(row_to_json(h)::jsonb order by h.applied_at desc), '[]'::jsonb)
    from (
      select u.id, u.party_id, u.master_old, u.master_new, u.include_bills, u.summary, u.applied_at,
        coalesce(ab.display_name, ab.email) as applied_by_name,
        u.undone_at, coalesce(ub.display_name, ub.email) as undone_by_name, u.undo_result,
        (select count(*) from public.master_party_update_items i where i.update_id = u.id) as values_changed
      from public.master_party_updates u
      left join public.app_users ab on ab.id = u.applied_by
      left join public.app_users ub on ub.id = u.undone_by
      where u.party_type = p_party_type
      order by u.applied_at desc
      limit 100
    ) h
  );
end;
$$;
revoke all on function public.master_party_history(text) from public, anon;
grant execute on function public.master_party_history(text) to authenticated;

commit;
