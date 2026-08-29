-- ==========================================================
-- Migration: 052_lr_billing_party_lookup_rpc
-- Module:    LR Create/Edit — restricted Billing Party lookup
--
-- Problem:
--   LRHeader calls getBillingParties() → billing_parties SELECT RLS
--   requires has_permission('billing_parties', 'view'). LR creators with
--   lr:create_view and billing_parties:none receive zero rows.
--
-- Solution:
--   Read-only SECURITY DEFINER RPC gated on LR create/edit permission.
--   Returns only fields needed by the LR Billing Party autocomplete.
--   Does NOT grant Billing Party Master access.
--
-- Mirrors migration 051 (get_lr_customer_lookup).
--
-- Additive ONLY:
--   - Creates public.get_lr_billing_party_lookup()
--   - Does NOT alter billing_parties RLS / policies / schema
--   - Does NOT alter app_user_permissions
--   - Does NOT modify migrations 049 / 050 / 051
--
-- NOT executed automatically — review, then apply manually in Supabase.
-- ==========================================================

create or replace function public.get_lr_billing_party_lookup()
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

  -- Same create/edit gate as get_lr_customer_lookup / allocate_next_lr_number.
  -- Does NOT require has_permission('billing_parties', 'view').
  if not (
    public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')
  ) then
    raise exception 'Not permitted to look up billing parties for LR entry';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'code', b.code,
        'gst', b.gst,
        'city', b.city,
        'entry_status', coalesce(b.entry_status, 'final')
      )
      order by b.name asc, b.id asc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.billing_parties b
  where coalesce(b.entry_status, 'final') = 'final';

  return v_rows;
end;
$$;

revoke all on function public.get_lr_billing_party_lookup() from public;
grant execute on function public.get_lr_billing_party_lookup() to authenticated;

comment on function public.get_lr_billing_party_lookup() is
  'LR Create/Edit: read-only finalized Billing Party rows (id,name,code,gst,city,entry_status). Requires lr create_view or edit. Does not change billing_parties RLS.';
