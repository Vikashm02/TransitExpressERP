-- ==========================================================
-- Migration: 104_fix_legacy_lr_po_snapshot
-- Module:    Legacy LR PO snapshot preservation
--
-- Fixes lr_create_purchase_order_from_snapshot to allow legacy enrichment:
-- When a legacy finalized LR has a historical PO snapshot (po_number, po_date)
-- but no material_id, allow linking to the existing PO without material match.
-- The material_id can be enriched later via lr_validate_material_identity trigger.
--
-- This corrects the regression where legacy finalized LRs with NULL material_id
-- and historical PO snapshots would fail on edit with:
-- "Existing PO number conflicts with selected Material or Active status"
--
-- M102/M103 are already live. This is a forward-only corrective migration.
-- ==========================================================

begin;
set local lock_timeout = '5s';

create or replace function public.lr_create_purchase_order_from_snapshot() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_party_id bigint; v_po_id bigint; v_po public.purchase_orders;
begin
 if new.entry_status <> 'final' or nullif(trim(new.po_number),'') is null or new.po_date is null then return new; end if;
 -- An already attached PO has been checked by the BEFORE validator. Preserve legacy links.
 if new.purchase_order_id is not null then return new; end if;

 -- Use the trusted binding when present; legacy rows keep their existing PO behavior.
 v_party_id := new.billing_party_id;
 if v_party_id is not null then
   perform 1 from public.billing_parties where id = v_party_id
     and coalesce(entry_status, 'final') = 'final' for share;
   if not found then raise exception 'Billing party must be finalized before adding a PO'; end if;
 else
   select id into v_party_id from public.billing_parties where upper(trim(name))=upper(trim(new.customer)) and coalesce(entry_status,'final')='final';
 end if;
 if v_party_id is null then raise exception 'Billing party must be finalized before adding a PO'; end if;
 select * into v_po from public.purchase_orders where billing_party_id=v_party_id
   and upper(trim(coalesce(consignor,'')))=upper(trim(new.consignor))
   and upper(trim(po_number))=upper(trim(new.po_number)) for share;
 if found then
   -- Legacy enrichment: only for genuine legacy LRs where the historical PO snapshot
   -- already existed BEFORE this update (OLD has the historical PO snapshot with NULL material_id).
   -- This prevents new LRs from exploiting legacy bypass by adding a PO number.
   if TG_OP = 'UPDATE'
       and old.entry_status = 'final'
       and nullif(trim(old.po_number), '') is not null
       and old.po_date is not null
       and old.material_id is null
       and old.purchase_order_id is null
       and upper(trim(new.po_number)) = upper(trim(old.po_number))
       and new.po_date is not distinct from old.po_date
       and new.billing_party_id is not distinct from old.billing_party_id
       and upper(trim(coalesce(new.consignor,''))) = upper(trim(coalesce(old.consignor,'')))
       and new.material_id is null
   then
     -- Legacy enrichment: link to existing PO without requiring material_id match
     -- This preserves historical PO links for legacy finalized LRs with historical snapshot.
     v_po_id := v_po.id;
   else
     -- Normal case: require material_id match for new PO selections or genuine changes
     if new.material_id is null then raise exception 'Select Material before creating a PO from this LR'; end if;
     if v_po.material_id is distinct from new.material_id or v_po.status <> 'Active' then
       raise exception 'Existing PO number conflicts with selected Material or Active status';
     end if;
     v_po_id := v_po.id;
   end if;
 else
   if new.material_id is null then raise exception 'Select Material before creating a PO from this LR'; end if;
   insert into public.purchase_orders(billing_party_id,consignor,material_id,po_number,issue_date,allotted_weight,status)
   values(v_party_id,new.consignor,new.material_id,new.po_number,new.po_date,null,'Active') returning id into v_po_id;
 end if;
 update public.lrs set purchase_order_id=v_po_id where id=new.id;
 return new;
end;
$$;

revoke all on function public.lr_create_purchase_order_from_snapshot() from public;
revoke all on function public.lr_create_purchase_order_from_snapshot() from anon;
revoke all on function public.lr_create_purchase_order_from_snapshot() from authenticated;
grant execute on function public.lr_create_purchase_order_from_snapshot() to authenticated;

comment on function public.lr_create_purchase_order_from_snapshot() is
  'After insert/update on LRs: auto-links finalized LRs with PO snapshots to PO master. Legacy enrichment allows NULL material_id to link to existing PO by po_number/consignor ONLY for genuine legacy UPDATE where historical snapshot already existed.';

commit;
