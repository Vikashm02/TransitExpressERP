-- PO Master + LR PO snapshots. REVIEW ONLY: manually apply before deploying the UI.
-- Requires the existing permission helpers and numbered-draft RPC (041 / 062).
-- No data backfill, existing-policy changes, numbering changes, or automatic expiry.
begin;

create table public.purchase_orders (
  id bigint generated always as identity primary key,
  billing_party_id bigint not null references public.billing_parties(id) on delete restrict,
  po_number text not null check (length(trim(po_number)) between 1 and 100),
  issue_date date not null,
  allotted_weight numeric not null check (allotted_weight > 0 and allotted_weight < 'Infinity'::numeric),
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);
create unique index purchase_orders_party_number on public.purchase_orders(billing_party_id, upper(trim(po_number)));
create index purchase_orders_active_party on public.purchase_orders(billing_party_id) where status = 'Active';

alter table public.lrs add column purchase_order_id bigint references public.purchase_orders(id) on delete restrict;
alter table public.lrs add column po_date date;
create index lrs_purchase_order_usage on public.lrs(purchase_order_id)
  where entry_status = 'final' and status is distinct from 'Cancelled';

alter table public.purchase_orders enable row level security;
revoke all on public.purchase_orders from anon, authenticated;
grant select, insert, update on public.purchase_orders to authenticated;
grant usage, select on sequence public.purchase_orders_id_seq to authenticated;
create policy purchase_orders_view on public.purchase_orders for select to authenticated
  using (public.has_permission('purchase_orders', 'view'));
create policy purchase_orders_create on public.purchase_orders for insert to authenticated
  with check (public.has_module_action('purchase_orders', 'create'));
create policy purchase_orders_edit on public.purchase_orders for update to authenticated
  using (public.has_module_action('purchase_orders', 'edit'))
  with check (public.has_module_action('purchase_orders', 'edit'));
-- No delete policy or UI: deactivate obsolete POs and preserve their references.

create table public.purchase_order_audit (
  id bigint generated always as identity primary key,
  purchase_order_id bigint references public.purchase_orders(id) on delete restrict,
  lr_id bigint,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);
alter table public.purchase_order_audit enable row level security;
revoke all on public.purchase_order_audit from anon, authenticated;
grant select on public.purchase_order_audit to authenticated;
create policy purchase_order_audit_view on public.purchase_order_audit for select to authenticated
  using (public.has_permission('purchase_orders', 'view'));

create function public.purchase_order_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.po_number := upper(trim(new.po_number));
  if not exists (select 1 from public.billing_parties
    where id = new.billing_party_id and coalesce(entry_status, 'final') = 'final') then
    raise exception 'Choose a finalized billing party';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if (new.billing_party_id is distinct from old.billing_party_id or new.po_number is distinct from old.po_number)
      and exists (select 1 from public.lrs where purchase_order_id = old.id) then
      raise exception 'The billing party and number of a linked PO cannot be changed';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.purchase_order_before_write() from public, anon, authenticated;
create trigger purchase_order_before_write before insert or update on public.purchase_orders
  for each row execute function public.purchase_order_before_write();

create function public.purchase_order_record_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.purchase_order_audit(purchase_order_id, action, old_values, new_values, actor_id)
    values (new.id, tg_op, case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new), auth.uid());
  return new;
end;
$$;
revoke all on function public.purchase_order_record_audit() from public, anon, authenticated;
create trigger purchase_order_record_audit after insert or update on public.purchase_orders
  for each row execute function public.purchase_order_record_audit();

create function public.lr_validate_purchase_order() returns trigger
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
      or new.customer is distinct from old.customer;
  end if;
  -- SHARE serializes selection with a concurrent PO edit/deactivation.
  select * into v_po from public.purchase_orders where id = new.purchase_order_id for share;
  if not found then raise exception 'PO not found'; end if;
  select name into v_party from public.billing_parties where id = v_po.billing_party_id;
  if v_selection then
    if (select count(*) from public.billing_parties
      where upper(trim(name)) = upper(trim(new.customer)) and coalesce(entry_status, 'final') = 'final') <> 1 then
      raise exception 'Billing party must resolve to exactly one finalized master record';
    end if;
    if upper(trim(new.customer)) is distinct from upper(trim(v_party)) then
      raise exception 'PO does not belong to the selected billing party';
    end if;
    if v_po.status <> 'Active' then raise exception 'Choose an active PO'; end if;
    new.po_number := v_po.po_number;
    new.po_date := v_po.issue_date;
  elsif new.po_number is distinct from old.po_number or new.po_date is distinct from old.po_date then
    raise exception 'Select a PO from the master to change its LR snapshot';
  end if;
  if tg_op = 'UPDATE' then
    if old.entry_status = 'draft' and new.entry_status = 'final' and v_po.status <> 'Active' then
      raise exception 'PO is now inactive. Choose an active PO before finalizing';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.lr_validate_purchase_order() from public, anon, authenticated;
