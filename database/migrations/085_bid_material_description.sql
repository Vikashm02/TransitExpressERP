-- ==========================================================
-- Migration: 085_bid_material_description
-- Module:    Bid Management — tender-verbatim material description
--            + genuinely-optional tender fields (Phase 1 refinement)
--
-- REVIEW ONLY: do NOT apply automatically. Manual review first.
-- Apply BEFORE deploying the web build that sends
-- material_description, otherwise inserts will fail on the
-- unknown column. Existing rows need no backfill.
--
-- Additive and permissive only:
-- * ADD COLUMN material_description text (nullable). No backfill,
--   no invented descriptions, nothing copied from material_name.
-- * Relax to nullable (DROP NOT NULL) every user-entered column
--   outside the five mandatory fields (billing_party_id, source,
--   status, pickup_location, dropoff_location): consignor_id,
--   consignee_id, material_id, distance_km, vehicle_type,
--   total_quantity_mt, expected_load_mt, market_vehicle_quote,
--   bid_rate, bid_rate_basis. Unknown means NULL, never a fake 0.
--   Existing rows all hold values and are unaffected. CHECK
--   constraints are NULL-tolerant by SQL semantics, so no check
--   needs rewriting (NULL passes) — audited below.
-- * posted_at keeps its NOT NULL now() default (system timestamp,
--   omitted when blank). Free-text notes/remarks/transit stay
--   empty-string convention (harmless, display-neutral).
-- * Trigger function replaced (same name) with the minimum delta:
--   null-aware master validation/snapshots, material_description
--   normalization + Won/Lost freeze, Live-closes_at rule REMOVED
--   (a Live bid may have unknown closing time). Revoke/grants
--   persist across replace.
-- Does NOT alter LR numbering, billing/ledger, reminders, RLS,
-- policies, indexes, or any other table.
-- ==========================================================

begin;

alter table public.transport_bids
  add column material_description text;

alter table public.transport_bids
  alter column consignor_id drop not null,
  alter column consignee_id drop not null,
  alter column material_id drop not null,
  alter column distance_km drop not null,
  alter column vehicle_type drop not null,
  alter column total_quantity_mt drop not null,
  alter column expected_load_mt drop not null,
  alter column market_vehicle_quote drop not null,
  alter column bid_rate drop not null,
  alter column bid_rate_basis drop not null;

create or replace function public.transport_bid_before_write()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Normalize text; blank external reference becomes NULL.
  new.bid_reference := nullif(trim(coalesce(new.bid_reference, '')), '');
  new.billing_party_name := trim(coalesce(new.billing_party_name, ''));
  new.pickup_location := trim(new.pickup_location);
  new.dropoff_location := trim(new.dropoff_location);
  new.vehicle_type := nullif(trim(coalesce(new.vehicle_type, '')), '');
  new.material_name := trim(coalesce(new.material_name, ''));
  new.material_description := nullif(trim(coalesce(new.material_description, '')), '');

  -- Billing party must be a finalized master row (mirrors 073).
  if not exists (select 1 from public.billing_parties
    where id = new.billing_party_id and coalesce(entry_status, 'final') = 'final') then
    raise exception 'Choose a finalized billing party';
  end if;

  -- Consignor / consignee must be Customer Master rows when provided
  -- (any status is deliberately allowed so historical parties stay
  -- selectable). NULL means "not specified on the tender".
  if new.consignor_id is not null
    and not exists (select 1 from public.customers where id = new.consignor_id) then
    raise exception 'Choose a consignor from Customer Master';
  end if;
  if new.consignee_id is not null
    and not exists (select 1 from public.customers where id = new.consignee_id) then
    raise exception 'Choose a consignee from Customer Master';
  end if;

  -- Material must come from Material Master when provided.
  if new.material_id is not null
    and not exists (select 1 from public.materials where id = new.material_id) then
    raise exception 'Choose a material from Material Master';
  end if;

  -- Historical snapshots: on INSERT always freeze from masters (client
  -- text is never trusted); on UPDATE refresh ONLY the snapshot whose
  -- master ID changed and preserve OLD names otherwise, so a later
  -- master rename can never silently rewrite bid history. A NULL
  -- master ID snapshots to empty text.
  if tg_op = 'INSERT'
    or new.billing_party_id is distinct from old.billing_party_id then
    select name into new.billing_party_name
    from public.billing_parties where id = new.billing_party_id;
  else
    new.billing_party_name := old.billing_party_name;
  end if;
  if tg_op = 'INSERT' or new.consignor_id is distinct from old.consignor_id then
    if new.consignor_id is null then
      new.consignor_name := '';
    else
      select name into new.consignor_name
      from public.customers where id = new.consignor_id;
    end if;
  else
    new.consignor_name := old.consignor_name;
  end if;
  if tg_op = 'INSERT' or new.consignee_id is distinct from old.consignee_id then
    if new.consignee_id is null then
      new.consignee_name := '';
    else
      select name into new.consignee_name
      from public.customers where id = new.consignee_id;
    end if;
  else
    new.consignee_name := old.consignee_name;
  end if;
  if tg_op = 'INSERT' or new.material_id is distinct from old.material_id then
    if new.material_id is null then
      new.material_name := '';
    else
      select material_name into new.material_name
      from public.materials where id = new.material_id;
    end if;
  else
    new.material_name := old.material_name;
  end if;

  -- A winning rate is meaningless without its basis.
  if new.winning_rate is not null and new.winning_rate_basis is null then
    raise exception 'Winning rate requires a rate basis (Per MT or Per Vehicle)';
  end if;

  -- closes_at stays optional in every status (a Live bid may have an
  -- unknown closing time). Reminder shortcuts simply stay unavailable
  -- while it is empty; exact custom reminder times are unaffected.
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- Won/Lost freeze for non-admins: commercial columns (including
    -- the consignor/consignee lane and the tender-verbatim material
    -- description) plus the status value itself (otherwise Won ->
    -- Live -> edit -> Won would bypass the freeze). Admins (is_admin)
    -- may still correct/reopen history; Cancelled / Not Submitted
    -- stay fully editable including reopen to Draft/Live.
    if old.status in ('Won', 'Lost') and not public.is_admin() then
      if new.status is distinct from old.status
        or new.billing_party_id is distinct from old.billing_party_id
        or new.consignor_id is distinct from old.consignor_id
        or new.consignee_id is distinct from old.consignee_id
        or new.pickup_location is distinct from old.pickup_location
        or new.dropoff_location is distinct from old.dropoff_location
        or new.distance_km is distinct from old.distance_km
        or new.material_id is distinct from old.material_id
        or new.material_description is distinct from old.material_description
        or new.vehicle_type is distinct from old.vehicle_type
        or new.total_quantity_mt is distinct from old.total_quantity_mt
        or new.expected_load_mt is distinct from old.expected_load_mt
        or new.market_vehicle_quote is distinct from old.market_vehicle_quote
        or new.bid_rate_basis is distinct from old.bid_rate_basis
        or new.bid_rate is distinct from old.bid_rate then
        raise exception 'Closed bid economics are frozen; ask an administrator to correct them';
      end if;
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

commit;
