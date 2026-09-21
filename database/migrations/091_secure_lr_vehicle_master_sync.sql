-- ==========================================================
-- Migration: 091_secure_lr_vehicle_master_sync
-- Module:    LR Create/Edit → Vehicle Master automatic sync
--
-- Problem:
--   syncVehicleMasterFromLr() writes public.vehicles directly.
--   Since migration 047, vehicles UPDATE RLS requires
--   has_permission('vehicle', 'edit'), so staff with valid LR
--   Create/Edit permission but without vehicle:edit get their
--   automatic LR → Vehicle Master sync rejected (LR itself saves).
--
-- Fix:
--   Controlled SECURITY DEFINER RPC sync_vehicle_from_lr(p_lr_id)
--   that performs the sync server-side after verifying the caller
--   is legitimately creating/editing that LR. Accepts ONLY the LR
--   id; every sync value is derived from the stored LR row.
--
-- Authorization (all must pass):
--   1) auth.uid() exists.
--   2) Target LR exists.
--   3) Target LR entry_status = 'final' (sync runs on finalize only).
--   4) has_permission('lr','create_view') OR has_permission('lr','edit')
--      (mirrors 054 get_lr_vehicle_lookup; no vehicle:* needed/granted).
--   5) Staff 48-hour window on ORIGINAL lrs.created_at
--      (Change 1 rule; Creator/Admin bypass only this window).
--   6) Callers WITHOUT lr:edit may sync only their own finalized LR
--      (v_lr.created_by = auth.uid(), fail-closed; lrs_enforce_ownership
--      makes created_by the first finalizer and client-proof).
--
-- Behavior preserved from syncVehicleMasterFromLr():
--   - Same normalized/canonical vehicle-number handling.
--   - Same 4 LR-managed columns on update (blank type keeps existing).
--   - Same minimal Active insert payload when absent.
--   - Same concurrent-create race handling (re-read then update).
--
-- Additive ONLY:
--   - Creates public.sync_vehicle_from_lr(uuid).
--   - Does NOT alter vehicles RLS / policies / schema.
--   - Does NOT alter lrs RLS, 48-hour rule, or LR permissions.
--   - Does NOT grant vehicle:edit to anyone.
--
-- NOT executed automatically — run manually against Supabase.
-- ==========================================================

