-- ==========================================================
-- Migration: 047_admin_only_delete
-- Module:    ERP-wide DELETE — Admin / Creator only
--
-- Product rule:
--   DELETE of ERP records is allowed ONLY when public.is_admin()
--   (Creator OR Tier 1 admin — migration 041).
--
-- Changes:
--   1) Existing DELETE policies that used has_module_action(...,'delete')
--      → USING (public.is_admin()).
--   2) Tables that had no RLS get SELECT/INSERT/UPDATE policies that
--      preserve prior create/view/edit access patterns, plus admin-only
--      DELETE.
--   3) asn-assets storage DELETE → is_admin() only.
--   4) Narrow SECURITY DEFINER RPCs for internal compensation/rollback
--      (draft discard, bulk-upload rollback, orphan bill discard) that
--      do NOT grant general DELETE to non-admins.
--
-- Does NOT change create/view/edit permission helpers, LR numbering,
-- or Financials update_lr_financials RPC (except lorry_expenses DELETE).
-- NOT executed automatically — run manually against Supabase.
-- ==========================================================


-- ----------------------------------------------------------
-- PART A — Operational tables: DELETE → is_admin()
-- ----------------------------------------------------------

drop policy if exists lrs_delete_permitted on public.lrs;
create policy lrs_delete_admin_only
  on public.lrs
  for delete
  to authenticated
  using (public.is_admin());

drop policy if exists pods_delete_permitted on public.pods;
create policy pods_delete_admin_only
  on public.pods
  for delete
  to authenticated
  using (public.is_admin());

drop policy if exists delivery_challans_delete_permitted on public.delivery_challans;
create policy delivery_challans_delete_admin_only
  on public.delivery_challans
  for delete
  to authenticated
  using (public.is_admin());

drop policy if exists asn_creations_delete on public.asn_creations;
create policy asn_creations_delete_admin_only
  on public.asn_creations
  for delete
  to authenticated
  using (public.is_admin());

drop policy if exists lorry_expenses_delete_permitted on public.lorry_expenses;
create policy lorry_expenses_delete_admin_only
  on public.lorry_expenses
  for delete
  to authenticated
  using (public.is_admin());


-- ----------------------------------------------------------
-- PART B — ASN storage DELETE: admin-only
-- ----------------------------------------------------------

drop policy if exists asn_assets_delete on storage.objects;
create policy asn_assets_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'asn-assets'
    and public.is_admin()
  );


-- ----------------------------------------------------------
-- PART C — Masters / billing tables previously without RLS
-- Recreate equivalent SELECT/INSERT/UPDATE; DELETE = is_admin().
-- ----------------------------------------------------------

-- ===== customers =====
alter table public.customers enable row level security;

drop policy if exists customers_select on public.customers;
create policy customers_select
  on public.customers for select to authenticated
  using (public.has_permission('customers', 'view'));

drop policy if exists customers_insert on public.customers;
create policy customers_insert
  on public.customers for insert to authenticated
  with check (public.has_permission('customers', 'create_view'));

drop policy if exists customers_update on public.customers;
create policy customers_update
  on public.customers for update to authenticated
  using (
    public.has_permission('customers', 'edit')
    or (
      entry_status = 'draft'
      and public.has_permission('customers', 'create_view')
    )
  )
  with check (
    public.has_permission('customers', 'edit')
    or public.has_permission('customers', 'create_view')
  );

drop policy if exists customers_delete_admin_only on public.customers;
create policy customers_delete_admin_only
  on public.customers for delete to authenticated
  using (public.is_admin());

-- ===== billing_parties =====
alter table public.billing_parties enable row level security;

drop policy if exists billing_parties_select on public.billing_parties;
create policy billing_parties_select
  on public.billing_parties for select to authenticated
  using (public.has_permission('billing_parties', 'view'));

drop policy if exists billing_parties_insert on public.billing_parties;
create policy billing_parties_insert
  on public.billing_parties for insert to authenticated
  with check (public.has_permission('billing_parties', 'create_view'));

drop policy if exists billing_parties_update on public.billing_parties;
create policy billing_parties_update
  on public.billing_parties for update to authenticated
  using (
    public.has_permission('billing_parties', 'edit')
    or (
      entry_status = 'draft'
      and public.has_permission('billing_parties', 'create_view')
    )
  )
  with check (
    public.has_permission('billing_parties', 'edit')
    or public.has_permission('billing_parties', 'create_view')
  );

