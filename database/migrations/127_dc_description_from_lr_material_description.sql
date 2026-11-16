-- 127: Delivery Challan "Description" comes from the LR's Material
-- Description (owner's decision), not the Material name. When an LR has no
-- Material Description, the Material name is used, so the DC field (which
-- is required) is never left empty.
--
-- Only the automatic LR -> DC copy rule changes, and its trigger is
-- re-attached so it also runs when just the Material Description changes. Nothing else in the rule changes,
-- and no existing DC is touched by this script: existing DCs pick up the
-- new rule the next time their LR is changed.
-- Rollback: 127_..._rollback.sql (the exact live definition before 127).

begin;

CREATE OR REPLACE FUNCTION public.sync_delivery_challans_from_lr()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_changed boolean;
begin
  -- Only finalized LRs own active DC snapshots. Ordinary draft edits
  -- never synchronize.
  if new.entry_status is distinct from 'final' then
    return new;
  end if;

  v_changed :=
    -- draft/non-final -> final must always be allowed to sync,
    -- even when the visible snapshot values did not change.
    old.entry_status is distinct from 'final'
    or old.lr_date            is distinct from new.lr_date
    or old.consignor          is distinct from new.consignor
    or old.consignor_address  is distinct from new.consignor_address
    or old.consignor_gst      is distinct from new.consignor_gst
    or old.consignee          is distinct from new.consignee
    or old.consignee_address  is distinct from new.consignee_address
    or old.consignee_gst      is distinct from new.consignee_gst
    or old.material           is distinct from new.material
    or old.material_description is distinct from new.material_description
    or old.loading_weight     is distinct from new.loading_weight
    or old.vehicle_number     is distinct from new.vehicle_number
    or old.po_number          is distinct from new.po_number
    or old.po_date            is distinct from new.po_date;

  if not v_changed then
    return new;
  end if;

  -- No LR number -> nothing can be linked.
  if new.lr_number is null or btrim(new.lr_number) = '' then
    return new;
  end if;

  update public.delivery_challans as dc
  set
    lr_date           = new.lr_date,
    consignor         = new.consignor,
    consignor_address = new.consignor_address,
    consignor_gst     = new.consignor_gst,
    consignee         = new.consignee,
    consignee_address = new.consignee_address,
    consignee_gst     = new.consignee_gst,
    -- DC Description = LR Material Description (Material name when blank).
    description       = coalesce(nullif(btrim(new.material_description), ''), new.material),
    qty               = new.loading_weight,
    vehicle_number    = new.vehicle_number,
    po_number         = new.po_number,
    -- dc.po_date is NOT NULL; never write NULL. Preserve the existing
    -- DC date when the final LR has no PO date.
    po_date           = coalesce(new.po_date, dc.po_date)
  where dc.lr_number = new.lr_number;

  return new;
end;
$function$;

drop trigger trg_lrs_sync_delivery_challans on public.lrs;
CREATE TRIGGER trg_lrs_sync_delivery_challans AFTER UPDATE ON public.lrs FOR EACH ROW WHEN (((new.entry_status = 'final'::text) AND ((old.entry_status IS DISTINCT FROM new.entry_status) OR (old.lr_date IS DISTINCT FROM new.lr_date) OR (old.consignor IS DISTINCT FROM new.consignor) OR (old.consignor_address IS DISTINCT FROM new.consignor_address) OR (old.consignor_gst IS DISTINCT FROM new.consignor_gst) OR (old.consignee IS DISTINCT FROM new.consignee) OR (old.consignee_address IS DISTINCT FROM new.consignee_address) OR (old.consignee_gst IS DISTINCT FROM new.consignee_gst) OR (old.material IS DISTINCT FROM new.material) OR (old.material_description IS DISTINCT FROM new.material_description) OR (old.loading_weight IS DISTINCT FROM new.loading_weight) OR (old.vehicle_number IS DISTINCT FROM new.vehicle_number) OR (old.po_number IS DISTINCT FROM new.po_number) OR (old.po_date IS DISTINCT FROM new.po_date)))) EXECUTE FUNCTION sync_delivery_challans_from_lr();

commit;
