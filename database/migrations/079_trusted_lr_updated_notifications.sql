-- ==========================================================
-- Migration: 079_trusted_lr_updated_notifications
-- Module: trusted LR Updated notification event creation
--
-- This migration deliberately covers ONLY lr.updated. Existing client-created
-- events for LR create/delete, POD, DC, and Financials remain unchanged.
-- Apply manually only after review.
-- ==========================================================

begin;

-- Existing and browser-created events are deliberately marked client. The
-- permanent dispatcher below accepts only the marker written by this trusted
-- trigger, so pre-079 or fabricated historic rows cannot be delivered as LR
-- updates.
alter table public.notification_events
  add column if not exists source text not null default 'client'
    check (source in ('client', 'trusted_lr_trigger'));

-- Notification-specific operational-change predicate. This intentionally does
-- not reuse lr_has_quality_content_change(), whose broader metric definition
-- includes Finance-owned columns and internal notes.
create or replace function public.lr_has_notification_operational_change(
  p_old public.lrs,
  p_new public.lrs
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select row(
    p_new.lr_number,
    p_new.lr_date,
    p_new.booking_branch,
    p_new.customer,
    p_new.billing_party,
    p_new.consignor,
    p_new.consignor_gst,
    p_new.consignor_address,
    p_new.consignee,
    p_new.consignee_gst,
    p_new.consignee_address,
    p_new.vehicle_number,
    p_new.vehicle_type,
    p_new.transporter,
    p_new.driver_name,
    p_new.driver_mobile,
    p_new.from_station,
    p_new.to_station,
    p_new.material,
    p_new.material_description,
    p_new.package_type,
    p_new.packages,
    p_new.loading_weight,
    p_new.unloading_weight,
    p_new.charged_weight,
    p_new.po_number,
    p_new.po_date,
    p_new.vendor_code,
    p_new.dc_number,
    p_new.dc_date,
    p_new.invoice_number,
    p_new.invoice_date,
    p_new.invoice_value,
    p_new.eway_bill_number,
    p_new.remarks
  ) is distinct from row(
    p_old.lr_number,
    p_old.lr_date,
    p_old.booking_branch,
    p_old.customer,
    p_old.billing_party,
    p_old.consignor,
    p_old.consignor_gst,
    p_old.consignor_address,
    p_old.consignee,
    p_old.consignee_gst,
    p_old.consignee_address,
    p_old.vehicle_number,
    p_old.vehicle_type,
    p_old.transporter,
    p_old.driver_name,
    p_old.driver_mobile,
    p_old.from_station,
    p_old.to_station,
    p_old.material,
    p_old.material_description,
    p_old.package_type,
    p_old.packages,
    p_old.loading_weight,
    p_old.unloading_weight,
    p_old.charged_weight,
    p_old.po_number,
    p_old.po_date,
    p_old.vendor_code,
    p_old.dc_number,
    p_old.dc_date,
    p_old.invoice_number,
    p_old.invoice_date,
    p_old.invoice_value,
    p_old.eway_bill_number,
    p_old.remarks
  );
$$;

revoke all on function public.lr_has_notification_operational_change(public.lrs, public.lrs)
  from public, anon, authenticated;

-- Server-side equivalent of the existing notification rule timing semantics.
-- It is called inside the trigger's fail-open enqueue block, so an invalid
-- administrator rule cannot make an LR update fail.
create or replace function public.notification_rule_deliver_after(
  p_delivery_mode text,
  p_scheduled_time text,
  p_quiet_hours_enabled boolean,
  p_quiet_hours_start text,
  p_quiet_hours_end text,
  p_timezone text
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_timezone text := coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata');
  v_local_now timestamp;
  v_scheduled time;
  v_quiet_start time;
  v_quiet_end time;
  v_target_date date;
begin
  v_local_now := now() at time zone v_timezone;

  begin
    v_scheduled := coalesce(nullif(trim(p_scheduled_time), ''), '08:00')::time;
    v_quiet_start := coalesce(nullif(trim(p_quiet_hours_start), ''), '22:00')::time;
    v_quiet_end := coalesce(nullif(trim(p_quiet_hours_end), ''), '06:00')::time;
  exception
    when others then
      raise exception 'Invalid notification-rule time configuration';
  end;

  if p_delivery_mode = 'scheduled' then
    v_target_date := v_local_now::date;
    if v_local_now::time >= v_scheduled then
      v_target_date := v_target_date + 1;
    end if;
    return (v_target_date + v_scheduled) at time zone v_timezone;
  end if;

  if coalesce(p_quiet_hours_enabled, true) and v_quiet_start <> v_quiet_end then
    if (
      (v_quiet_start < v_quiet_end and v_local_now::time >= v_quiet_start and v_local_now::time < v_quiet_end)
      or
      (v_quiet_start > v_quiet_end and (v_local_now::time >= v_quiet_start or v_local_now::time < v_quiet_end))
    ) then
      v_target_date := v_local_now::date;
      if v_quiet_start > v_quiet_end and v_local_now::time >= v_quiet_start then
        v_target_date := v_target_date + 1;
      end if;
      return (v_target_date + v_quiet_end) at time zone v_timezone;
    end if;
  end if;

  return now();
end;
$$;

revoke all on function public.notification_rule_deliver_after(text, text, boolean, text, text, text)
  from public, anon, authenticated;

-- A security-definer trigger is the only trusted creator of lr.updated
-- events. It runs after the LR mutation succeeds and derives every visible
-- field from the persisted row. Normal browser callers remain subject to the
-- narrow RLS policy below and cannot insert this rule directly.
create or replace function public.queue_trusted_lr_updated_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.notification_rules%rowtype;
  v_is_real_update boolean;
  v_deliver_after timestamptz;
begin
  -- Maintenance performed through a controlled SQL transaction may opt out
  -- with SET LOCAL app.suppress_lr_updated_notifications = 'on'. No browser
  -- code or public RPC is given a way to set this database-local flag.
  if coalesce(current_setting('app.suppress_lr_updated_notifications', true), 'off') = 'on' then
    return null;
  end if;

  -- Internal trigger writes, including PO snapshot linking after an LR write,
  -- run at a nested trigger depth. Only the top-level LR mutation may enqueue
  -- an event, which also keeps import INSERT → internal UPDATE paths silent.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- A service-role/background write has no authenticated ERP actor. Skip it
  -- rather than inventing an attribution or alerting staff during repairs.
  if auth.uid() is null or new.updated_by is distinct from auth.uid() then
    return null;
  end if;

  -- Draft autosaves are excluded. The existing application treats a draft to
  -- final transition as an LR update, so that transition is intentionally
  -- retained. Final-to-final updates require an operational-field change;
  -- Finance-owned, internal, status, assignment, and audit writes are
  -- intentionally excluded.
  if coalesce(new.entry_status, 'final') <> 'final' then
    return null;
  end if;

  v_is_real_update :=
    (coalesce(old.entry_status, 'final') = 'draft')
    or (
      coalesce(old.entry_status, 'final') = 'final'
      and public.lr_has_notification_operational_change(old, new)
    );

  if not v_is_real_update then
    return null;
  end if;

  -- Notification enqueue is deliberately fail-open. Only failures in this
  -- rule lookup / outbox insert are caught: LR validation, audit, ownership,
  -- and business-trigger failures still retain their normal transaction
  -- semantics. The warning exposes only a SQLSTATE, never row data or keys.
  begin
    select r.*
      into v_rule
    from public.notification_rules r
    where r.rule_key = 'lr.updated';

    if coalesce(v_rule.enabled, false) then
      v_deliver_after := public.notification_rule_deliver_after(
        v_rule.delivery_mode,
        v_rule.scheduled_time,
        v_rule.quiet_hours_enabled,
        v_rule.quiet_hours_start,
        v_rule.quiet_hours_end,
        v_rule.timezone
      );

      insert into public.notification_events (
        rule_key,
        title,
        body,
        href,
        payload,
        created_by,
        source,
        deliver_after
      )
      values (
        'lr.updated',
        'LR ' || new.lr_number || ' updated',
        coalesce(new.consignor, '') || ' → ' || coalesce(new.consignee, ''),
        '/lr',
        jsonb_build_object('lrId', new.id, 'lrNumber', new.lr_number),
        auth.uid(),
        'trusted_lr_trigger',
        v_deliver_after
      );
    end if;
  exception
    when others then
      raise warning 'Trusted lr.updated notification enqueue skipped (SQLSTATE %)', SQLSTATE;
  end;

  return null;
end;
$$;

revoke all on function public.queue_trusted_lr_updated_notification() from public, anon, authenticated;

drop trigger if exists trg_lrs_trusted_lr_updated_notification on public.lrs;
create trigger trg_lrs_trusted_lr_updated_notification
after update on public.lrs
for each row
execute function public.queue_trusted_lr_updated_notification();

-- Preserve all existing client-created notification types, while preventing a
-- browser session from fabricating the single rule now owned by the trusted
-- LR trigger above. The security-definer trigger runs as the migration/table
-- owner and therefore bypasses this authenticated-client policy.
drop policy if exists notification_events_insert on public.notification_events;
create policy notification_events_insert
on public.notification_events
for insert
to authenticated
with check (
  created_by = auth.uid()
  and rule_key <> 'lr.updated'
  and source = 'client'
);

commit;
