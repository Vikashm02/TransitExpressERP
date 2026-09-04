-- ==========================================================
-- Migration: 065_consignee_relationship_conversations
-- Module:    Consignee Relationship Intelligence V1 — database foundation
--
-- Additive ONLY. Creates a new conversation-capture table and RPCs.
-- Does NOT modify:
--   - public.get_consignee_intelligence (049 / 050 LR analytics)
--   - lrs / pods / billing / finance / customers schema
--   - assistant-bridge RPCs
--
-- NOT applied automatically — review, then apply manually in Supabase.
-- Do NOT deploy UI, voice, OpenAI, Edge Functions, webhooks, or Realtime
-- in this migration.
--
-- Naming: consignee_conversations* is relationship capture.
--         get_consignee_intelligence remains LR analytics (untouched).
--
-- customer_id is a logical reference to public.customers.id.
-- There is intentionally NO foreign-key constraint (project convention).
-- ==========================================================


-- ----------------------------------------------------------
-- PART A — table
-- ----------------------------------------------------------

create table if not exists public.consignee_conversations (
  id bigint generated always as identity primary key,

  customer_id bigint not null
    check (customer_id > 0),
  customer_name text not null
    check (char_length(trim(customer_name)) > 0),
  customer_code text,

  original_remark text not null
    check (char_length(trim(original_remark)) > 0),
  input_type text not null default 'text'
    check (input_type in ('text', 'voice')),

  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id),

  ai_status text not null default 'pending'
    check (ai_status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  ai_processed_at timestamptz,

  ai_category text,
  ai_subcategory text,
  ai_issue_summary text,
  ai_impact text,
  ai_conclusion text,
  ai_nature text
    check (ai_nature is null or ai_nature in ('temporary', 'structural', 'unclear')),
  ai_nature_confidence text
    check (ai_nature_confidence is null or ai_nature_confidence in ('high', 'medium', 'low')),
  ai_resolution_text text,
  ai_resolution_date date,
  ai_raw_response jsonb,

  -- Data-model only in V1. No UI or business logic in this migration.
  follow_up_due_date date
);

create index if not exists idx_cc_customer_id
  on public.consignee_conversations (customer_id);

create index if not exists idx_cc_created_at
  on public.consignee_conversations (created_at desc);

create index if not exists idx_cc_created_by
  on public.consignee_conversations (created_by);

create index if not exists idx_cc_ai_status_pending
  on public.consignee_conversations (ai_status)
  where ai_status in ('pending', 'failed');

comment on table public.consignee_conversations is
  'Consignee Relationship Intelligence V1: employee conversation/remark capture. Separate from LR analytics get_consignee_intelligence. customer_id is a logical reference to customers.id (no FK). original_remark is immutable after insert.';

comment on column public.consignee_conversations.customer_id is
  'Logical reference to public.customers.id. No database foreign-key constraint.';

comment on column public.consignee_conversations.customer_name is
  'Snapshot of consignee name at record time. Preserved if customers.name later changes.';

comment on column public.consignee_conversations.customer_code is
  'Snapshot of consignee code at record time.';

comment on column public.consignee_conversations.original_remark is
  'Immutable employee remark/transcript. Never replaced by AI output.';

comment on column public.consignee_conversations.created_by is
  'Employee who recorded the communication. Set from auth.uid() on INSERT. Never changed by AI.';

comment on column public.consignee_conversations.created_at is
  'When the employee recorded the communication. Never changed by AI.';

comment on column public.consignee_conversations.updated_by is
  'Last HUMAN editor. AI / service-side updates must not overwrite this.';

comment on column public.consignee_conversations.updated_at is
  'Last HUMAN edit time. AI / service-side updates must not overwrite this.';

comment on column public.consignee_conversations.ai_processed_at is
  'When AI processing last wrote extraction fields. Distinct from updated_at.';

comment on column public.consignee_conversations.ai_raw_response is
  'Internal AI payload for debug/reprocessing. Not exposed by authenticated read RPCs.';

comment on column public.consignee_conversations.follow_up_due_date is
  'Reserved for a later follow-up UI. Unused in V1.';


