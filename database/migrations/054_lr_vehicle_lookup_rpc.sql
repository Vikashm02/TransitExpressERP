-- ==========================================================
-- Migration: 054_lr_vehicle_lookup_rpc
-- Module:    LR Create — restricted Vehicle Master lookup
--
-- Problem:
--   VehicleSection / VehicleLookup called getVehicles() → vehicles
--   SELECT RLS requires has_permission('vehicle', 'view'). LR creators
--   with lr:create_view and vehicle:none receive zero rows.
--
-- Solution:
--   Read-only SECURITY DEFINER RPC gated on LR create/edit permission.
--   Returns only the fields needed by LR Vehicle UI / VehicleLookup
--   autofill and search. Does NOT grant Vehicle Master access.
--
-- Behavior preserved:
--   No Active/Inactive filter (none exists in LR Vehicle UI today).
--   No company/branch filter (none exists today).
--
-- Additive ONLY:
--   - Creates public.get_lr_vehicle_lookup()
--   - Does NOT alter vehicles RLS / policies / schema
--   - Does NOT alter app_user_permissions
--   - Does NOT modify migrations 051 / 052 / 053
--
-- NOT executed automatically — review, then apply manually in Supabase.
-- ==========================================================

create or replace function public.get_lr_vehicle_lookup()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Same create/edit gate as other LR restricted lookups.
  -- Does NOT require has_permission('vehicle', 'view').
  if not (
    public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')
  ) then
    raise exception 'Not permitted to look up vehicles for LR entry';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'vehicle_number', v.vehicle_number,
        'vehicle_type', v.vehicle_type,
        'transporter', coalesce(v.transporter, ''),
        'driver_name', coalesce(v.driver_name, ''),
        'driver_mobile', coalesce(v.driver_mobile, ''),
        'hire_rate', coalesce(v.hire_rate, 0),
        'hire_type', coalesce(v.hire_type, 'Fixed'),
        'owner_name', v.owner_name,
        'owner_type', v.owner_type,
        'mobile', v.mobile
      )
      order by v.vehicle_number asc, v.id asc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.vehicles v;

  return v_rows;
end;
$$;

revoke all on function public.get_lr_vehicle_lookup() from public;
grant execute on function public.get_lr_vehicle_lookup() to authenticated;

comment on function public.get_lr_vehicle_lookup() is
  'LR Create/Edit: read-only Vehicle Master rows for LR autofill/search. Requires lr create_view or edit. Does not change vehicles RLS.';
