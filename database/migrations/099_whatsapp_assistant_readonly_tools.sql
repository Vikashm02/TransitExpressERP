-- ==========================================================
-- Migration: 099_whatsapp_assistant_readonly_tools
-- Module: WhatsApp Operations Assistant — allowlisted LR/POD read tools
--
-- Service-role-only RPCs for a future trusted WhatsApp assistant. They accept
-- a mapped ERP user ID, independently enforce that user's WhatsApp and ERP
-- access, and return only a fixed operational field allowlist.
--
-- No arbitrary SQL, writes, financial data, document URLs, or message text.
-- This migration is NOT applied automatically.
-- ==========================================================

begin;

-- Mirrors the effective ERP module-view rules for an explicit mapped user.
-- WhatsApp remains stricter than normal ERP Creator/Admin behavior by always
-- requiring approved and unlocked status before the role/full-access bypass.
create or replace function public.whatsapp_assistant_has_permission(
  p_app_user_id uuid,
  p_permission_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_approval text;
  v_locked boolean;
  v_full_access boolean;
  v_can_view boolean;
  v_can_create boolean;
  v_can_edit boolean;
  v_level text;
begin
  if p_app_user_id is null or p_permission_key not in ('lr', 'pod') then
    return false;
  end if;

  select u.role, u.approval_status, u.is_locked, u.full_access
    into v_role, v_approval, v_locked, v_full_access
  from public.app_users u
  where u.id = p_app_user_id;

  if not found
    or coalesce(v_approval, 'pending') <> 'approved'
    or coalesce(v_locked, false)
    or not exists (
      select 1
      from public.whatsapp_user_links w
      where w.app_user_id = p_app_user_id
        and w.is_active
    )
    or exists (
      select 1
      from public.whatsapp_assistant_access_exclusions e
      where e.app_user_id = p_app_user_id
        and e.is_active
    ) then
    return false;
  end if;

  if v_role in ('creator', 'admin') or coalesce(v_full_access, false) then
    return true;
  end if;

  select p.can_view, p.can_create, p.can_edit, p.permission_level
    into v_can_view, v_can_create, v_can_edit, v_level
  from public.app_user_permissions p
  where p.user_id = p_app_user_id
    and p.permission_key = p_permission_key;

  if not found then
    return false;
  end if;

  if coalesce(v_can_view, false)
    or coalesce(v_can_create, false)
    or coalesce(v_can_edit, false) then
    return coalesce(v_can_view, false)
      or coalesce(v_can_create, false)
      or coalesce(v_can_edit, false);
  end if;

  return coalesce(v_level, 'none') in ('view', 'create_view', 'edit');
end;
$$;

revoke all on function public.whatsapp_assistant_has_permission(uuid, text)
  from public, anon, authenticated;
grant execute on function public.whatsapp_assistant_has_permission(uuid, text)
  to service_role;

create or replace function public.whatsapp_search_lrs(
  p_app_user_id uuid,
  p_lr_date_from date default null,
  p_lr_date_to date default null,
  p_created_at_from timestamptz default null,
  p_created_at_to timestamptz default null,
  p_lr_number text default null,
  p_consignor text default null,
  p_consignee text default null,
  p_party_search text default null,
  p_vehicle_number text default null,
  p_material text default null,
  p_status text default null,
  p_count_only boolean default false,
  p_limit integer default 20,
  p_offset bigint default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 20));
  v_offset bigint := greatest(0::bigint, least(coalesce(p_offset, 0), 1000000::bigint));