drop policy if exists billing_parties_delete_admin_only on public.billing_parties;
create policy billing_parties_delete_admin_only
  on public.billing_parties for delete to authenticated
  using (public.is_admin());

-- ===== vehicles =====
alter table public.vehicles enable row level security;

drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select
  on public.vehicles for select to authenticated
  using (public.has_permission('vehicle', 'view'));

drop policy if exists vehicles_insert on public.vehicles;
create policy vehicles_insert
  on public.vehicles for insert to authenticated
  with check (public.has_permission('vehicle', 'create_view'));

drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update
  on public.vehicles for update to authenticated
  using (public.has_permission('vehicle', 'edit'))
  with check (public.has_permission('vehicle', 'edit'));

drop policy if exists vehicles_delete_admin_only on public.vehicles;
create policy vehicles_delete_admin_only
  on public.vehicles for delete to authenticated
  using (public.is_admin());

-- ===== materials =====
alter table public.materials enable row level security;

drop policy if exists materials_select on public.materials;
create policy materials_select
  on public.materials for select to authenticated
  using (public.has_permission('material', 'view'));

drop policy if exists materials_insert on public.materials;
create policy materials_insert
  on public.materials for insert to authenticated
  with check (public.has_permission('material', 'create_view'));

drop policy if exists materials_update on public.materials;
create policy materials_update
  on public.materials for update to authenticated
  using (public.has_permission('material', 'edit'))
  with check (public.has_permission('material', 'edit'));

drop policy if exists materials_delete_admin_only on public.materials;
create policy materials_delete_admin_only
  on public.materials for delete to authenticated
  using (public.is_admin());

-- ===== drivers (no permission module — preserve authenticated CRUD) =====
alter table public.drivers enable row level security;

drop policy if exists drivers_select on public.drivers;
create policy drivers_select
  on public.drivers for select to authenticated
  using (auth.uid() is not null);

drop policy if exists drivers_insert on public.drivers;
create policy drivers_insert
  on public.drivers for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists drivers_update on public.drivers;
create policy drivers_update
  on public.drivers for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists drivers_delete_admin_only on public.drivers;
create policy drivers_delete_admin_only
  on public.drivers for delete to authenticated
  using (public.is_admin());

-- ===== transporters (no permission module — preserve authenticated CRUD) =====
alter table public.transporters enable row level security;

drop policy if exists transporters_select on public.transporters;
create policy transporters_select
  on public.transporters for select to authenticated
  using (auth.uid() is not null);

drop policy if exists transporters_insert on public.transporters;
create policy transporters_insert
  on public.transporters for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists transporters_update on public.transporters;
create policy transporters_update
  on public.transporters for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists transporters_delete_admin_only on public.transporters;
create policy transporters_delete_admin_only
  on public.transporters for delete to authenticated
  using (public.is_admin());

-- ===== bills =====
alter table public.bills enable row level security;

drop policy if exists bills_select on public.bills;
create policy bills_select
  on public.bills for select to authenticated
  using (public.has_permission('billing', 'view'));

drop policy if exists bills_insert on public.bills;
create policy bills_insert
  on public.bills for insert to authenticated
  with check (public.has_permission('billing', 'create_view'));

drop policy if exists bills_update on public.bills;
create policy bills_update
  on public.bills for update to authenticated
  using (public.has_permission('billing', 'edit'))
  with check (public.has_permission('billing', 'edit'));

drop policy if exists bills_delete_admin_only on public.bills;
create policy bills_delete_admin_only
  on public.bills for delete to authenticated
  using (public.is_admin());

-- ===== bill_lrs =====
alter table public.bill_lrs enable row level security;

drop policy if exists bill_lrs_select on public.bill_lrs;
create policy bill_lrs_select
  on public.bill_lrs for select to authenticated
  using (public.has_permission('billing', 'view'));

drop policy if exists bill_lrs_insert on public.bill_lrs;
create policy bill_lrs_insert
  on public.bill_lrs for insert to authenticated
  with check (public.has_permission('billing', 'create_view'));

drop policy if exists bill_lrs_update on public.bill_lrs;
create policy bill_lrs_update
  on public.bill_lrs for update to authenticated
  using (public.has_permission('billing', 'edit'))
  with check (public.has_permission('billing', 'edit'));

