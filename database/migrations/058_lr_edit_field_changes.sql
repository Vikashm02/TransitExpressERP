-- ==========================================================
-- Migration: 058_lr_edit_field_changes
-- Module:    LR forward-looking field-level edit audit
--
-- Additive and NOT applied automatically -- review, then apply manually.
-- Historical lr_edit_events rows retain an empty changes array; field
-- changes are captured only for qualifying edits after this migration.
-- ==========================================================

alter table public.lr_edit_events
  add column if not exists changes jsonb not null default '[]'::jsonb;

comment on column public.lr_edit_events.changes is
  'Array of {field_key, field_label, old_value, new_value} for whitelisted business fields changed by this edit.';

create or replace function public.lr_edit_field_diffs(
  p_old public.lrs,
  p_new public.lrs
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'field_key', d.field_key,
        'field_label', d.field_label,
        'old_value', coalesce(to_jsonb(p_old) ->> d.field_key, ''),
        'new_value', coalesce(to_jsonb(p_new) ->> d.field_key, '')
      )
      order by d.field_key
    ),
    '[]'::jsonb
  )
  from (
    values
      ('bill_rate', 'Bill Rate'),
      ('bill_rate_type', 'Bill Rate Type'),
      ('charged_weight', 'Charged Weight'),
      ('consignee', 'Consignee'),
      ('consignee_gst', 'Consignee GST'),
      ('consignor', 'Consignor'),
      ('customer', 'Billing Party'),
      ('driver_mobile', 'Driver Mobile'),
      ('driver_name', 'Driver Name'),
      ('freight_type', 'Freight Type'),
      ('from_station', 'From Location'),
      ('to_station', 'To Location'),
      ('guaranteed_weight', 'Guaranteed Weight'),
      ('loading_weight', 'Loading Weight'),
      ('lorry_hire_rate', 'Lorry Hire Rate'),
      ('lorry_hire_type', 'Lorry Hire Type'),
      ('lr_date', 'LR Date'),
      ('material', 'Material'),
      ('package_type', 'Package Type'),
      ('packages', 'Packages'),
      ('transporter', 'Transporter'),
      ('unloading_weight', 'Unloading Weight'),
      ('vehicle_number', 'Vehicle Number'),
      ('vehicle_type', 'Vehicle Type'),
      ('vendor_code', 'Vendor Code')
  ) as d(field_key, field_label)
  where (to_jsonb(p_old) -> d.field_key)
    is distinct from (to_jsonb(p_new) -> d.field_key);
$$;

comment on function public.lr_edit_field_diffs(public.lrs, public.lrs) is
  'Returns stable, field-key-ordered text diffs for the approved LR business-field whitelist.';

revoke all on function public.lr_edit_field_diffs(public.lrs, public.lrs) from public;
revoke all on function public.lr_edit_field_diffs(public.lrs, public.lrs) from anon, authenticated;

create or replace function public.record_lr_edit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Preserve migration 038 qualification exactly: final -> final and a
  -- quality business-content change. Draft saves, finalization, status-only
  -- changes, and assignment-only changes do not create an event.
  if coalesce(OLD.entry_status, 'final') = 'final'
     and coalesce(NEW.entry_status, 'final') = 'final'
     and public.lr_has_quality_content_change(OLD, NEW) then
    insert into public.lr_edit_events (
      lr_id,
      edited_by,
      lr_created_by,
      edited_at,
      changes
    )
    values (
      NEW.id,
      coalesce(NEW.updated_by, auth.uid()),
      OLD.created_by,
      now(),
      public.lr_edit_field_diffs(OLD, NEW)
    );
  end if;

  return NEW;
end;
$$;

comment on function public.record_lr_edit_event() is
  'Records one qualifying post-final LR content edit with forward-looking whitelisted field diffs.';

-- RLS policies on public.lr_edit_events intentionally remain unchanged.
