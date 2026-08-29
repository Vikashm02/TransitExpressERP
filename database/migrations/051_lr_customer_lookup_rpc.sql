-- ==========================================================
-- Migration: 051_lr_customer_lookup_rpc
-- Module:    LR Create — restricted Customer Master lookup
--
-- Problem:
--   PartySection called getCustomers() → customers SELECT RLS requires
--   has_permission('customers', 'view'). LR creators with
--   lr:create_view and customers:none receive zero rows.
--
-- Solution:
--   Read-only SECURITY DEFINER RPC gated on LR create/edit permission.
--   Returns only the fields needed to fill Consignor / Consignee on the
--   LR form. Does NOT grant Customer Master access.
--
-- Additive ONLY:
--   - Creates public.get_lr_customer_lookup()
--   - Does NOT alter customers RLS / policies / schema
--   - Does NOT alter app_user_permissions
--   - Does NOT modify migrations 049 / 050
--
-- NOT executed automatically — review, then apply manually in Supabase.
-- ==========================================================

create or replace function public.get_lr_customer_lookup()
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

  -- Same create/edit gate used by allocate_next_lr_number (migration 036):
  -- LR form needs lookup for Create and for Edit of party fields.
  -- Does NOT require has_permission('customers', 'view').
  if not (
    public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')
  ) then
    raise exception 'Not permitted to look up customers for LR entry';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'code', c.code,
        'gst', c.gst,
        'city', c.city,
        'address', c.address,
        'entry_status', coalesce(c.entry_status, 'final')
      )
      order by c.name asc, c.id asc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.customers c
  where coalesce(c.entry_status, 'final') = 'final';

  return v_rows;
end;
$$;

revoke all on function public.get_lr_customer_lookup() from public;
grant execute on function public.get_lr_customer_lookup() to authenticated;

comment on function public.get_lr_customer_lookup() is
  'LR Create/Edit: read-only finalized Customer Master rows (id,name,code,gst,city,address,entry_status). Requires lr create_view or edit. Does not change customers RLS.';
