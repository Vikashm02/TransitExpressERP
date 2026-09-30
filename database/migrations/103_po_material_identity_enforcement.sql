-- Stage 2 ONLY: apply manually after 102 + application smoke tests.
-- Nullable legacy rows remain valid. Existing PO-number uniqueness is untouched.
begin;
set local lock_timeout = '5s';
create function public.purchase_order_require_material_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'INSERT' then
   if new.material_id is null then raise exception 'Select Material before creating a PO'; end if;
 elsif old.material_id is not null and new.material_id is null then
   raise exception 'An assigned PO Material cannot be cleared';
 end if;
 return new;
end;
$$;
revoke all on function public.purchase_order_require_material_identity() from public, anon, authenticated;
create trigger purchase_order_require_material_identity before insert or update on public.purchase_orders
 for each row execute function public.purchase_order_require_material_identity();

-- Interactive finalization only. Historical final INSERTs and unrelated final edits remain valid.
create function public.lr_require_material_on_finalization() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if old.entry_status = 'draft' and new.entry_status = 'final' and new.material_id is null then
   raise exception 'Select Material before finalizing this LR';
 end if;
 return new;
end;
$$;
revoke all on function public.lr_require_material_on_finalization() from public, anon, authenticated;
create trigger a_lr_require_material_on_finalization before update on public.lrs
 for each row execute function public.lr_require_material_on_finalization();
commit;