begin
  if not public.whatsapp_assistant_has_permission(p_app_user_id, 'lr') then
    raise exception 'Not permitted';
  end if;
  if p_lr_date_from is not null and p_lr_date_to is not null and p_lr_date_from > p_lr_date_to then
    raise exception 'Invalid LR date range';
  end if;
  if p_created_at_from is not null and p_created_at_to is not null and p_created_at_from >= p_created_at_to then
    raise exception 'Invalid creation timestamp range';
  end if;
  if p_status is not null and p_status not in ('Open', 'In Transit', 'Delivered', 'Billed', 'Cancelled') then
    raise exception 'Invalid LR status';
  end if;

  return (
    with filtered as (
      select
        l.id,
        l.lr_number,
        l.lr_date,
        l.consignor,
        l.consignee,
        l.vehicle_number,
        l.vehicle_type,
        l.transporter,
        l.from_station,
        l.to_station,
        l.material,
        l.material_description,
        l.package_type,
        l.packages,
        l.loading_weight,
        l.unloading_weight,
        l.status,
        exists (select 1 from public.pods p where p.lr_number = l.lr_number) as pod_present
      from public.lrs l
      where coalesce(l.entry_status, 'final') = 'final'
        and (p_status is not null or l.status is distinct from 'Cancelled')
        and (p_status is null or l.status = p_status)
        and (p_lr_date_from is null or l.lr_date >= p_lr_date_from)
        and (p_lr_date_to is null or l.lr_date <= p_lr_date_to)
        and (p_created_at_from is null or l.created_at >= p_created_at_from)
        and (p_created_at_to is null or l.created_at < p_created_at_to)
        and (nullif(trim(p_lr_number), '') is null or upper(trim(l.lr_number)) = upper(trim(p_lr_number)))
        and (nullif(trim(p_consignor), '') is null or upper(trim(l.consignor)) = upper(trim(p_consignor)))
        and (nullif(trim(p_consignee), '') is null or upper(trim(l.consignee)) = upper(trim(p_consignee)))
        and (nullif(trim(p_party_search), '') is null or l.consignor ilike '%' || trim(p_party_search) || '%' or l.consignee ilike '%' || trim(p_party_search) || '%')
        and (nullif(trim(p_vehicle_number), '') is null or upper(trim(l.vehicle_number)) = upper(trim(p_vehicle_number)))
        and (nullif(trim(p_material), '') is null or l.material ilike '%' || trim(p_material) || '%')
    ),
    paged as (
      select
        id, lr_number, lr_date, consignor, consignee, vehicle_number,
        vehicle_type, transporter, from_station, to_station, material,
        material_description, package_type, packages, loading_weight,
        unloading_weight, status, pod_present
      from filtered
      where not coalesce(p_count_only, false)
      order by lr_date desc, lr_number desc, id desc
      limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'total_count', (select count(*) from filtered),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'lr_id', id::text,
          'lr_number', lr_number,
          'lr_date', lr_date,
          'consignor', consignor,
          'consignee', consignee,
          'vehicle_number', vehicle_number,
          'vehicle_type', vehicle_type,
          'transporter', transporter,
          'from_station', from_station,
          'to_station', to_station,
          'material', material,
          'material_description', material_description,
          'package_type', package_type,
          'packages', packages,
          'loading_weight', loading_weight,
          'unloading_weight', unloading_weight,
          'status', status,
          'pod_present', pod_present,
          'pod_state', case when pod_present then 'present' else 'pending' end
        )) from paged
      ), '[]'::jsonb),
      'pagination', jsonb_build_object(
        'count_only', coalesce(p_count_only, false),
        'limit', v_limit,
        'offset', v_offset,
        'returned_count', (select count(*) from paged),
        'has_more', (select count(*) from filtered) > v_offset + v_limit
      )
    )
  );
end;
$$;

