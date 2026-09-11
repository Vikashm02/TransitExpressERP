-- PO usage alerts. Apply manually after reviewing migration 073.
-- An alert is created once when a PO first reaches 80% and once at 90%.
-- Delivery is handled by the existing notification queue and its configured processor.
begin;

insert into public.notification_rules (
  rule_key, category, name, description, enabled, delivery_mode, scheduled_time, sort_order
)
values
  ('po.usage_80', 'PO Master', 'PO 80% Used', 'Warn when a purchase order reaches 80% of its allotted loading weight.', true, 'immediate', '08:00', 140),
  ('po.usage_90', 'PO Master', 'PO 90% Used', 'Urgent warning when a purchase order reaches 90% of its allotted loading weight.', true, 'immediate', '08:00', 150)
on conflict (rule_key) do nothing;

create table public.purchase_order_notification_state (
  purchase_order_id bigint primary key references public.purchase_orders(id) on delete restrict,
  notified_80_at timestamptz,
  notified_90_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.purchase_order_notification_state enable row level security;
revoke all on public.purchase_order_notification_state from anon, authenticated;

create function public.queue_purchase_order_usage_alert(p_purchase_order_id bigint)
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
  v_rule_enabled boolean;
begin
  if p_purchase_order_id is null then return; end if;

  select p.id, p.po_number, p.allotted_weight, b.name as billing_party_name
    into v_po
  from public.purchase_orders p
  join public.billing_parties b on b.id = p.billing_party_id
  where p.id = p_purchase_order_id;
  if not found or v_po.allotted_weight <= 0 then return; end if;

  select coalesce(sum(l.loading_weight), 0) into v_used_weight
  from public.lrs l
  where l.purchase_order_id = p_purchase_order_id
    and l.entry_status = 'final'
    and l.status is distinct from 'Cancelled';
  v_percent := (v_used_weight / v_po.allotted_weight) * 100;

  insert into public.purchase_order_notification_state (purchase_order_id)
  values (p_purchase_order_id)
  on conflict (purchase_order_id) do nothing;
  select * into v_state from public.purchase_order_notification_state
  where purchase_order_id = p_purchase_order_id for update;

  -- A PO that first appears at 90% gets the urgent alert only. Both markers
  -- are retained to keep edits/recalculations from repeatedly alerting staff.
  if v_percent >= 90 and v_state.notified_90_at is null then
    select enabled into v_rule_enabled from public.notification_rules where rule_key = 'po.usage_90';
    if coalesce(v_rule_enabled, false) then
      insert into public.notification_events (rule_key, title, body, href, payload)
      values (
        'po.usage_90',
        'PO ' || v_po.po_number || ' has crossed 90% usage',
        v_po.billing_party_name || ': ' || round(v_used_weight, 3) || ' MT used of ' || round(v_po.allotted_weight, 3) || ' MT (' || round(v_percent, 1) || '%).',
        '/purchase-orders',
        jsonb_build_object('purchaseOrderId', v_po.id, 'threshold', 90, 'usedWeight', v_used_weight, 'allottedWeight', v_po.allotted_weight, 'usagePercent', round(v_percent, 1))
      );
      update public.purchase_order_notification_state
      set notified_80_at = coalesce(notified_80_at, now()), notified_90_at = now(), updated_at = now()
      where purchase_order_id = p_purchase_order_id;
    end if;
  elsif v_percent >= 80 and v_state.notified_80_at is null then
    select enabled into v_rule_enabled from public.notification_rules where rule_key = 'po.usage_80';
    if coalesce(v_rule_enabled, false) then
      insert into public.notification_events (rule_key, title, body, href, payload)
      values (
        'po.usage_80',
        'PO ' || v_po.po_number || ' has crossed 80% usage',
        v_po.billing_party_name || ': ' || round(v_used_weight, 3) || ' MT used of ' || round(v_po.allotted_weight, 3) || ' MT (' || round(v_percent, 1) || '%).',
        '/purchase-orders',
        jsonb_build_object('purchaseOrderId', v_po.id, 'threshold', 80, 'usedWeight', v_used_weight, 'allottedWeight', v_po.allotted_weight, 'usagePercent', round(v_percent, 1))
      );
      update public.purchase_order_notification_state
      set notified_80_at = now(), updated_at = now()
      where purchase_order_id = p_purchase_order_id;
    end if;
  end if;
end;
$$;
revoke all on function public.queue_purchase_order_usage_alert(bigint) from public, anon, authenticated;

create function public.evaluate_purchase_order_usage_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'purchase_orders' then
    perform public.queue_purchase_order_usage_alert(new.id);
  elsif tg_op = 'UPDATE' then
    perform public.queue_purchase_order_usage_alert(old.purchase_order_id);
    perform public.queue_purchase_order_usage_alert(new.purchase_order_id);
  else
    perform public.queue_purchase_order_usage_alert(new.purchase_order_id);
  end if;
  return null;
end;
$$;
revoke all on function public.evaluate_purchase_order_usage_alert() from public, anon, authenticated;

drop trigger if exists trg_purchase_order_usage_alert_on_lr on public.lrs;
create trigger trg_purchase_order_usage_alert_on_lr
after insert or update of purchase_order_id, loading_weight, entry_status, status on public.lrs
for each row execute function public.evaluate_purchase_order_usage_alert();

drop trigger if exists trg_purchase_order_usage_alert_on_po on public.purchase_orders;
create trigger trg_purchase_order_usage_alert_on_po
after update of allotted_weight on public.purchase_orders
for each row execute function public.evaluate_purchase_order_usage_alert();

commit;
