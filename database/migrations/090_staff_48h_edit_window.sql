-- ==========================================================
-- Migration: 090_staff_48h_edit_window
-- Change 1: 48-hour staff edit access (operational records only)
--
-- Locked rule:
--   - Clock is ONLY the ORIGINAL created_at. Never finalized_at,
--     updated_at, document date, LR date, or any other timestamp.
--   - Staff UPDATE denied when now() >= OLD.created_at + 48 hours.
--   - Creator/Admin (public.is_admin() = role IN ('creator','admin'))
--     bypass ONLY the new 48-hour restriction. All existing module
--     restrictions/validation are preserved.
--   - Staff still need their existing module Edit permission (or the
--     existing draft + create_view continuation where it exists).
--   - View permissions are untouched.
--
-- Scope (exactly these 8 areas, one policy family each):
--   1. LR                    -> public.lrs
--   2. POD                   -> public.pods
--   3. Delivery Challan      -> public.delivery_challans
--   4. Billing               -> public.bills + public.bill_lrs
--   5. Credit Note           -> public.credit_notes
--   6. Debit Note            -> public.debit_notes
--   7. Lorry Expenses / LR Financials
--                            -> public.lorry_expenses (direct) +
--                               public.lrs commercial cols via
--                               update_lr_financials() RPC (explicit guard)
--   8. ASN                   -> public.asn_creations
--
-- Excluded (untouched): Bid Management, master-data modules,
-- Purchase Orders, intelligence modules, notifications.
--
-- Parts:
--   A) public.staff_within_48h_edit_window() — single shared helper so
--      the role/time logic is not copied eight times.
--   B) public.freeze_created_at() + BEFORE UPDATE triggers on the 9
--      tables — editing can NEVER restart the 48-hour clock.
--   C) Recreate the 9 UPDATE policies (same names, same existing
--      permission logic) with the additional 48h predicate.
--   D) Recreate update_lr_financials() (SECURITY DEFINER bypass path)
--      with an explicit staff 48h check on the target LR's ORIGINAL
--      lrs.created_at. Financial calculations, accepted fields,
--      permission meaning, and other behavior unchanged.
--
-- NOT executed automatically — run manually against Supabase.
-- ==========================================================