drop policy if exists bill_lrs_delete_admin_only on public.bill_lrs;
create policy bill_lrs_delete_admin_only
  on public.bill_lrs for delete to authenticated
  using (public.is_admin());

-- ===== credit_notes =====
alter table public.credit_notes enable row level security;

drop policy if exists credit_notes_select on public.credit_notes;
create policy credit_notes_select
  on public.credit_notes for select to authenticated
  using (public.has_permission('credit_notes', 'view'));

drop policy if exists credit_notes_insert on public.credit_notes;
create policy credit_notes_insert
  on public.credit_notes for insert to authenticated
  with check (public.has_permission('credit_notes', 'create_view'));

drop policy if exists credit_notes_update on public.credit_notes;
create policy credit_notes_update
  on public.credit_notes for update to authenticated
  using (public.has_permission('credit_notes', 'edit'))
  with check (public.has_permission('credit_notes', 'edit'));

drop policy if exists credit_notes_delete_admin_only on public.credit_notes;
create policy credit_notes_delete_admin_only
  on public.credit_notes for delete to authenticated
  using (public.is_admin());

-- ===== debit_notes =====
alter table public.debit_notes enable row level security;

drop policy if exists debit_notes_select on public.debit_notes;
create policy debit_notes_select
  on public.debit_notes for select to authenticated
  using (public.has_permission('debit_notes', 'view'));

drop policy if exists debit_notes_insert on public.debit_notes;
create policy debit_notes_insert
  on public.debit_notes for insert to authenticated
  with check (public.has_permission('debit_notes', 'create_view'));

drop policy if exists debit_notes_update on public.debit_notes;
create policy debit_notes_update
  on public.debit_notes for update to authenticated
  using (public.has_permission('debit_notes', 'edit'))
  with check (public.has_permission('debit_notes', 'edit'));

drop policy if exists debit_notes_delete_admin_only on public.debit_notes;
create policy debit_notes_delete_admin_only
  on public.debit_notes for delete to authenticated
  using (public.is_admin());


-- ----------------------------------------------------------
-- PART D — Narrow SECURITY DEFINER rollback / draft discard
-- ----------------------------------------------------------

