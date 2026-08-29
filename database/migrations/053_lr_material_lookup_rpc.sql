-- ==========================================================
-- Migration: 053_lr_material_lookup_rpc
-- Module:    LR Create — restricted Material Master lookup
--
-- Problem:
--   MaterialSection / MaterialLookup called getMaterials() → materials
--   SELECT RLS requires has_permission('material', 'view'). LR creators
--   with lr:create_view and material:none receive zero rows.
--
-- Solution:
--   Read-only SECURITY DEFINER RPC gated on LR create/edit permission.
--   Returns only the fields needed by LR Material UI / MaterialLookup.
--   Does NOT grant Material Master access.
--
-- Status behavior:
--   Existing MaterialLookup does NOT filter Inactive; material matching
--   filters Active client-side. This RPC returns all statuses so that
--   behavior is preserved (no new status rule).
--
-- Additive ONLY:
--   - Creates public.get_lr_material_lookup()
--   - Does NOT alter materials RLS / policies / schema
--   - Does NOT alter app_user_permissions
--   - Does NOT modify migrations 051 / 052
--
-- NOT executed automatically — review, then apply manually in Supabase.
-- ==========================================================

create or replace function public.get_lr_material_lookup()
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

  -- Same create/edit gate as get_lr_customer_lookup / get_lr_billing_party_lookup.
  -- Does NOT require has_permission('material', 'view').
  if not (
    public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')
  ) then
    raise exception 'Not permitted to look up materials for LR entry';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'material_code', m.material_code,
        'material_name', m.material_name,
        'category', coalesce(m.category, ''),
        'unit', coalesce(m.unit, ''),
        'description', coalesce(m.description, ''),
        'status', m.status
      )
      order by m.material_name asc, m.id asc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.materials m;

  return v_rows;
end;
$$;

revoke all on function public.get_lr_material_lookup() from public;
grant execute on function public.get_lr_material_lookup() to authenticated;

comment on function public.get_lr_material_lookup() is
  'LR Create/Edit: read-only Material Master rows (id,material_code,material_name,category,unit,description,status). Requires lr create_view or edit. Does not change materials RLS.';