create or replace function public.whatsapp_get_lr_detail(
  p_app_user_id uuid,
  p_lr_number text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if not public.whatsapp_assistant_has_permission(p_app_user_id, 'lr') then
    raise exception 'Not permitted';
  end if;
  if nullif(trim(p_lr_number), '') is null then
    raise exception 'LR number is required';
  end if;

  select jsonb_build_object(
    'found', true,
    'lr', jsonb_build_object(
      'lr_id', l.id::text,
      'lr_number', l.lr_number,
      'lr_date', l.lr_date,
      'consignor', l.consignor,
      'consignee', l.consignee,
      'vehicle_number', l.vehicle_number,
      'vehicle_type', l.vehicle_type,
      'transporter', l.transporter,
      'from_station', l.from_station,
      'to_station', l.to_station,
      'material', l.material,
      'material_description', l.material_description,
      'package_type', l.package_type,
      'packages', l.packages,
      'loading_weight', l.loading_weight,
      'unloading_weight', l.unloading_weight,
      'status', l.status,
      'pod_present', exists (select 1 from public.pods p where p.lr_number = l.lr_number),
      'pod_state', case when exists (select 1 from public.pods p where p.lr_number = l.lr_number) then 'present' else 'pending' end
    )
  ) into v_result
  from public.lrs l
  where coalesce(l.entry_status, 'final') = 'final'
    and upper(trim(l.lr_number)) = upper(trim(p_lr_number));

  return coalesce(v_result, jsonb_build_object('found', false));
end;
$$;

create or replace function public.whatsapp_search_pending_pods(
  p_app_user_id uuid,
  p_min_pending_days integer default 0,
  p_lr_date_from date default null,
  p_lr_date_to date default null,
  p_created_at_from timestamptz default null,
  p_created_at_to timestamptz default null,
  p_consignor text default null,
  p_consignee text default null,
  p_vehicle_number text default null,
  p_count_only boolean default false,
  p_limit integer default 20,
  p_offset bigint default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 20));
  v_offset bigint := greatest(0::bigint, least(coalesce(p_offset, 0), 1000000::bigint));
  v_min_pending_days integer := greatest(0, least(coalesce(p_min_pending_days, 0), 36500));
begin
  if not public.whatsapp_assistant_has_permission(p_app_user_id, 'lr')
    or not public.whatsapp_assistant_has_permission(p_app_user_id, 'pod') then
    raise exception 'Not permitted';
  end if;
  if p_lr_date_from is not null and p_lr_date_to is not null and p_lr_date_from > p_lr_date_to then
    raise exception 'Invalid LR date range';
  end if;
  if p_created_at_from is not null and p_created_at_to is not null and p_created_at_from >= p_created_at_to then
    raise exception 'Invalid creation timestamp range';
  end if;

  return (
    with filtered as (
      select
        l.id,
        l.lr_number,
        l.lr_date,
        l.consignor,
        l.consignee,
        l.vehicle_number,
        l.vehicle_type,
        l.transporter,
        l.from_station,
        l.to_station,
        l.material,
        l.material_description,
        l.package_type,
        l.packages,
        l.loading_weight,
        l.status,
        public._overview_age_days(l.created_at) as pending_days
      from public.lrs l
      where coalesce(l.entry_status, 'final') = 'final'
        and l.status is distinct from 'Cancelled'
        and not exists (select 1 from public.pods p where p.lr_number = l.lr_number)
        and public._overview_age_days(l.created_at) >= v_min_pending_days
        and (p_lr_date_from is null or l.lr_date >= p_lr_date_from)
        and (p_lr_date_to is null or l.lr_date <= p_lr_date_to)
        and (p_created_at_from is null or l.created_at >= p_created_at_from)
        and (p_created_at_to is null or l.created_at < p_created_at_to)
        and (nullif(trim(p_consignor), '') is null or upper(trim(l.consignor)) = upper(trim(p_consignor)))
        and (nullif(trim(p_consignee), '') is null or upper(trim(l.consignee)) = upper(trim(p_consignee)))
        and (nullif(trim(p_vehicle_number), '') is null or upper(trim(l.vehicle_number)) = upper(trim(p_vehicle_number)))
    ),
    paged as (
      select
        id, lr_number, lr_date, consignor, consignee, vehicle_number,
        vehicle_type, transporter, from_station, to_station, material,
        material_description, package_type, packages, loading_weight,
        status, pending_days
      from filtered
      where not coalesce(p_count_only, false)
      order by pending_days desc, lr_date asc, lr_number asc, id asc
      limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'total_count', (select count(*) from filtered),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'lr_id', id::text,
          'lr_number', lr_number,
          'lr_date', lr_date,
          'consignor', consignor,
          'consignee', consignee,
          'vehicle_number', vehicle_number,
          'vehicle_type', vehicle_type,
          'transporter', transporter,
          'from_station', from_station,
          'to_station', to_station,
          'material', material,
          'material_description', material_description,
          'package_type', package_type,
          'packages', packages,
          'loading_weight', loading_weight,
          'status', status,
          'pod_present', false,
          'pod_state', 'pending',
          'pending_days', pending_days
        )) from paged
      ), '[]'::jsonb),
      'pagination', jsonb_build_object(
        'count_only', coalesce(p_count_only, false),
        'limit', v_limit,
        'offset', v_offset,
        'returned_count', (select count(*) from paged),
        'has_more', (select count(*) from filtered) > v_offset + v_limit
      )
    )
  );