-- ----------------------------------------------------------
-- PART B — audit / immutability trigger
--
-- INSERT (employee JWT):
--   created_by / created_at / updated_by / updated_at := auth.uid() / now()
--   all AI fields forced to pending / null (client cannot spoof AI)
--
-- UPDATE:
--   original_remark, input_type, customer_*, created_* always preserved
--   if auth.uid() is null (service-role / no user JWT):
--     updated_by / updated_at preserved (AI is not a human edit)
--   if auth.uid() is present (future human edit path):
--     updated_by / updated_at refreshed
-- ----------------------------------------------------------

create or replace function public.set_consignee_conversations_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_by := auth.uid();
    new.updated_at := now();

    new.ai_status := 'pending';
    new.ai_processed_at := null;
    new.ai_category := null;
    new.ai_subcategory := null;
    new.ai_issue_summary := null;
    new.ai_impact := null;
    new.ai_conclusion := null;
    new.ai_nature := null;
    new.ai_nature_confidence := null;
    new.ai_resolution_text := null;
    new.ai_resolution_date := null;
    new.ai_raw_response := null;
    new.follow_up_due_date := null;

    return new;
  end if;

  if TG_OP = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.original_remark := old.original_remark;
    new.input_type := old.input_type;
    new.customer_id := old.customer_id;
    new.customer_name := old.customer_name;
    new.customer_code := old.customer_code;

    -- Service-side AI path: no user JWT, so auth.uid() is null.
    -- Do not treat this as a human edit.
    if auth.uid() is null then
      new.updated_by := old.updated_by;
      new.updated_at := old.updated_at;
    else
      new.updated_by := auth.uid();
      new.updated_at := now();
    end if;

    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.set_consignee_conversations_audit() from public;
revoke all on function public.set_consignee_conversations_audit() from anon, authenticated;

drop trigger if exists trg_consignee_conversations_audit
  on public.consignee_conversations;

create trigger trg_consignee_conversations_audit
  before insert or update on public.consignee_conversations
  for each row
  execute function public.set_consignee_conversations_audit();

comment on function public.set_consignee_conversations_audit() is
  'Protects consignee conversation human fields and audit ownership. AI updates (auth.uid() null) must not change created_*/updated_*/original_remark.';


-- ----------------------------------------------------------
-- PART C — privileges + RLS
--
-- EXECUTE on a function is independent of RLS bypass.
-- service_role bypasses RLS on tables; it does NOT automatically
-- receive EXECUTE on functions after REVOKE FROM PUBLIC.
--
-- authenticated:
--   GRANT select, insert, delete on the table
--   NO UPDATE privilege
--   RLS: select (view), insert (create_view), delete (is_admin only)
--   no UPDATE policy
--
-- service_role:
--   GRANT ALL on table (needed for trusted Edge Function later)
--   GRANT EXECUTE only on enrich_consignee_conversation
-- ----------------------------------------------------------

alter table public.consignee_conversations enable row level security;

revoke all on table public.consignee_conversations from public;
revoke all on table public.consignee_conversations from anon;
revoke all on table public.consignee_conversations from authenticated;

grant select, insert, delete on table public.consignee_conversations
  to authenticated;
grant all on table public.consignee_conversations
  to service_role;

-- Identity sequence for INSERT as authenticated.
grant usage, select on sequence public.consignee_conversations_id_seq
  to authenticated;
grant usage, select, update on sequence public.consignee_conversations_id_seq
  to service_role;

drop policy if exists consignee_conversations_select_permitted
  on public.consignee_conversations;
create policy consignee_conversations_select_permitted
  on public.consignee_conversations
  for select
  to authenticated
  using (public.has_permission('consignee_intelligence', 'view'));

drop policy if exists consignee_conversations_insert_permitted
  on public.consignee_conversations;
create policy consignee_conversations_insert_permitted
  on public.consignee_conversations
  for insert
  to authenticated
  with check (public.has_permission('consignee_intelligence', 'create_view'));

-- Intentionally no UPDATE policy for authenticated.
-- Direct UPDATE is blocked by both missing RLS policy and missing GRANT UPDATE.

drop policy if exists consignee_conversations_delete_admin_only
  on public.consignee_conversations;
