-- ==========================================================
-- Migration: 046_financials_lr_commercial_rpc
-- Module:    Financials — narrow LR commercial update + expense RLS
--
-- Problem:
--   Financials Save called updateLR(), which requires has_permission
--   ('lr','edit') for finalized LRs. Staff with lorry_expenses create
--   but without lr.edit got 0-row updates → PGRST116, and never reached
--   createLorryExpense().
--
--   Separately, lorry_expenses RLS still used assigned_to ownership
--   (migration 017), unlike lrs/pods after migration 021.
--
-- Fix:
--   1) SECURITY DEFINER RPC update_lr_financials(...) that updates ONLY
--      Financials-owned commercial columns on public.lrs, after checking
--      has_permission('lorry_expenses', create_view|edit) and
--      has_permission('lr', 'view'). Recalculates bill_amount /
--      lorry_hire_amount / profit_amount to match lrCalculations.ts.
--   2) Replace lorry_expenses RLS with permission-based policies
--      (same pattern as lrs after 021/035). Does NOT grant lr.edit.
--
-- Does NOT modify LR data, expense rows, or general LR update RLS.
-- NOT executed automatically — run manually against Supabase.
-- ==========================================================

-- ----------------------------------------------------------
-- PART A — narrow Financials commercial update RPC
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
  'Financials-only commercial patch on lrs. Requires lorry_expenses create_view|edit and lr view. Does not grant general lr.edit.';


-- ----------------------------------------------------------
-- PART B — lorry_expenses RLS: permission-based (not assigned_to)
-- Mirrors lrs/pods after migrations 021 + 035.
-- Policy names preserved (drop + recreate).
-- ----------------------------------------------------------

drop policy if exists lorry_expenses_select_own_lr_or_admin
on public.lorry_expenses;

create policy lorry_expenses_select_own_lr_or_admin
on public.lorry_expenses
for select
to authenticated
using (
  public.has_permission('lorry_expenses', 'view')
);

drop policy if exists lorry_expenses_insert_own_lr_or_admin
on public.lorry_expenses;

create policy lorry_expenses_insert_own_lr_or_admin
on public.lorry_expenses
for insert
to authenticated
with check (
  public.has_permission('lorry_expenses', 'create_view')
);

drop policy if exists lorry_expenses_update_own_lr_or_admin
on public.lorry_expenses;

create policy lorry_expenses_update_own_lr_or_admin
on public.lorry_expenses
for update
to authenticated
using (
  public.has_permission('lorry_expenses', 'edit')
  or (
    entry_status = 'draft'
    and public.has_permission('lorry_expenses', 'create_view')
  )
)
with check (
  public.has_permission('lorry_expenses', 'edit')
  or public.has_permission('lorry_expenses', 'create_view')
);

-- App exposes delete; previously there was no DELETE policy (always denied).
drop policy if exists lorry_expenses_delete_permitted
on public.lorry_expenses;

create policy lorry_expenses_delete_permitted
on public.lorry_expenses
for delete
to authenticated
using (
  public.has_module_action('lorry_expenses', 'delete')
);
