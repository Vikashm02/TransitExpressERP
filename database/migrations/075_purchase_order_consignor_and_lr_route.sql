-- PO-to-Consignor association, LR-originated POs, and master-derived routes.
-- No backfill or historical LR overwrite.
begin;
alter table public.purchase_orders add column consignor text;
alter table public.purchase_orders alter column allotted_weight drop not null;
alter table public.purchase_orders drop constraint if exists purchase_orders_allotted_weight_check;
alter table public.purchase_orders add constraint purchase_orders_allotted_weight_check check (allotted_weight is null or (allotted_weight > 0 and allotted_weight < 'Infinity'::numeric));
drop index if exists public.purchase_orders_party_number;
create unique index purchase_orders_party_consignor_number on public.purchase_orders(billing_party_id, coalesce(upper(trim(consignor)), ''), upper(trim(po_number)));
create or replace function public.get_purchase_orders() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.has_permission('purchase_orders','view') then raise exception 'Not permitted to view PO master'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc),'[]'::jsonb) from (select p.id,p.billing_party_id,b.name as billing_party_name,p.consignor,p.po_number,p.issue_date,p.allotted_weight,p.status,coalesce((select sum(l.loading_weight) from public.lrs l where l.purchase_order_id=p.id and l.entry_status='final' and l.status is distinct from 'Cancelled'),0) as used_weight from public.purchase_orders p join public.billing_parties b on b.id=p.billing_party_id) r);
end;
$$;
revoke all on function public.get_purchase_orders() from public, anon;
grant execute on function public.get_purchase_orders() to authenticated;
create or replace function public.get_lr_purchase_orders(p_billing_party text, p_consignor text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not (public.has_permission('lr', 'create_view') or public.has_permission('lr', 'edit')) then raise exception 'Not permitted'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'po_number',p.po_number,'issue_date',p.issue_date) order by p.issue_date desc,p.id desc),'[]'::jsonb) from public.purchase_orders p join public.billing_parties b on b.id=p.billing_party_id where upper(trim(b.name))=upper(trim(p_billing_party)) and upper(trim(coalesce(p.consignor,'')))=upper(trim(p_consignor)) and p.status='Active');
end;
$$;
revoke all on function public.get_lr_purchase_orders(text, text) from public, anon;
grant execute on function public.get_lr_purchase_orders(text, text) to authenticated;
create function public.lr_derive_route_from_master() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_from text; v_to text;
begin
 if new.entry_status <> 'final' then return new; end if;
 select city into v_from from public.customers where upper(trim(name))=upper(trim(new.consignor)) and coalesce(entry_status,'final')='final';
 select city into v_to from public.customers where upper(trim(name))=upper(trim(new.consignee)) and coalesce(entry_status,'final')='final';
 if nullif(trim(v_from),'') is null then raise exception 'Consignor city is required in Customer Master'; end if;
 if nullif(trim(v_to),'') is null then raise exception 'Consignee city is required in Customer Master'; end if;
 new.from_station:=v_from; new.to_station:=v_to; return new;
end;
$$;
revoke all on function public.lr_derive_route_from_master() from public, anon, authenticated;
create trigger trg_lr_derive_route_from_master before insert or update of consignor, consignee on public.lrs for each row execute function public.lr_derive_route_from_master();
create function public.lr_create_purchase_order_from_snapshot() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_party_id bigint; v_po_id bigint;
begin
 if new.entry_status <> 'final' or nullif(trim(new.po_number),'') is null or new.po_date is null then return new; end if;
 select id into v_party_id from public.billing_parties where upper(trim(name))=upper(trim(new.customer)) and coalesce(entry_status,'final')='final';
 if v_party_id is null then raise exception 'Billing party must be finalized before adding a PO'; end if;
 select id into v_po_id from public.purchase_orders where billing_party_id=v_party_id and upper(trim(coalesce(consignor,'')))=upper(trim(new.consignor)) and upper(trim(po_number))=upper(trim(new.po_number));
 if v_po_id is null then insert into public.purchase_orders(billing_party_id,consignor,po_number,issue_date,allotted_weight,status) values(v_party_id,new.consignor,new.po_number,new.po_date,null,'Active') returning id into v_po_id; end if;
 update public.lrs set purchase_order_id=v_po_id where id=new.id;
 return new;
end;
$$;
revoke all on function public.lr_create_purchase_order_from_snapshot() from public, anon, authenticated;
create trigger trg_lr_create_purchase_order_from_snapshot after insert or update of entry_status,customer,consignor,po_number,po_date on public.lrs for each row execute function public.lr_create_purchase_order_from_snapshot();
commit;