create policy consignee_conversations_delete_admin_only
  on public.consignee_conversations
  for delete
  to authenticated
  using (public.is_admin());


-- ----------------------------------------------------------
-- PART D — authenticated read RPCs
-- ----------------------------------------------------------

create or replace function public.get_consignee_conversations(
  p_customer_id bigint,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer;
  v_offset integer;
  v_total integer := 0;
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_permission('consignee_intelligence', 'view') then
    raise exception 'Not permitted to view consignee conversations';
  end if;

  if p_customer_id is null or p_customer_id <= 0 then
    raise exception 'customer_id is required';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  select count(*)::integer
    into v_total
  from public.consignee_conversations c
  where c.customer_id = p_customer_id;

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      c.id,
      c.customer_id,
      c.customer_name,
      c.customer_code,
      c.original_remark,
      c.input_type,
      c.created_at,
      c.created_by,
      coalesce(nullif(trim(u.display_name), ''), nullif(trim(u.email), ''), 'Unknown')
        as created_by_name,
      c.ai_status,
      c.ai_processed_at,
      c.ai_category,
      c.ai_subcategory,
      c.ai_issue_summary,
      c.ai_impact,
      c.ai_conclusion,
      c.ai_nature,
      c.ai_nature_confidence,
      c.ai_resolution_text,
      c.ai_resolution_date,
      c.follow_up_due_date
    from public.consignee_conversations c
    left join public.app_users u on u.id = c.created_by
    where c.customer_id = p_customer_id
    order by c.created_at desc, c.id desc
    limit v_limit
    offset v_offset
  ) x;

  return jsonb_build_object(
    'customer_id', p_customer_id,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'conversations', v_items
  );
end;
$$;

revoke all on function public.get_consignee_conversations(bigint, integer, integer)
  from public;
revoke all on function public.get_consignee_conversations(bigint, integer, integer)
  from anon;
grant execute on function public.get_consignee_conversations(bigint, integer, integer)
  to authenticated;

comment on function public.get_consignee_conversations(bigint, integer, integer) is
  'Paginated consignee conversation timeline. Requires consignee_intelligence view. Does not return ai_raw_response.';


create or replace function public.get_consignee_conversation_summary(
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer;
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_permission('consignee_intelligence', 'view') then
    raise exception 'Not permitted to view consignee conversations';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.last_conversation_at desc, x.customer_id desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      s.customer_id,
      s.customer_name,
      s.customer_code,
      s.last_conversation_at,
      s.conversation_count,
      s.last_ai_conclusion,
      coalesce(nullif(trim(u.display_name), ''), nullif(trim(u.email), ''), 'Unknown')
        as last_created_by_name
    from (
      select distinct on (c.customer_id)
        c.customer_id,
        c.customer_name,
        c.customer_code,
        c.created_at as last_conversation_at,
        c.created_by as last_created_by,
        c.ai_conclusion as last_ai_conclusion,
        count(*) over (partition by c.customer_id) as conversation_count
      from public.consignee_conversations c
      order by c.customer_id, c.created_at desc, c.id desc
    ) s
    left join public.app_users u on u.id = s.last_created_by
    order by s.last_conversation_at desc, s.customer_id desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'limit', v_limit,
    'consignees', v_items
  );
end;
$$;

revoke all on function public.get_consignee_conversation_summary(integer)
  from public;
revoke all on function public.get_consignee_conversation_summary(integer)
  from anon;
grant execute on function public.get_consignee_conversation_summary(integer)
  to authenticated;

comment on function public.get_consignee_conversation_summary(integer) is
  'Landing-page summary: one row per consignee that has at least one conversation. Requires consignee_intelligence view.';


-- ----------------------------------------------------------
-- PART E — AI enrichment (schema only; no Edge Function)
--
-- Privilege model (verified PostgreSQL / Supabase behavior):
--   1) RLS bypass (service_role / table owner) does NOT grant EXECUTE.
--   2) New functions receive EXECUTE for PUBLIC by default until revoked.
--   3) Therefore: REVOKE ALL from PUBLIC / anon / authenticated, then
--      GRANT EXECUTE to service_role only.
--   4) SECURITY DEFINER changes current_user to the owner, so do not
--      authorize using current_user. Authorize using the JWT role claim.
--   5) auth.uid() is expected to be null on the service-role path and
--      must not be required.
--   6) Authenticated JWTs are rejected even if EXECUTE were mis-granted.
-- ----------------------------------------------------------