-- D1. Discard caller's own LR draft (or admin). Not a general delete.
create or replace function public.discard_own_lr_draft(p_lr_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.lrs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from public.lrs where id = p_lr_id for update;
  if not found then
    return;
  end if;

  if public.is_admin() then
    delete from public.lrs where id = p_lr_id;
    return;
  end if;

  if v_row.created_by is distinct from auth.uid() then
    raise exception 'Only the draft creator can discard this LR draft';
  end if;

  if coalesce(v_row.entry_status, 'final') is distinct from 'draft' then
    raise exception 'Only draft LRs can be discarded via this function';
  end if;

  delete from public.lrs where id = p_lr_id;
end;
$$;

revoke all on function public.discard_own_lr_draft(uuid) from public;
revoke all on function public.discard_own_lr_draft(uuid) from anon;
grant execute on function public.discard_own_lr_draft(uuid) to authenticated;

-- D2. Discard a bill that has no lines (create compensation only).
create or replace function public.discard_unlined_bill(p_bill_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_at timestamptz;
  v_line_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    public.is_admin()
    or public.has_permission('billing', 'create_view')
  ) then
    raise exception 'Not allowed to discard bill';
  end if;

  select created_at into v_created_at
  from public.bills
  where id = p_bill_id
  for update;

  if not found then
    return;
  end if;

  -- Compensation window: only freshly created orphan headers.
  if v_created_at < now() - interval '15 minutes' and not public.is_admin() then
    raise exception 'Bill is outside the compensation window';
  end if;

  select count(*)::integer into v_line_count
  from public.bill_lrs
  where bill_id = p_bill_id;

  if v_line_count > 0 then
    raise exception 'Bill has line items; use admin delete';
  end if;

  delete from public.bills where id = p_bill_id;
end;
$$;

revoke all on function public.discard_unlined_bill(bigint) from public;
revoke all on function public.discard_unlined_bill(bigint) from anon;
grant execute on function public.discard_unlined_bill(bigint) to authenticated;

-- D3. Bulk-upload rollback: delete only rows the caller just created.
--     Ownership via created_by where present; otherwise create-permission
--     + created_at within 2 hours. Caps batch size. Never deletes arbitrary
--     historical rows.
create or replace function public.rollback_upload_batch(
  p_entity text,
  p_ids text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := lower(trim(p_entity));
  v_count integer;
  v_matched integer;
  v_cutoff timestamptz := now() - interval '2 hours';
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;

  if cardinality(p_ids) > 500 then
    raise exception 'Rollback batch too large';
  end if;

  v_count := cardinality(p_ids);

  if v_entity = 'lrs' then
    if not (public.is_admin() or public.has_permission('lr', 'create_view')) then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.lrs
    where id::text = any (p_ids)
      and (
        public.is_admin()
        or (
          created_by = auth.uid()
          and created_at >= v_cutoff
        )
      );
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all LRs are owned recent uploads';
    end if;
    delete from public.lrs
    where id::text = any (p_ids)
      and (
        public.is_admin()
        or (created_by = auth.uid() and created_at >= v_cutoff)
      );
    return;
  end if;

  if v_entity = 'pods' then
    if not (public.is_admin() or public.has_permission('pod', 'create_view')) then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.pods
    where id::text = any (p_ids)
      and (
        public.is_admin()
        or (
          created_by = auth.uid()
          and created_at >= v_cutoff
        )
      );
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all PODs are owned recent uploads';
    end if;
    delete from public.pods
    where id::text = any (p_ids)
      and (
        public.is_admin()
        or (created_by = auth.uid() and created_at >= v_cutoff)
      );
    return;
  end if;

  if v_entity = 'lorry_expenses' then
    if not (public.is_admin() or public.has_permission('lorry_expenses', 'create_view')) then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.lorry_expenses
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all Financials rows are recent uploads';
    end if;
    delete from public.lorry_expenses
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    return;
  end if;

  if v_entity = 'customers' then
    if not (public.is_admin() or public.has_permission('customers', 'create_view')) then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.customers
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all customers are recent uploads';
    end if;
    delete from public.customers
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    return;
  end if;

  if v_entity = 'billing_parties' then
    if not (public.is_admin() or public.has_permission('billing_parties', 'create_view')) then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.billing_parties
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all billing parties are recent uploads';
    end if;
    delete from public.billing_parties
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    return;
  end if;

  if v_entity = 'vehicles' then
    if not (public.is_admin() or public.has_permission('vehicle', 'create_view')) then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.vehicles
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all vehicles are recent uploads';
    end if;
    delete from public.vehicles
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    return;
  end if;

  if v_entity = 'materials' then
    if not (public.is_admin() or public.has_permission('material', 'create_view')) then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.materials
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all materials are recent uploads';
    end if;
    delete from public.materials
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    return;
  end if;

  if v_entity = 'drivers' then
    if auth.uid() is null then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.drivers
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all drivers are recent uploads';
    end if;
    delete from public.drivers
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    return;
  end if;

  if v_entity = 'transporters' then
    if auth.uid() is null then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.transporters
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all transporters are recent uploads';
    end if;
    delete from public.transporters
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    return;
  end if;

  if v_entity = 'bills' then
    if not (public.is_admin() or public.has_permission('billing', 'create_view')) then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.bills
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all bills are recent uploads';
    end if;
    delete from public.bills
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    return;
  end if;

  if v_entity = 'credit_notes' then
    if not (public.is_admin() or public.has_permission('credit_notes', 'create_view')) then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.credit_notes
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all credit notes are recent uploads';
    end if;
    delete from public.credit_notes
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    return;
  end if;

  if v_entity = 'debit_notes' then
    if not (public.is_admin() or public.has_permission('debit_notes', 'create_view')) then
      raise exception 'Not allowed';
    end if;
    select count(*)::integer into v_matched
    from public.debit_notes
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    if v_matched <> v_count then
      raise exception 'Rollback refused: not all debit notes are recent uploads';
    end if;
    delete from public.debit_notes
    where id::text = any (p_ids)
      and (public.is_admin() or created_at >= v_cutoff);
    return;
  end if;

  raise exception 'Unknown rollback entity: %', p_entity;
end;
$$;

revoke all on function public.rollback_upload_batch(text, text[]) from public;
revoke all on function public.rollback_upload_batch(text, text[]) from anon;
grant execute on function public.rollback_upload_batch(text, text[]) to authenticated;

-- ==========================================================
-- END 047
-- ==========================================================
