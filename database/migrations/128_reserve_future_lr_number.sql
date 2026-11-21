-- 128: Reserve a future LR number.
--
-- Rare case: an LR number above the running sequence is given out early
-- (e.g. a driver already has an advance on LR20200). Owner's decisions:
--   * anyone who can create LRs may reserve; no upper limit;
--   * the reserved number is saved as a draft LR (with that number and an
--     LR date) and completed later like any draft;
--   * the running sequence does not move; when it reaches a used number it
--     skips it (20199 -> 20201);
--   * a reserved draft has no 48-hour edit limit until it is finalized;
--     after finalizing, the normal 48 hours count from finalization;
--   * an unneeded reservation is marked Cancelled (never deleted) and its
--     number stays used.
-- Changes: lrs.reserved_at / reserved_by, allocate_next_lr_number (skip
-- used numbers), staff_within_lr_edit_window, the lrs update policy and
-- create_replacement_purchase_order_from_lr (reserved-aware 48 hours), a
-- guard so the reserved mark can't be set or changed by anyone else,
-- reserve_lr_number() and cancel_reserved_lr(). No existing row changes.
-- Rollback: 128_..._rollback.sql (exact live definitions before 128).

begin;

alter table public.lrs add column if not exists reserved_at timestamptz;
alter table public.lrs add column if not exists reserved_by uuid;
comment on column public.lrs.reserved_at is 'Set when this LR number was reserved ahead of the running sequence (migration 128).';

-- The reserved mark can only be set by reserve_lr_number() and never changed
-- afterwards (the 48-hour rule trusts it; nobody may set it on an old LR).
create or replace function public.lr_protect_reservation()
returns trigger
language plpgsql set search_path to 'public'
as $$
begin
  if tg_op = 'UPDATE' then
    new.reserved_at := old.reserved_at;
    new.reserved_by := old.reserved_by;
  elsif coalesce(current_setting('app.reserving_lr', true), 'off') <> 'on' then
    new.reserved_at := null;
    new.reserved_by := null;
  end if;
  return new;
end;
$$;
create trigger a_lr_protect_reservation before insert or update on public.lrs
  for each row execute function public.lr_protect_reservation();

-- 48-hour staff window for LRs: normal LRs count from creation; a reserved
-- LR is open while it is a draft and counts from finalization after that.
create or replace function public.staff_within_lr_edit_window(
  p_created_at timestamptz, p_reserved_at timestamptz, p_entry_status text, p_finalized_at timestamptz)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select case
    when p_reserved_at is not null then
      coalesce(p_entry_status, 'final') = 'draft' or public.staff_within_48h_edit_window(p_finalized_at)
    else public.staff_within_48h_edit_window(p_created_at)
  end;
$$;

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

  -- Skip numbers already used, e.g. a reserved future LR (migration 128).
  loop
    v_next := v_next + 1;
    if v_length < length(v_next::text) then
      v_length := length(v_next::text);
    end if;

    v_number := v_prefix || lpad(v_next::text, v_length, '0');
    exit when not exists (select 1 from public.lrs where lr_number = v_number);
  end loop;

  update public.company_settings
  set lr_running_number = v_next
  where id = v_id;

  return v_number;
end;
$function$;

drop policy lrs_update_own_or_admin on public.lrs;
create policy lrs_update_own_or_admin on public.lrs
  as permissive for update to authenticated
  using ((((has_permission('lr'::text, 'edit'::text) OR ((entry_status = 'draft'::text) AND has_permission('lr'::text, 'create_view'::text))) AND staff_within_lr_edit_window(created_at, reserved_at, entry_status, finalized_at)) OR ((auth.uid() = '15e8e879-4a4b-4805-a7af-ea332fd0b895'::uuid) AND (entry_status = 'draft'::text) AND (lr_number = ANY (ARRAY['LR19646'::text, 'LR19647'::text])))))
  with check ((((has_permission('lr'::text, 'edit'::text) OR has_permission('lr'::text, 'create_view'::text)) AND staff_within_lr_edit_window(created_at, reserved_at, entry_status, finalized_at)) OR ((auth.uid() = '15e8e879-4a4b-4805-a7af-ea332fd0b895'::uuid) AND (lr_number = ANY (ARRAY['LR19646'::text, 'LR19647'::text])))));

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
 if not public.staff_within_lr_edit_window(v_lr.created_at, v_lr.reserved_at, v_lr.entry_status, v_lr.finalized_at) then raise exception 'The 48-hour staff edit window for this LR has expired'; end if;
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

