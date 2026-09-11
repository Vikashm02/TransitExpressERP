-- Fix PO audit recording for UUID-based LR identifiers.
-- Retains the legacy bigint lr_id column and adds the correct UUID field.
begin;

alter table public.purchase_order_audit
  add column lr_uuid uuid references public.lrs(id) on delete restrict;

create index purchase_order_audit_lr_uuid on public.purchase_order_audit(lr_uuid)
  where lr_uuid is not null;

create or replace function public.lr_record_purchase_order_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb;
begin
  v_new := jsonb_build_object('purchase_order_id', new.purchase_order_id, 'po_number', new.po_number, 'po_date', new.po_date);
  if tg_op = 'UPDATE' then
    v_old := jsonb_build_object('purchase_order_id', old.purchase_order_id, 'po_number', old.po_number, 'po_date', old.po_date);
    if v_old = v_new then return new; end if;
  elsif new.purchase_order_id is null and new.po_date is null then return new;
  end if;
  insert into public.purchase_order_audit(purchase_order_id, lr_uuid, action, old_values, new_values, actor_id)
    values (new.purchase_order_id, new.id, 'LR_' || tg_op, v_old, v_new, auth.uid());
  return new;
end;
$$;
revoke all on function public.lr_record_purchase_order_audit() from public, anon, authenticated;

commit;