create or replace function public.sync_vehicle_from_lr(p_lr_id uuid)
returns public.vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lr public.lrs%rowtype;
  v_raw_number text;
  v_number text;
  v_key text;
  v_type text;
  v_transporter text;
  v_driver_name text;
  v_driver_mobile text;
  v_vehicle public.vehicles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Legitimate LR participation (mirrors 054 get_lr_vehicle_lookup).
  -- No vehicle:* permission required and none granted.
  if not (
    public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')
  ) then
    raise exception 'Not permitted to sync Vehicle Master for this LR';
  end if;

  if p_lr_id is null then
    raise exception 'LR id is required';
  end if;

  select * into v_lr
  from public.lrs
  where id = p_lr_id;

  if not found then
    raise exception 'LR not found';
  end if;

  -- Sync runs on LR finalize flows only, never draft autosave.
  if coalesce(v_lr.entry_status, 'final') is distinct from 'final' then
    raise exception 'Only finalized LRs can sync Vehicle Master';
  end if;

  -- Staff 48-hour restriction on ORIGINAL lrs.created_at (Change 1 rule).
  -- Never finalized_at, updated_at, LR date, or document date.
  -- Creator/Admin bypass only this window.
  if not public.is_admin() then
    if v_lr.created_at is null
      or now() >= v_lr.created_at + interval '48 hours'
    then
      raise exception 'LR edit window has expired (48 hours from creation)';
    end if;
  end if;

  -- create_view-only callers: only their own finalized LR.
  -- lrs_enforce_ownership() makes created_by the first finalizer and
  -- ignores client-supplied values, so this is spoof-proof.
  -- lr:edit holders need no attribution. Legacy blank created_by fails closed.
  if not public.has_permission('lr', 'edit')
     and v_lr.created_by is distinct from auth.uid() then
    raise exception 'Not permitted to sync Vehicle Master for this LR';
  end if;

  -- Derive everything from the stored LR row (never client parameters).
  v_raw_number := btrim(coalesce(v_lr.vehicle_number, ''));
  if v_raw_number = '' then
    raise exception 'Vehicle number is required to sync Vehicle Master.';
  end if;

  -- Normalized match key (mirrors normalizeVehicleNumberKey:
  -- uppercase alphanumeric only).
  v_key := regexp_replace(upper(v_raw_number), '[^A-Z0-9]', '', 'g');

  -- Canonical display number (mirrors canonicalizeVehicleNumber:
  -- XX-00XX-0000 → XX-00XX-0000 hyphenated, else upper/hyphens collapsed).
  if v_key ~ '^[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}$' then
    v_number :=
      substr(v_key, 1, 2) || '-'
      || substr(v_key, 3, 2) || substr(v_key, 5, 2) || '-'
      || substr(v_key, 7, 4);
  else
    v_number := regexp_replace(
      regexp_replace(upper(v_raw_number), '-+', '-', 'g'),
      '^-|-$', '', 'g'
    );
  end if;

  v_type := nullif(btrim(coalesce(v_lr.vehicle_type, '')), '');
  v_transporter := btrim(coalesce(v_lr.transporter, ''));
  v_driver_name := btrim(coalesce(v_lr.driver_name, ''));
  v_driver_mobile := btrim(coalesce(v_lr.driver_mobile, ''));

  -- Serialize concurrent syncs for this normalized vehicle identity.
  -- Transaction-scoped (pg_advisory_xact_lock): PostgreSQL releases it
  -- automatically at COMMIT/ROLLBACK. Derived from NORMALIZED v_key, so
  -- formatting-equivalent numbers (e.g. KA56AB1234 vs KA-56AB-1234)
  -- contend on the same lock while different vehicles proceed
  -- independently. Acquired BEFORE the normalized lookup below, so a
  -- waiting transaction sees the first transaction's committed insert
  -- instead of inserting a normalized-equivalent duplicate.
  -- No normalized UNIQUE index is added: existing duplicates are left
  -- untouched (never deleted/merged/renamed by this migration).
  perform pg_advisory_xact_lock(hashtext(v_key));

  -- Deterministic normalized match (mirrors findVehicleByNumber over
  -- getVehicles() created_at DESC order).
  select * into v_vehicle
  from public.vehicles
  where regexp_replace(upper(vehicle_number), '[^A-Z0-9]', '', 'g') = v_key
  order by created_at desc, id desc
  limit 1
  for update;

  if v_vehicle.id is not null then
    -- LR-managed Vehicle Master current fields ONLY.
    -- Blank type keeps existing (mirrors syncVehicleMasterFromLr).
    -- Never touches owner_name / compliance / hire / status.
    update public.vehicles
    set vehicle_type = coalesce(v_type, vehicle_type),
        transporter = v_transporter,
        driver_name = v_driver_name,
        driver_mobile = v_driver_mobile
    where id = v_vehicle.id
    returning * into v_vehicle;

    return v_vehicle;
  end if;

  -- Vehicle absent: minimal Active row (mirrors syncVehicleMasterFromLr
  -- insert payload, including the 'Truck' type default).
  begin
    insert into public.vehicles (
      vehicle_number, rc_number, vehicle_type, owner_name, owner_type, mobile,
      transporter, driver_name, driver_mobile,
      capacity, capacity_unit, hire_rate, hire_type,
      chassis_number, engine_number,
      insurance_number, insurance_expiry,
      permit_number, permit_expiry,
      fitness_number, fitness_expiry,
      puc_number, puc_expiry,
      remarks, status
    ) values (
      v_number, '', coalesce(v_type, 'Truck'), '', 'Market', '',
      v_transporter, v_driver_name, v_driver_mobile,
      0, 'TON', 0, 'Fixed',
      '', '',
      '', null,
      '', null,
      '', null,
      '', null,
      '', 'Active'
    )
    returning * into v_vehicle;

    return v_vehicle;
  exception when unique_violation then
    -- Concurrent create won the race (mirrors syncVehicleMasterFromLr
    -- retry): re-read by normalized key, then update.
    select * into v_vehicle
    from public.vehicles
    where regexp_replace(upper(vehicle_number), '[^A-Z0-9]', '', 'g') = v_key
    order by created_at desc, id desc
    limit 1
    for update;

    if v_vehicle.id is null then
      raise exception 'Vehicle Master sync conflict, please retry.';
    end if;

    update public.vehicles
    set vehicle_type = coalesce(v_type, vehicle_type),
        transporter = v_transporter,
        driver_name = v_driver_name,
        driver_mobile = v_driver_mobile
    where id = v_vehicle.id
    returning * into v_vehicle;

    return v_vehicle;
  end;
end;
$$;

revoke all on function public.sync_vehicle_from_lr(uuid) from public;
revoke all on function public.sync_vehicle_from_lr(uuid) from anon;
grant execute on function public.sync_vehicle_from_lr(uuid) to authenticated;

comment on function public.sync_vehicle_from_lr(uuid) is
  'LR-driven Vehicle Master sync (Change 1 follow-up). Requires lr create_view|edit for a finalized LR within 48h (admin bypasses window only); create_view-only callers limited to their own finalized LR. Syncs only LR-managed current fields; does not grant vehicle:edit and does not change vehicles RLS.';