-- Reserve one LR number above the running sequence as a draft LR.
create or replace function public.reserve_lr_number(p_number bigint, p_lr_date date)
returns public.lrs
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id smallint; v_prefix text; v_length integer; v_running bigint; v_number text; v_row public.lrs;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.has_permission('lr', 'create_view') then
    raise exception 'Not permitted to reserve LR numbers';
  end if;
  if p_number is null or p_number <= 0 then raise exception 'Enter the LR number to reserve.'; end if;
  if p_lr_date is null then raise exception 'Enter the LR date.'; end if;

  -- Same lock as allocate_next_lr_number, so reserving and the normal
  -- sequence can never race for the same number.
  select id, coalesce(lr_prefix, ''), coalesce(lr_prefix_length, 4), coalesce(lr_running_number, 0)
    into v_id, v_prefix, v_length, v_running
  from public.company_settings order by id limit 1 for update;
  if v_id is null then raise exception 'Company settings are not configured'; end if;

  if p_number <= v_running then
    raise exception '% is not a future number. The current sequence is at %; reserve a number above it.',
      v_prefix || lpad(p_number::text, greatest(v_length, length(p_number::text)), '0'),
      v_prefix || lpad(v_running::text, greatest(v_length, length(v_running::text)), '0');
  end if;

  v_number := v_prefix || lpad(p_number::text, greatest(v_length, length(p_number::text)), '0');
  if exists (select 1 from public.lrs where lr_number = v_number) then
    raise exception '% already exists (it may already be reserved).', v_number;
  end if;

  perform set_config('app.reserving_lr', 'on', true);
  insert into public.lrs (lr_number, lr_date, entry_status, status, reserved_at, reserved_by)
    values (v_number, p_lr_date, 'draft', 'Open', now(), auth.uid())
    returning * into v_row;
  perform set_config('app.reserving_lr', 'off', true);
  return v_row;
end;
$$;

-- Mark an unneeded reservation Cancelled. Nothing is deleted; the number
-- stays used and the sequence keeps skipping it.
create or replace function public.cancel_reserved_lr(p_lr_id uuid)
returns public.lrs
language plpgsql security definer set search_path to 'public'
as $$
declare v_row public.lrs;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not (public.has_permission('lr', 'create_view') or public.has_permission('lr', 'edit')) then
    raise exception 'Not permitted to cancel reserved LRs';
  end if;
  select * into v_row from public.lrs where id = p_lr_id for update;
  if not found then raise exception 'LR not found'; end if;
  if v_row.reserved_at is null or v_row.entry_status <> 'draft' then
    raise exception 'Only a reserved LR that is still a draft can be cancelled this way.';
  end if;
  if v_row.status = 'Cancelled' then raise exception 'This reserved LR is already cancelled.'; end if;
  update public.lrs set status = 'Cancelled' where id = p_lr_id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.reserve_lr_number(bigint, date) from public, anon;
revoke all on function public.cancel_reserved_lr(uuid) from public, anon;
grant execute on function public.reserve_lr_number(bigint, date) to authenticated;
grant execute on function public.cancel_reserved_lr(uuid) to authenticated;
grant execute on function public.staff_within_lr_edit_window(timestamptz, timestamptz, text, timestamptz) to authenticated;

commit;
