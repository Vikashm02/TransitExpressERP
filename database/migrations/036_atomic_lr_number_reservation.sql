-- ==========================================================
-- Migration: 036_atomic_lr_number_reservation
-- Module:    LR numbering — reserve real numbers for drafts
--
-- Replaces client-side "current + 1" / temporary DRAFT-* numbers with
-- an atomic reservation against company_settings.lr_running_number.
--
-- Behavior:
--   - Opening the create form does NOT consume a number.
--   - First draft persist (or final create) calls allocate_next_lr_number().
--   - Subsequent autosaves / final Save keep the reserved number.
--   - Concurrent callers are serialized via SELECT … FOR UPDATE.
--
-- Also converts any existing entry_status = 'draft' rows that still
-- use temporary DRAFT-% lr_number values to reserved real numbers.
--
-- Additive only. Does NOT modify migrations 033–035.
-- NOT executed automatically — run manually against Supabase.
-- ==========================================================

create or replace function public.allocate_next_lr_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_prefix text;
  v_length integer;
  v_next integer;
  v_number text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Create OR Edit may allocate (draft reservation or direct final create).
  if not (
    public.has_permission('lr', 'create_view')
    or public.has_permission('lr', 'edit')
  ) then
    raise exception 'Not permitted to allocate LR numbers';
  end if;

  select id, coalesce(lr_prefix, ''), coalesce(lr_prefix_length, 4), coalesce(lr_running_number, 0)
    into v_id, v_prefix, v_length, v_next
  from public.company_settings
  order by id
  limit 1
  for update;

  if v_id is null then
    raise exception 'Company settings are not configured';
  end if;

  v_next := v_next + 1;
  if v_length < length(v_next::text) then
    v_length := length(v_next::text);
  end if;

  v_number := v_prefix || lpad(v_next::text, v_length, '0');

  update public.company_settings
  set lr_running_number = v_next
  where id = v_id;

  return v_number;
end;
$$;

grant execute on function public.allocate_next_lr_number() to authenticated;

-- Convert legacy temporary draft numbers (DRAFT-*) to reserved real numbers.
-- Safe to re-run: only matches remaining DRAFT-% draft rows.
do $$
declare
  r record;
  v_id bigint;
  v_prefix text;
  v_length integer;
  v_next integer;
  v_number text;
begin
  for r in
    select id
    from public.lrs
    where coalesce(entry_status, 'final') = 'draft'
      and lr_number like 'DRAFT-%'
    order by id
  loop
    select id, coalesce(lr_prefix, ''), coalesce(lr_prefix_length, 4), coalesce(lr_running_number, 0)
      into v_id, v_prefix, v_length, v_next
    from public.company_settings
    order by id
    limit 1
    for update;

    if v_id is null then
      raise exception 'Company settings are not configured; cannot convert DRAFT LR numbers';
    end if;

    v_next := v_next + 1;
    if v_length < length(v_next::text) then
      v_length := length(v_next::text);
    end if;
    v_number := v_prefix || lpad(v_next::text, v_length, '0');

    update public.company_settings
    set lr_running_number = v_next
    where id = v_id;

    update public.lrs
    set lr_number = v_number
    where id = r.id;
  end loop;
end;
$$;