create trigger lr_validate_purchase_order before insert or update on public.lrs
  for each row execute function public.lr_validate_purchase_order();

create function public.lr_record_purchase_order_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb;
begin
  v_new := jsonb_build_object('purchase_order_id', new.purchase_order_id, 'po_number', new.po_number, 'po_date', new.po_date);
  if tg_op = 'UPDATE' then
    v_old := jsonb_build_object('purchase_order_id', old.purchase_order_id, 'po_number', old.po_number, 'po_date', old.po_date);
    if v_old = v_new then return new; end if;
  elsif new.purchase_order_id is null and new.po_date is null then return new;
  end if;
  insert into public.purchase_order_audit(purchase_order_id, lr_id, action, old_values, new_values, actor_id)
    values (new.purchase_order_id, new.id, 'LR_' || tg_op, v_old, v_new, auth.uid());
  return new;
end;
$$;
revoke all on function public.lr_record_purchase_order_audit() from public, anon, authenticated;
create trigger lr_record_purchase_order_audit after insert or update on public.lrs
  for each row execute function public.lr_record_purchase_order_audit();

create function public.get_purchase_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not public.has_permission('purchase_orders', 'view') then
    raise exception 'Not permitted to view PO master';
  end if;
  -- Aggregate across staff: row-level LR visibility must not understate PO usage.
  -- Return only master fields and aggregate weight, never individual LR data.
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc), '[]'::jsonb) into v_rows
  from (
    select p.id, p.billing_party_id, b.name as billing_party_name, p.po_number,
      p.issue_date, p.allotted_weight, p.status,
      coalesce((select sum(l.loading_weight) from public.lrs l
        where l.purchase_order_id = p.id and l.entry_status = 'final'
          and l.status is distinct from 'Cancelled'), 0) as used_weight
    from public.purchase_orders p join public.billing_parties b on b.id = p.billing_party_id
  ) r;
  return v_rows;
end;
$$;
revoke all on function public.get_purchase_orders() from public, anon;
grant execute on function public.get_purchase_orders() to authenticated;

create function public.get_purchase_order_billing_parties() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_module_action('purchase_orders', 'create')
    or public.has_module_action('purchase_orders', 'edit')) then raise exception 'Not permitted'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'code', b.code)
    order by b.name, b.id), '[]'::jsonb) from public.billing_parties b
    where coalesce(b.entry_status, 'final') = 'final');
end;
$$;
revoke all on function public.get_purchase_order_billing_parties() from public, anon;
grant execute on function public.get_purchase_order_billing_parties() to authenticated;

create function public.get_lr_purchase_orders(p_billing_party text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')) then raise exception 'Not permitted'; end if;
  -- Existing LR stores the billing-party name in customer, NOT billing_party (GST payer).
  if (select count(*) from public.billing_parties
    where upper(trim(name)) = upper(trim(p_billing_party)) and coalesce(entry_status, 'final') = 'final') > 1 then
    raise exception 'Duplicate billing party names: resolve the master ambiguity before selecting a PO';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'po_number', p.po_number,
    'issue_date', p.issue_date) order by p.issue_date desc, p.id desc), '[]'::jsonb)
    from public.purchase_orders p join public.billing_parties b on b.id = p.billing_party_id
    where upper(trim(b.name)) = upper(trim(p_billing_party))
      and coalesce(b.entry_status, 'final') = 'final' and p.status = 'Active');
end;
$$;
revoke all on function public.get_lr_purchase_orders(text) from public, anon;
grant execute on function public.get_lr_purchase_orders(text) to authenticated;

-- Preserve the existing atomic number allocator; add the PO snapshot in the SAME transaction.
create function public.create_numbered_lr_draft_with_po(p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_row jsonb; v_saved public.lrs;
begin
  v_row := public.create_numbered_lr_draft(p_payload);
  update public.lrs set purchase_order_id = nullif(p_payload->>'purchase_order_id', '')::bigint,
    po_date = nullif(p_payload->>'po_date', '')::date
    where id = (v_row->>'id')::bigint returning * into v_saved;
  if not found then raise exception 'Not permitted to attach PO to draft'; end if;
  return to_jsonb(v_saved);
end;
$$;
revoke all on function public.create_numbered_lr_draft_with_po(jsonb) from public, anon;
grant execute on function public.create_numbered_lr_draft_with_po(jsonb) to authenticated;

commit;
