-- ==========================================================
-- Migration: 072_report_multiple_email_recipients
-- Module:    Transport — report_settings multi-recipient email
--
-- PURPOSE (V1):
--   - Change report_settings.report_email_to from text → text[]
--   - Preserve existing single email as a one-element array
--   - Keep singleton row + NOT NULL
--   - update_report_settings validates trim / format / duplicates / ≥1
--
-- NOT applied automatically — review, then apply manually in Supabase.
-- ==========================================================

-- ---------- Column: text → text[] (preserve existing value) ----------
alter table public.report_settings
  alter column report_email_to drop default;

alter table public.report_settings
  alter column report_email_to type text[]
  using (
    case
      when report_email_to is null or btrim(report_email_to) = '' then '{}'::text[]
      else array[btrim(report_email_to)]
    end
  );

alter table public.report_settings
  alter column report_email_to set default '{}'::text[];

alter table public.report_settings
  alter column report_email_to set not null;

comment on table public.report_settings is
  'Singleton Transport report configuration. V1: recipient email list + monthly toggle.';

comment on column public.report_settings.report_email_to is
  'Admin-configured recipient list for Transport monthly summary emails. Not auto-derived from staff.';

-- ---------- get_report_settings (returns text[] as jsonb array) ----------
create or replace function public.get_report_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.report_settings%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_app_admin() then
    raise exception 'Not permitted';
  end if;

  select * into v_row from public.report_settings where id = 1;
  if not found then
    insert into public.report_settings (id) values (1)
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'report_email_to', to_jsonb(v_row.report_email_to),
    'monthly_transport_enabled', v_row.monthly_transport_enabled,
    'monthly_day', v_row.monthly_day,
    'timezone', v_row.timezone
  );
end;
$$;

revoke all on function public.get_report_settings() from public;
revoke all on function public.get_report_settings() from anon;
grant execute on function public.get_report_settings() to authenticated;

-- ---------- update_report_settings (array of emails) ----------
create or replace function public.update_report_settings(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_raw jsonb;
  v_emails text[] := '{}'::text[];
  v_seen text[] := '{}'::text[];
  v_item text;
  v_norm text;
  v_len integer;
  v_i integer;
  v_enabled boolean;
  v_day integer;
  v_row public.report_settings%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_app_admin() then
    raise exception 'Not permitted';
  end if;

  v_raw := p_payload->'report_email_to';
  if v_raw is null or jsonb_typeof(v_raw) <> 'array' then
    raise exception 'report_email_to must be an array of email addresses';
  end if;

  v_len := coalesce(jsonb_array_length(v_raw), 0);
  if v_len < 1 then
    raise exception 'At least one report email recipient is required';
  end if;

  for v_i in 0 .. (v_len - 1) loop
    v_item := trim(coalesce(v_raw->>v_i, ''));
    if v_item = '' then
      raise exception 'Report email recipient cannot be empty';
    end if;
    if v_item !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'Invalid report email address: %', v_item;
    end if;
    v_norm := lower(v_item);
    if v_norm = any (v_seen) then
      raise exception 'Duplicate report email address: %', v_item;
    end if;
    v_seen := array_append(v_seen, v_norm);
    v_emails := array_append(v_emails, v_item);
  end loop;

  v_enabled := coalesce((p_payload->>'monthly_transport_enabled')::boolean, false);
  begin
    v_day := coalesce((p_payload->>'monthly_day')::integer, 1);
  exception
    when others then
      v_day := 1;
  end;
  if v_day < 1 or v_day > 28 then
    raise exception 'monthly_day must be between 1 and 28';
  end if;

  update public.report_settings
  set
    report_email_to = v_emails,
    monthly_transport_enabled = v_enabled,
    monthly_day = v_day,
    updated_at = now(),
    updated_by = v_uid
  where id = 1
  returning * into v_row;

  if not found then
    insert into public.report_settings (
      id, report_email_to, monthly_transport_enabled, monthly_day, updated_by
    ) values (1, v_emails, v_enabled, v_day, v_uid)
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'report_email_to', to_jsonb(v_row.report_email_to),
    'monthly_transport_enabled', v_row.monthly_transport_enabled,
    'monthly_day', v_row.monthly_day,
    'timezone', v_row.timezone
  );
end;
$$;

revoke all on function public.update_report_settings(jsonb) from public;
revoke all on function public.update_report_settings(jsonb) from anon;
grant execute on function public.update_report_settings(jsonb) to authenticated;
