-- Creator-managed internal WhatsApp Assistant access. LOCAL SOURCE ONLY.
--
-- This adds a fixed, Creator-only management surface for the existing private
-- WhatsApp-to-ERP mappings. It performs no migration-time data work and does
-- not alter tables, policies, existing assistant RPCs, or external mappings.
-- Runtime changes are limited to disabling an active internal link or adding
-- a new historical link version through the fixed functions below.

begin;
set local lock_timeout = '5s';

-- Private helper. The actor is always derived from auth.uid(), never supplied
-- by a caller. Creator status is deliberately stricter than the normal
-- Creator-or-admin operational hierarchy.
create function public.whatsapp_internal_access_require_creator()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1
    from public.app_users u
    where u.id = v_actor
      and u.role = 'creator'
      and u.approval_status = 'approved'
      and coalesce(u.is_locked, false) = false
  ) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

-- Private helper. Only India mobile numbers are accepted. Cosmetic spacing,
-- parentheses and hyphens are tolerated, but the persisted form is exact.
create function public.whatsapp_internal_access_normalize_phone(p_phone_input text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_input text := btrim(p_phone_input);
  v_digits text;
  v_national text;
begin
  if p_phone_input is null
    or char_length(v_input) not between 10 and 32
    or v_input !~ '^\+?[0-9 ()-]+$' then
    raise exception 'Invalid Indian mobile number' using errcode = '22023';
  end if;

  v_digits := regexp_replace(v_input, '[^0-9]', '', 'g');
  if v_digits ~ '^[6-9][0-9]{9}$' then
    v_national := v_digits;
  elsif v_digits ~ '^91[6-9][0-9]{9}$' then
    v_national := substring(v_digits from 3);
  else
    raise exception 'Invalid Indian mobile number' using errcode = '22023';
  end if;

  return '+91' || v_national;
end;
$$;

-- The opaque target ID is returned only because a later fixed mutation must
-- name its staff/admin target. No audit, exclusion, provider, or reservation
-- identity is exposed to the browser.
create function public.whatsapp_internal_access_list()
returns table(
  target_user_id uuid,
  display_name text,
  email text,
  role text,
  approval_status text,
  is_locked boolean,
  whatsapp_phone_e164 text,
  effective_access_status text,
  effective_lr_access boolean,
  effective_pod_access boolean,
  mapping_updated_at timestamptz,
  mapping_updated_by_display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.whatsapp_internal_access_require_creator();

  return query
  select
    u.id,
    u.display_name,
    u.email,
    u.role,
    u.approval_status,
    coalesce(u.is_locked, false),
    active_link.whatsapp_phone_e164,
    case
      when exclusion.app_user_id is not null then 'security_override_denied'
      when coalesce(u.approval_status, 'pending') <> 'approved'
        or coalesce(u.is_locked, false) then 'account_ineligible'
      when active_link.id is null and history.app_user_id is null then 'not_configured'
      when active_link.id is null then 'disabled'
      when not public.whatsapp_assistant_has_permission(u.id, 'lr') then 'enabled_no_lr_permission'
      when not public.whatsapp_assistant_has_permission(u.id, 'pod') then 'enabled_lr_only'
      else 'enabled_lr_and_pod'
    end,
    case
      when exclusion.app_user_id is null
        and coalesce(u.approval_status, 'pending') = 'approved'
        and not coalesce(u.is_locked, false)
        and active_link.id is not null
      then public.whatsapp_assistant_has_permission(u.id, 'lr')
      else false
    end,
    case
      when exclusion.app_user_id is null
        and coalesce(u.approval_status, 'pending') = 'approved'
        and not coalesce(u.is_locked, false)
        and active_link.id is not null
      then public.whatsapp_assistant_has_permission(u.id, 'pod')
      else false
    end,
    active_link.updated_at,
    updater.display_name
  from public.app_users u
  left join lateral (
    select w.id, w.whatsapp_phone_e164, w.updated_at, w.updated_by
    from public.whatsapp_user_links w
    where w.app_user_id = u.id and w.is_active
  ) active_link on true
  left join lateral (
    select w.app_user_id
    from public.whatsapp_user_links w
    where w.app_user_id = u.id
    limit 1
  ) history on true
  left join public.app_users updater on updater.id = active_link.updated_by
  left join public.whatsapp_assistant_access_exclusions exclusion
    on exclusion.app_user_id = u.id and exclusion.is_active
  where u.role in ('admin', 'staff')
  order by lower(u.display_name), u.id;
end;
$$;

create function public.whatsapp_internal_access_set_phone(
  p_target_user_id uuid,
  p_phone_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.whatsapp_internal_access_require_creator();
  v_target public.app_users;
  v_existing public.whatsapp_user_links;
  v_phone text := public.whatsapp_internal_access_normalize_phone(p_phone_input);
  v_new public.whatsapp_user_links;
begin
  if p_target_user_id is null then
    raise exception 'Invalid target' using errcode = '22023';
  end if;

  select * into v_target
  from public.app_users u
  where u.id = p_target_user_id
  for update;

  if not found then
    raise exception 'Invalid target' using errcode = '22023';
  end if;
  if v_target.id = v_actor or v_target.role = 'creator' then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_target.role not in ('admin', 'staff')
    or coalesce(v_target.approval_status, 'pending') <> 'approved'
    or coalesce(v_target.is_locked, false) then
    raise exception 'Target is not eligible' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.whatsapp_assistant_access_exclusions e
    where e.app_user_id = v_target.id and e.is_active
  ) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  -- Serialize every ownership decision for this canonical phone.
  --
  -- The historical-ownership, reservation, and active-phone checks below are
  -- non-locking EXISTS probes. Without serialization a concurrent set_phone
  -- could assign this phone to another user and disable it between our probe
  -- and our insert, after which the active-phone unique index no longer
  -- blocks us and the M101 reservation only says 'internal' (not which
  -- internal user owns it). That interleaving would let us steal a phone that
  -- already has a committed historical owner.
  --
  -- pg_advisory_xact_lock is transaction-scoped: released automatically at
  -- COMMIT/ROLLBACK, so no leaked lock on error. The key is derived from the
  -- canonical E.164 with a fixed namespace prefix, so formatting-equivalent
  -- inputs (e.g. +91 99999 00001 vs 9999900001) normalize to the same phone
  -- before this point and therefore contend on the same lock. pg_advisory_xact_lock
  -- and hashtextextended resolve from pg_catalog, which is always on the
  -- implicit search path even under search_path = ''.
  --
  -- Lock ordering: this function always takes the target-user row lock
  -- (FOR UPDATE above) BEFORE this canonical-phone advisory lock. disable()
  -- takes only the user row lock and never this advisory lock; list() takes
  -- neither. No path takes the phone lock before a user lock, so the single
  -- global order — user row, then phone — is consistent and cannot deadlock.
  perform pg_advisory_xact_lock(
    hashtextextended('whatsapp_internal_access_phone:' || v_phone, 0)
  );

  -- Never silently transfer even an old, disabled internal identity.
  if exists (
    select 1
    from public.whatsapp_user_links w
    where w.whatsapp_phone_e164 = v_phone
      and w.app_user_id <> v_target.id
  ) then
    raise exception 'Phone unavailable' using errcode = '23505';
  end if;
  if exists (
    select 1
    from public.whatsapp_phone_reservations r
    where r.whatsapp_phone_e164 = v_phone
      and r.principal_kind <> 'internal'
  ) then
    raise exception 'Phone unavailable' using errcode = '23505';
  end if;

  select * into v_existing
  from public.whatsapp_user_links w
  where w.app_user_id = v_target.id and w.is_active
  for update;

  if found and v_existing.whatsapp_phone_e164 = v_phone then
    return jsonb_build_object('status', 'unchanged', 'whatsapp_phone_e164', v_phone);
  end if;

  -- The active-user unique index requires replacement in this order. Any
  -- failure below rolls the update back, leaving the previous link active.
  if found then
    update public.whatsapp_user_links
    set is_active = false, updated_by = v_actor
    where id = v_existing.id;
  end if;

  begin
    insert into public.whatsapp_user_links(
      app_user_id, whatsapp_phone_e164, is_active, created_by, updated_by
    ) values (
      v_target.id, v_phone, true, v_actor, v_actor
    )
    returning * into v_new;
  exception
    when unique_violation then
      raise exception 'Phone unavailable' using errcode = '23505';
    when raise_exception then
      -- M101's reservation trigger can create an external reservation for this
      -- phone in the window after our pre-check passed. It is the only known
      -- source of this exact P0001 message here; translate that single
      -- cross-system conflict into the same generic refusal. PostgreSQL gives
      -- no stable discriminator other than SQLSTATE + message text, so we match
      -- the message exactly. Every other raise_exception (and every other
      -- exception class) is deliberately NOT handled and propagates unchanged;
      -- there is no broad catch-all handler and no early success, so a failed
      -- insert still rolls back the replacement above.
      if sqlerrm = 'Phone reserved for another identity system' then
        raise exception 'Phone unavailable' using errcode = '23505';
      else
        raise;
      end if;
  end;

  return jsonb_build_object(
    'status', 'enabled',
    'whatsapp_phone_e164', v_new.whatsapp_phone_e164,
    'mapping_updated_at', v_new.updated_at
  );
end;
$$;

create function public.whatsapp_internal_access_disable(p_target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.whatsapp_internal_access_require_creator();
  v_target public.app_users;
  v_existing public.whatsapp_user_links;
begin
  if p_target_user_id is null then
    raise exception 'Invalid target' using errcode = '22023';
  end if;

  select * into v_target
  from public.app_users u
  where u.id = p_target_user_id
  for update;

  if not found then
    raise exception 'Invalid target' using errcode = '22023';
  end if;
  if v_target.id = v_actor or v_target.role = 'creator' then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_target.role not in ('admin', 'staff') then
    raise exception 'Invalid target' using errcode = '22023';
  end if;

  select * into v_existing
  from public.whatsapp_user_links w
  where w.app_user_id = v_target.id and w.is_active
  for update;

  if not found then
    return jsonb_build_object('status', 'disabled');
  end if;

  update public.whatsapp_user_links
  set is_active = false, updated_by = v_actor
  where id = v_existing.id;

  return jsonb_build_object('status', 'disabled');
end;
$$;

revoke all on function public.whatsapp_internal_access_require_creator()
  from public, anon, authenticated, service_role;
revoke all on function public.whatsapp_internal_access_normalize_phone(text)
  from public, anon, authenticated, service_role;

revoke all on function public.whatsapp_internal_access_list()
  from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_internal_access_list()
  to authenticated;

revoke all on function public.whatsapp_internal_access_set_phone(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_internal_access_set_phone(uuid, text)
  to authenticated;

revoke all on function public.whatsapp_internal_access_disable(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_internal_access_disable(uuid)
  to authenticated;

commit;