create or replace function public.enrich_consignee_conversation(
  p_id bigint,
  p_ai_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text;
  v_status text;
  v_nature text;
  v_confidence text;
  v_resolution_date date;
  v_updated integer := 0;
begin
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
      ''
    ),
    ''
  );

  -- Block ordinary user / anon JWTs. Allow service_role.
  -- Empty role (SQL editor / no JWT) is allowed for manual operator retry
  -- after apply; authenticated PostgREST callers always send a role claim.
  if v_jwt_role in ('authenticated', 'anon') then
    raise exception 'not_authorized';
  end if;

  if v_jwt_role <> '' and v_jwt_role is distinct from 'service_role' then
    raise exception 'not_authorized';
  end if;

  if p_id is null or p_id <= 0 then
    raise exception 'conversation id is required';
  end if;

  if p_ai_data is null or jsonb_typeof(p_ai_data) <> 'object' then
    raise exception 'ai_data must be a JSON object';
  end if;

  v_status := lower(nullif(trim(coalesce(p_ai_data ->> 'status', 'done')), ''));
  if v_status not in ('processing', 'done', 'failed', 'skipped') then
    raise exception 'invalid ai status';
  end if;

  v_nature := nullif(trim(coalesce(p_ai_data ->> 'nature', '')), '');
  if v_nature is not null and v_nature not in ('temporary', 'structural', 'unclear') then
    raise exception 'invalid ai nature';
  end if;

  v_confidence := lower(nullif(trim(coalesce(p_ai_data ->> 'nature_confidence', '')), ''));
  if v_confidence is not null and v_confidence not in ('high', 'medium', 'low') then
    raise exception 'invalid ai nature confidence';
  end if;

  begin
    v_resolution_date := nullif(trim(coalesce(p_ai_data ->> 'resolution_date', '')), '')::date;
  exception
    when others then
      v_resolution_date := null;
  end;

  update public.consignee_conversations
  set
    ai_status = v_status,
    ai_processed_at = case
      when v_status = 'processing' then ai_processed_at
      else now()
    end,
    ai_category = nullif(trim(coalesce(p_ai_data ->> 'category', '')), ''),
    ai_subcategory = nullif(trim(coalesce(p_ai_data ->> 'subcategory', '')), ''),
    ai_issue_summary = nullif(trim(coalesce(p_ai_data ->> 'issue_summary', '')), ''),
    ai_impact = nullif(trim(coalesce(p_ai_data ->> 'impact', '')), ''),
    ai_conclusion = nullif(trim(coalesce(p_ai_data ->> 'conclusion', '')), ''),
    ai_nature = v_nature,
    ai_nature_confidence = v_confidence,
    ai_resolution_text = nullif(trim(coalesce(p_ai_data ->> 'resolution_text', '')), ''),
    ai_resolution_date = v_resolution_date,
    ai_raw_response = case
      when p_ai_data ? 'raw_response' then p_ai_data -> 'raw_response'
      else p_ai_data
    end
  where id = p_id
    and ai_status in ('pending', 'processing', 'failed');

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'ok', v_updated > 0,
    'id', p_id,
    'updated', v_updated > 0
  );
end;
$$;

revoke all on function public.enrich_consignee_conversation(bigint, jsonb)
  from public;
revoke all on function public.enrich_consignee_conversation(bigint, jsonb)
  from anon;
revoke all on function public.enrich_consignee_conversation(bigint, jsonb)
  from authenticated;
grant execute on function public.enrich_consignee_conversation(bigint, jsonb)
  to service_role;

comment on function public.enrich_consignee_conversation(bigint, jsonb) is
  'Trusted AI enrichment only. EXECUTE granted to service_role, revoked from PUBLIC/anon/authenticated. Rejects authenticated/anon JWTs. Does not require auth.uid(). Does not change human remark or human audit fields.';


-- ==========================================================
-- END 065
-- ==========================================================
