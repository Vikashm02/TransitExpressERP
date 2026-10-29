-- ==========================================================
-- Migration: 118_temporary_purchase_orders
-- Module:    PO Master — Temporary POs, "Make Permanent", daily reminders
--
-- NOT executed automatically — review and run manually in the Supabase
-- SQL editor, in one go. Everything runs in one transaction.
--
-- What it adds:
--   1. purchase_orders.is_temporary (default false = every existing PO stays
--      Permanent) and temporary_since; a small purchase_order_reminder_state
--      table remembers the last reminder date (kept off the PO row so the PO
--      history is not touched every day).
--   2. A small trigger that keeps temporary_since correct (set when a PO
--      becomes Temporary, cleared when it becomes Permanent).
--   3. get_purchase_orders() also returns is_temporary / temporary_since.
--      Same definition as migration 108 otherwise.
--   4. make_purchase_order_permanent(po_id, permanent_number, permanent_date):
--      one all-or-nothing step that changes the PO's number and date, marks
--      it Permanent, and updates the PO number/date on every LR linked to it.
--      Delivery Challans follow automatically (existing LR→DC sync, mig. 106).
--      Requires PO Master "edit" permission. "LR updated" alerts are not sent
--      per LR for this system update; every LR change is still recorded in
--      purchase_order_audit by the existing trigger.
--      Bills are fixed documents and are NOT changed; the function returns
--      the bills that still carry the old number so they can be reviewed.
--   5. Notification rule po.temporary_pending + queue_temporary_po_reminders():
--      once a day, for every PO still Temporary 3 or more days after it was
--      marked Temporary, one reminder to all staff.
--   6. pg_cron job "temporary-po-reminders-daily" at 10:00 IST (04:30 UTC).
--      To stop it later: select cron.unschedule('temporary-po-reminders-daily');
--
-- Data safety:
--   - No row is deleted. Existing POs get is_temporary = false (no change).
--   - LR / PO / DC rows change only when someone runs Make Permanent.
--   - Rollback: unschedule the cron job, set the po.temporary_pending rule
--     enabled = false, re-run get_purchase_orders() from migration 108.
--     The new columns can stay (unused).
-- ==========================================================

begin;

-- 1. Columns -------------------------------------------------
alter table public.purchase_orders
  add column if not exists is_temporary boolean not null default false,
  add column if not exists temporary_since timestamptz;

create table if not exists public.purchase_order_reminder_state (
  purchase_order_id bigint primary key references public.purchase_orders(id) on delete restrict,
  temporary_reminded_on date not null
);
alter table public.purchase_order_reminder_state enable row level security;
revoke all on public.purchase_order_reminder_state from anon, authenticated;

-- 2. Keep temporary_since correct ----------------------------
create or replace function public.purchase_order_track_temporary()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.is_temporary, false) then
    if tg_op = 'INSERT' or not coalesce(old.is_temporary, false) then
      new.temporary_since := now();
    else
      new.temporary_since := old.temporary_since;
    end if;
  else
    new.is_temporary := false;
    new.temporary_since := null;
  end if;
  return new;
end;
$$;
revoke all on function public.purchase_order_track_temporary() from public, anon, authenticated;

drop trigger if exists purchase_order_track_temporary on public.purchase_orders;
create trigger purchase_order_track_temporary
  before insert or update on public.purchase_orders
  for each row execute function public.purchase_order_track_temporary();

-- 3. PO list also returns the temporary fields ---------------
create or replace function public.get_purchase_orders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.has_permission('purchase_orders','view') then raise exception 'Not permitted to view PO master'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc),'[]'::jsonb) from (
   select p.id,p.billing_party_id,b.name as billing_party_name,p.consignor,p.consignee_id,p.consignee,p.po_number,p.issue_date,
     p.allotted_weight,p.status,p.material_id,m.material_name,p.is_temporary,p.temporary_since,
     coalesce((select sum(l.loading_weight) from public.lrs l where l.purchase_order_id=p.id
       and l.entry_status='final' and l.status is distinct from 'Cancelled'),0) as used_weight
   from public.purchase_orders p join public.billing_parties b on b.id=p.billing_party_id
   left join public.materials m on m.id=p.material_id) r);
end;
$$;
revoke all on function public.get_purchase_orders() from public, anon;
grant execute on function public.get_purchase_orders() to authenticated;

