-- ==========================================================
-- Migration: 117_po_usage_alerts_95_100
-- Module:    PO Master — usage alerts at 80%, 90%, 95% and 100%
--
-- NOT executed automatically — review and run manually in the
-- Supabase SQL editor. Before running, confirm the live
-- queue_purchase_order_usage_alert() still matches migration 074.
--
-- What changes:
--   1. Two new notification rules: po.usage_95 and po.usage_100
--      (enabled, immediate — PO alerts are never held by quiet hours).
--   2. Two new nullable marker columns on purchase_order_notification_state
--      (notified_95_at, notified_100_at). Existing rows get NULL.
--   3. queue_purchase_order_usage_alert() now checks four levels:
--      80%, 90%, 95% and 100% (100% = used weight has reached or gone
--      over the allotted weight).
--
-- Behaviour (unchanged from 074 except the two extra levels):
--   - Each level alerts once per PO. If one LR jumps a PO past several
--     levels at once, only the highest level is sent and the lower
--     levels are marked as done, so staff get one clear alert.
--   - Markers are never reset, so edits/recalculations never repeat alerts.
--   - Alerts are evaluated whenever an LR's PO link, loading weight,
--     entry status or LR status changes, or a PO's allotted weight changes.
--   - PO status is never changed here: a PO over 100% stays Active until
--     someone sets it Inactive by hand.
--
-- Data safety:
--   - No row is deleted or updated by this migration. It only adds two
--     rule rows, two nullable columns, and replaces one function body.
--   - POs already above 95% / 100% get the new alert the next time one of
--     their LRs (or their allotted weight) changes; nothing is sent now.
--   - Rollback: re-run the function definition from migration 074 and
--     set the two new rules to enabled = false.
-- ==========================================================

begin;

insert into public.notification_rules (
  rule_key, category, name, description, enabled, delivery_mode, scheduled_time, sort_order
)
values
  ('po.usage_95', 'PO Master', 'PO 95% Used', 'Critical warning when a purchase order reaches 95% of its allotted loading weight.', true, 'immediate', '08:00', 155),
  ('po.usage_100', 'PO Master', 'PO Limit Reached', 'Alarm when a purchase order reaches or exceeds 100% of its allotted loading weight.', true, 'immediate', '08:00', 160)
on conflict (rule_key) do nothing;

alter table public.purchase_order_notification_state
  add column if not exists notified_95_at timestamptz,
  add column if not exists notified_100_at timestamptz;

create or replace function public.queue_purchase_order_usage_alert(p_purchase_order_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po record;
  v_used_weight numeric;
  v_percent numeric;
  v_state public.purchase_order_notification_state;
  v_level integer;
  v_rule_key text;
  v_rule_enabled boolean;
  v_title text;
  v_balance text;
begin
  if p_purchase_order_id is null then return; end if;

  select p.id, p.po_number, p.allotted_weight, b.name as billing_party_name
    into v_po
  from public.purchase_orders p
  join public.billing_parties b on b.id = p.billing_party_id
  where p.id = p_purchase_order_id;
  if not found or v_po.allotted_weight is null or v_po.allotted_weight <= 0 then return; end if;

  select coalesce(sum(l.loading_weight), 0) into v_used_weight
  from public.lrs l
  where l.purchase_order_id = p_purchase_order_id
    and l.entry_status = 'final'
    and l.status is distinct from 'Cancelled';
  v_percent := (v_used_weight / v_po.allotted_weight) * 100;

  -- Highest level reached right now.
  v_level := case
    when v_percent >= 100 then 100
    when v_percent >= 95 then 95
    when v_percent >= 90 then 90
    when v_percent >= 80 then 80
    else null
  end;
  if v_level is null then return; end if;

  insert into public.purchase_order_notification_state (purchase_order_id)
  values (p_purchase_order_id)
  on conflict (purchase_order_id) do nothing;
  select * into v_state from public.purchase_order_notification_state
  where purchase_order_id = p_purchase_order_id for update;

  -- Already alerted at this level (or a higher one): nothing to send.
  if (v_level = 100 and v_state.notified_100_at is not null)
    or (v_level = 95 and (v_state.notified_95_at is not null or v_state.notified_100_at is not null))
    or (v_level = 90 and (v_state.notified_90_at is not null or v_state.notified_95_at is not null or v_state.notified_100_at is not null))
    or (v_level = 80 and (v_state.notified_80_at is not null or v_state.notified_90_at is not null or v_state.notified_95_at is not null or v_state.notified_100_at is not null))
  then
    return;
  end if;

  v_rule_key := 'po.usage_' || v_level;
  select enabled into v_rule_enabled from public.notification_rules where rule_key = v_rule_key;
  if not coalesce(v_rule_enabled, false) then return; end if;

  v_title := case
    when v_level = 100 and v_used_weight > v_po.allotted_weight then 'LIMIT EXCEEDED: PO ' || v_po.po_number || ' is over its allotted weight'
    when v_level = 100 then 'LIMIT REACHED: PO ' || v_po.po_number || ' has used 100% of its allotted weight'
    when v_level = 95 then 'CRITICAL: PO ' || v_po.po_number || ' has crossed 95% usage'
    when v_level = 90 then 'URGENT: PO ' || v_po.po_number || ' has crossed 90% usage'
    else 'PO ' || v_po.po_number || ' has crossed 80% usage'
  end;
  v_balance := case
    when v_used_weight > v_po.allotted_weight then round(v_used_weight - v_po.allotted_weight, 3) || ' MT over the limit.'
    else round(v_po.allotted_weight - v_used_weight, 3) || ' MT remaining.'
  end;

  insert into public.notification_events (rule_key, title, body, href, payload)
  values (
    v_rule_key,
    v_title,
    v_po.billing_party_name || ': ' || round(v_used_weight, 3) || ' MT used of ' || round(v_po.allotted_weight, 3)
      || ' MT (' || round(v_percent, 1) || '%). ' || v_balance,
    '/purchase-orders',
    jsonb_build_object('purchaseOrderId', v_po.id, 'threshold', v_level, 'usedWeight', v_used_weight,
      'allottedWeight', v_po.allotted_weight, 'usagePercent', round(v_percent, 1))
  );

  -- Mark this level and every lower level as done.
  update public.purchase_order_notification_state
  set notified_80_at = coalesce(notified_80_at, now()),
      notified_90_at = case when v_level >= 90 then coalesce(notified_90_at, now()) else notified_90_at end,
      notified_95_at = case when v_level >= 95 then coalesce(notified_95_at, now()) else notified_95_at end,
      notified_100_at = case when v_level >= 100 then coalesce(notified_100_at, now()) else notified_100_at end,
      updated_at = now()
  where purchase_order_id = p_purchase_order_id;
end;
$$;
revoke all on function public.queue_purchase_order_usage_alert(bigint) from public, anon, authenticated;

commit;