end;
$$;

create or replace function public.whatsapp_get_pod_detail(
  p_app_user_id uuid,
  p_lr_number text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if not public.whatsapp_assistant_has_permission(p_app_user_id, 'lr')
    or not public.whatsapp_assistant_has_permission(p_app_user_id, 'pod') then
    raise exception 'Not permitted';
  end if;
  if nullif(trim(p_lr_number), '') is null then
    raise exception 'LR number is required';
  end if;

  select jsonb_build_object(
    'found', true,
    'lr', jsonb_build_object(
      'lr_id', l.id::text,
      'lr_number', l.lr_number,
      'lr_date', l.lr_date,
      'consignor', l.consignor,
      'consignee', l.consignee,
      'vehicle_number', l.vehicle_number,
      'vehicle_type', l.vehicle_type,
      'transporter', l.transporter,
      'from_station', l.from_station,
      'to_station', l.to_station,
      'material', l.material,
      'material_description', l.material_description,
      'package_type', l.package_type,
      'packages', l.packages,
      'loading_weight', l.loading_weight,
      'status', l.status
    ),
    'pod', case when p.id is null then null else jsonb_build_object(
      'pod_date', p.pod_date,
      'unloading_date', p.unloading_date,
      'unloading_weight', p.unloading_weight,
      'proof_present', coalesce(nullif(trim(p.proof_url), ''), '') <> ''
    ) end,
    'pod_present', p.id is not null
  ) into v_result
  from public.lrs l
  left join public.pods p on p.lr_number = l.lr_number
  where coalesce(l.entry_status, 'final') = 'final'
    and upper(trim(l.lr_number)) = upper(trim(p_lr_number));

  return coalesce(v_result, jsonb_build_object('found', false));
end;
$$;

revoke all on function public.whatsapp_search_lrs(uuid, date, date, timestamptz, timestamptz, text, text, text, text, text, text, text, boolean, integer, bigint)
  from public, anon, authenticated;
revoke all on function public.whatsapp_get_lr_detail(uuid, text)
  from public, anon, authenticated;
revoke all on function public.whatsapp_search_pending_pods(uuid, integer, date, date, timestamptz, timestamptz, text, text, text, boolean, integer, bigint)
  from public, anon, authenticated;
revoke all on function public.whatsapp_get_pod_detail(uuid, text)
  from public, anon, authenticated;

grant execute on function public.whatsapp_search_lrs(uuid, date, date, timestamptz, timestamptz, text, text, text, text, text, text, text, boolean, integer, bigint)
  to service_role;
grant execute on function public.whatsapp_get_lr_detail(uuid, text)
  to service_role;
grant execute on function public.whatsapp_search_pending_pods(uuid, integer, date, date, timestamptz, timestamptz, text, text, text, boolean, integer, bigint)
  to service_role;
grant execute on function public.whatsapp_get_pod_detail(uuid, text)
  to service_role;

comment on function public.whatsapp_search_lrs(uuid, date, date, timestamptz, timestamptz, text, text, text, text, text, text, text, boolean, integer, bigint) is
  'WhatsApp allowlisted operational LR count/list. Final only; normal searches omit Cancelled unless p_status is Cancelled; max 20 detail rows.';
comment on function public.whatsapp_search_pending_pods(uuid, integer, date, date, timestamptz, timestamptz, text, text, text, boolean, integer, bigint) is
  'WhatsApp allowlisted pending-POD count/list. Pending means final non-Cancelled LR without a POD; age is Asia/Kolkata calendar days from lrs.created_at.';

commit;