-- 4. Make Permanent ------------------------------------------
create or replace function public.make_purchase_order_permanent(
  p_purchase_order_id bigint,
  p_po_number text,
  p_issue_date date
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
  v_new text := upper(trim(coalesce(p_po_number, '')));
  v_old text;
  v_lr_count integer;
  v_bills jsonb;
begin
  if auth.uid() is null or not public.has_module_action('purchase_orders', 'edit') then
    raise exception 'You do not have permission to edit POs in PO Master.';
  end if;
  if v_new = '' then
    raise exception 'Enter the permanent PO number.';
  end if;
  if p_issue_date is null then
    raise exception 'Enter the permanent PO date.';
  end if;

  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if not found then
    raise exception 'This PO was not found. Refresh PO Master and try again.';
  end if;
  if not coalesce(v_po.is_temporary, false) then
    raise exception 'PO % is already permanent.', v_po.po_number;
  end if;
  if exists (
    select 1 from public.purchase_orders
    where billing_party_id = v_po.billing_party_id
      and upper(trim(po_number)) = v_new
      and id <> v_po.id
  ) then
    raise exception 'PO number % already exists for this billing party. Check the number, or ask your administrator to merge the two POs.', v_new;
  end if;

  v_old := v_po.po_number;

  update public.purchase_orders
  set po_number = v_new, issue_date = p_issue_date, is_temporary = false
  where id = v_po.id;

  -- System refresh of linked LR snapshots to the PO master values: no
  -- per-LR "LR updated" alert (purchase_order_audit records each LR change).
  perform set_config('app.suppress_lr_updated_notifications', 'on', true);
  update public.lrs
  set po_number = v_new, po_date = p_issue_date
  where purchase_order_id = v_po.id
    and (po_number is distinct from v_new or po_date is distinct from p_issue_date);
  get diagnostics v_lr_count = row_count;
  perform set_config('app.suppress_lr_updated_notifications', 'off', true);

  select coalesce(jsonb_agg(jsonb_build_object('billNumber', b.bill_number, 'billDate', b.bill_date) order by b.bill_date), '[]'::jsonb)
    into v_bills
  from public.bills b
  where b.billing_party_id = v_po.billing_party_id
    and upper(trim(coalesce(b.po_number, ''))) = upper(trim(v_old));

  return jsonb_build_object(
    'oldPoNumber', v_old,
    'newPoNumber', v_new,
    'lrsUpdated', v_lr_count,
    'billsWithOldNumber', v_bills
  );
end;
$$;
revoke all on function public.make_purchase_order_permanent(bigint, text, date) from public, anon;
grant execute on function public.make_purchase_order_permanent(bigint, text, date) to authenticated;

-- 5. Reminders -----------------------------------------------
insert into public.notification_rules (
  rule_key, category, name, description, enabled, delivery_mode, scheduled_time, sort_order
)
values (
  'po.temporary_pending', 'PO Master', 'Permanent PO Pending',
  'Daily reminder while a Temporary PO has not been replaced with its permanent number for 3 or more days.',
  true, 'immediate', '10:00', 165
)
on conflict (rule_key) do nothing;

create or replace function public.queue_temporary_po_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_count integer := 0;
  v_enabled boolean;
  r record;
begin
  select enabled into v_enabled from public.notification_rules where rule_key = 'po.temporary_pending';
  if not coalesce(v_enabled, false) then return 0; end if;

  for r in
    select p.id, p.po_number, p.temporary_since, b.name as billing_party_name,
      (select count(*) from public.lrs l where l.purchase_order_id = p.id) as lr_count
    from public.purchase_orders p
    join public.billing_parties b on b.id = p.billing_party_id
    left join public.purchase_order_reminder_state s on s.purchase_order_id = p.id
    where p.is_temporary
      and p.status = 'Active'
      and p.temporary_since <= now() - interval '3 days'
      and (s.temporary_reminded_on is null or s.temporary_reminded_on < v_today)
  loop
    insert into public.notification_events (rule_key, title, body, href, payload)
    values (
      'po.temporary_pending',
      'Permanent PO pending: ' || r.po_number,
      r.billing_party_name || ': temporary PO ' || r.po_number || ' pending since '
        || to_char(r.temporary_since at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
        || ' (' || (v_today - (r.temporary_since at time zone 'Asia/Kolkata')::date) || ' days). '
        || r.lr_count || ' LR(s) use it. Open PO Master > Temporary and click Make Permanent.',
      '/purchase-orders?type=temporary',
      jsonb_build_object('purchaseOrderId', r.id, 'temporarySince', r.temporary_since, 'lrCount', r.lr_count)
    );
    insert into public.purchase_order_reminder_state (purchase_order_id, temporary_reminded_on)
    values (r.id, v_today)
    on conflict (purchase_order_id) do update set temporary_reminded_on = excluded.temporary_reminded_on;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.queue_temporary_po_reminders() from public, anon, authenticated;

-- 6. Daily schedule (10:00 IST) ------------------------------
select cron.schedule(
  'temporary-po-reminders-daily',
  '30 4 * * *',
  $cron$select public.queue_temporary_po_reminders();$cron$
);

commit;