-- ----------------------------------------------------------
-- PART A — shared 48-hour window helper
-- ----------------------------------------------------------
-- Returns true for Creator/Admin (bypass ONLY this window), else
-- true only while now() < p_created_at + 48 hours. NULL clock
-- fails closed (staff denied).
create or replace function public.staff_within_48h_edit_window(p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or (
      p_created_at is not null
      and now() < p_created_at + interval '48 hours'
    );
$$;

revoke all on function public.staff_within_48h_edit_window(timestamptz) from public;
revoke all on function public.staff_within_48h_edit_window(timestamptz) from anon;
grant execute on function public.staff_within_48h_edit_window(timestamptz) to authenticated;

comment on function public.staff_within_48h_edit_window(timestamptz) is
  'Change 1: true for Creator/Admin; for staff only while now() < created_at + 48 hours. Clock is ORIGINAL created_at only.';


-- ----------------------------------------------------------
-- PART B — freeze ORIGINAL created_at on UPDATE (clock can never restart)
-- ----------------------------------------------------------
create or replace function public.freeze_created_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists trg_lrs_freeze_created_at on public.lrs;
create trigger trg_lrs_freeze_created_at
before update on public.lrs
for each row
execute function public.freeze_created_at();

drop trigger if exists trg_pods_freeze_created_at on public.pods;
create trigger trg_pods_freeze_created_at
before update on public.pods
for each row
execute function public.freeze_created_at();

drop trigger if exists trg_delivery_challans_freeze_created_at on public.delivery_challans;
create trigger trg_delivery_challans_freeze_created_at
before update on public.delivery_challans
for each row
execute function public.freeze_created_at();

drop trigger if exists trg_bills_freeze_created_at on public.bills;
create trigger trg_bills_freeze_created_at
before update on public.bills
for each row
execute function public.freeze_created_at();

drop trigger if exists trg_bill_lrs_freeze_created_at on public.bill_lrs;
create trigger trg_bill_lrs_freeze_created_at
before update on public.bill_lrs
for each row
execute function public.freeze_created_at();

drop trigger if exists trg_credit_notes_freeze_created_at on public.credit_notes;
create trigger trg_credit_notes_freeze_created_at
before update on public.credit_notes
for each row
execute function public.freeze_created_at();

drop trigger if exists trg_debit_notes_freeze_created_at on public.debit_notes;
create trigger trg_debit_notes_freeze_created_at
before update on public.debit_notes
for each row
execute function public.freeze_created_at();

drop trigger if exists trg_lorry_expenses_freeze_created_at on public.lorry_expenses;
create trigger trg_lorry_expenses_freeze_created_at
before update on public.lorry_expenses
for each row
execute function public.freeze_created_at();

drop trigger if exists trg_asn_creations_freeze_created_at on public.asn_creations;
create trigger trg_asn_creations_freeze_created_at
before update on public.asn_creations
for each row
execute function public.freeze_created_at();


-- ----------------------------------------------------------
-- PART C — UPDATE policies: existing permission logic + 48h window
-- (policy names preserved; SELECT/INSERT/DELETE untouched)
-- ----------------------------------------------------------

-- 1. LR (existing behavior preserved: edit OR draft + create_view;
--    staff on either path must additionally be inside 48h)
drop policy if exists lrs_update_own_or_admin on public.lrs;

create policy lrs_update_own_or_admin
  on public.lrs
  for update
  to authenticated
  using (
    (
      public.has_permission('lr', 'edit')
      or (
        entry_status = 'draft'
        and public.has_permission('lr', 'create_view')
      )
    )
    and public.staff_within_48h_edit_window(created_at)
  )
  with check (
    (
      public.has_permission('lr', 'edit')
      or public.has_permission('lr', 'create_view')
    )
    and public.staff_within_48h_edit_window(created_at)
  );

-- 2. POD
drop policy if exists pods_update_own_lr_or_admin on public.pods;

create policy pods_update_own_lr_or_admin
  on public.pods
  for update
  to authenticated
  using (
    public.has_permission('pod', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  )
  with check (
    public.has_permission('pod', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  );

-- 3. Delivery Challan
drop policy if exists delivery_challans_update on public.delivery_challans;

create policy delivery_challans_update
  on public.delivery_challans
  for update
  to authenticated
  using (
    public.has_permission('delivery_challans', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  )
  with check (
    public.has_permission('delivery_challans', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  );

-- 4a. Billing (bills)
drop policy if exists bills_update on public.bills;

create policy bills_update
  on public.bills
  for update
  to authenticated
  using (
    public.has_permission('billing', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  )
  with check (
    public.has_permission('billing', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  );

-- 4b. Billing lines (bill_lrs)
drop policy if exists bill_lrs_update on public.bill_lrs;

create policy bill_lrs_update
  on public.bill_lrs
  for update
  to authenticated
  using (
    public.has_permission('billing', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  )
  with check (
    public.has_permission('billing', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  );

-- 5. Credit Note
drop policy if exists credit_notes_update on public.credit_notes;

create policy credit_notes_update
  on public.credit_notes
  for update
  to authenticated
  using (
    public.has_permission('credit_notes', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  )
  with check (
    public.has_permission('credit_notes', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  );

-- 6. Debit Note
drop policy if exists debit_notes_update on public.debit_notes;

create policy debit_notes_update
  on public.debit_notes
  for update
  to authenticated
  using (
    public.has_permission('debit_notes', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  )
  with check (
    public.has_permission('debit_notes', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  );

-- 7. Lorry Expenses (existing behavior preserved: edit OR draft +
--    create_view; staff on either path must be inside 48h)
drop policy if exists lorry_expenses_update_own_lr_or_admin on public.lorry_expenses;

create policy lorry_expenses_update_own_lr_or_admin
  on public.lorry_expenses
  for update
  to authenticated
  using (
    (
      public.has_permission('lorry_expenses', 'edit')
      or (
        entry_status = 'draft'
        and public.has_permission('lorry_expenses', 'create_view')
      )
    )
    and public.staff_within_48h_edit_window(created_at)
  )
  with check (
    (
      public.has_permission('lorry_expenses', 'edit')
      or public.has_permission('lorry_expenses', 'create_view')
    )
    and public.staff_within_48h_edit_window(created_at)
  );

-- 8. ASN
drop policy if exists asn_creations_update on public.asn_creations;

create policy asn_creations_update
  on public.asn_creations
  for update
  to authenticated
  using (
    public.has_permission('asn_creations', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  )
  with check (
    public.has_permission('asn_creations', 'edit')
    and public.staff_within_48h_edit_window(created_at)
  );


-- ----------------------------------------------------------
-- PART D — update_lr_financials(): explicit staff 48h guard
-- (SECURITY DEFINER bypasses lrs RLS, so the window is enforced
-- inside the function on the target LR's ORIGINAL created_at.
-- Creator/Admin: no 48h restriction. Existing permission checks,
-- validations, and financial calculations unchanged.)
-- ----------------------------------------------------------

create or replace function public.update_lr_financials(
  p_lr_id uuid,
  p_bill_rate numeric,
  p_bill_rate_type text,
  p_guaranteed_weight numeric,
  p_lorry_hire_rate numeric,
  p_lorry_hire_type text,
  p_lorry_hire_guaranteed_weight numeric
)
returns public.lrs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lr public.lrs%rowtype;
  v_loading numeric;
  v_unloading numeric;
  v_charged numeric;
  v_bill_amount numeric;
  v_hire_amount numeric;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Financials create OR edit may patch commercial fields.
  if not (
    public.has_permission('lorry_expenses', 'create_view')
    or public.has_permission('lorry_expenses', 'edit')
  ) then
    raise exception 'Not permitted to edit Financials for this LR';
  end if;

  -- Same visibility gate as live lrs SELECT policy (migration 021).
  if not public.has_permission('lr', 'view') then
    raise exception 'Not permitted to edit Financials for this LR';
  end if;

  if p_lr_id is null then
    raise exception 'LR id is required';
  end if;

  if p_bill_rate is null or p_bill_rate < 0
     or p_guaranteed_weight is null or p_guaranteed_weight < 0
     or p_lorry_hire_rate is null or p_lorry_hire_rate < 0
     or p_lorry_hire_guaranteed_weight is null or p_lorry_hire_guaranteed_weight < 0 then
    raise exception 'Financial amounts cannot be negative';
  end if;

  if p_bill_rate_type is null or p_bill_rate_type not in (
    'Fixed', 'Per Ton (Loading)', 'Per Ton (Unloading)', 'Guaranteed Weight'
  ) then
    raise exception 'Invalid bill rate type';
  end if;

  if p_lorry_hire_type is null or p_lorry_hire_type not in (
    'Fixed', 'Per Ton (Loading)', 'Per Ton (Unloading)', 'Guaranteed Weight', 'Per Ton'
  ) then
    raise exception 'Invalid lorry hire type';
  end if;

  if p_bill_rate_type = 'Guaranteed Weight' and p_guaranteed_weight <= 0 then
    raise exception 'Guaranteed weight is required when bill rate type is Guaranteed Weight';
  end if;

  if p_lorry_hire_type = 'Guaranteed Weight' and p_lorry_hire_guaranteed_weight <= 0 then
    raise exception 'Guaranteed weight is required when lorry hire type is Guaranteed Weight';
  end if;

  select * into v_lr
  from public.lrs
  where id = p_lr_id
  for update;

  if not found then
    raise exception 'LR not found';
  end if;

  -- Change 1: staff 48-hour window on the LR's ORIGINAL created_at.
  -- Creator/Admin bypass only this window. Uses v_lr.created_at read
  -- above (the stored original, never finalized_at/updated_at).
  if not public.is_admin() then
    if v_lr.created_at is null
      or now() >= v_lr.created_at + interval '48 hours'
    then
      raise exception 'LR edit window has expired (48 hours from creation)';
    end if;
  end if;

  v_loading := coalesce(v_lr.loading_weight, 0);
  v_unloading := coalesce(v_lr.unloading_weight, 0);
  v_charged := coalesce(v_lr.charged_weight, 0);

  -- Bill amount — mirrors calculateBillAmount() in lrCalculations.ts
  v_bill_amount := case p_bill_rate_type
    when 'Fixed' then p_bill_rate
    when 'Per Ton (Loading)' then p_bill_rate * v_loading
    when 'Per Ton (Unloading)' then p_bill_rate * v_unloading
    when 'Guaranteed Weight' then p_bill_rate * p_guaranteed_weight
    else 0
  end;

  -- Lorry hire — Per Ton (Loading/Unloading) truncate weight to 1 decimal
  -- (same as truncateWeightToOneDecimal in lrCalculations.ts).
  v_hire_amount := case p_lorry_hire_type
    when 'Fixed' then p_lorry_hire_rate
    when 'Per Ton (Loading)' then
      p_lorry_hire_rate * (
        case
          when v_loading = 0 then 0
          else floor(v_loading * 10 + 1e-9) / 10
        end
      )
    when 'Per Ton (Unloading)' then
      p_lorry_hire_rate * (
        case
          when v_unloading = 0 then 0
          else floor(v_unloading * 10 + 1e-9) / 10
        end
      )
    when 'Guaranteed Weight' then p_lorry_hire_rate * p_lorry_hire_guaranteed_weight
    when 'Per Ton' then p_lorry_hire_rate * v_charged
    else 0
  end;

  update public.lrs
  set
    bill_rate = p_bill_rate,
    bill_rate_type = p_bill_rate_type,
    guaranteed_weight = p_guaranteed_weight,
    lorry_hire_rate = p_lorry_hire_rate,
    lorry_hire_type = p_lorry_hire_type,
    lorry_hire_guaranteed_weight = p_lorry_hire_guaranteed_weight,
    bill_amount = v_bill_amount,
    lorry_hire_amount = v_hire_amount,
    profit_amount = v_bill_amount - v_hire_amount
  where id = p_lr_id
  returning * into v_lr;

  return v_lr;
end;
$$;

revoke all on function public.update_lr_financials(
  uuid, numeric, text, numeric, numeric, text, numeric
) from public;
revoke all on function public.update_lr_financials(
  uuid, numeric, text, numeric, numeric, text, numeric
) from anon;
grant execute on function public.update_lr_financials(
  uuid, numeric, text, numeric, numeric, text, numeric
) to authenticated;

comment on function public.update_lr_financials(
  uuid, numeric, text, numeric, numeric, text, numeric
) is
  'Financials-only commercial patch on lrs. Requires lorry_expenses create_view|edit and lr view. Staff additionally require the LR original created_at to be within 48 hours (Change 1). Does not grant general lr.edit.';
