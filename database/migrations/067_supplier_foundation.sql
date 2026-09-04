-- ==========================================================
-- Migration: 067_supplier_foundation.sql
-- Module:    Supplier Intelligence — database foundation
--
-- ADDITIVE ONLY. Creates namespaced supplier_* objects.
--
-- Does NOT:
--   - ALTER any Transport / Consignee Relationship tables
--   - ALTER app_users core columns or auth triggers
--   - ALTER existing permission helper function logic
--   - ALTER customers / lrs / pods / billing / ASN / ledger /
--     vehicles / drivers / transporters / materials /
--     consignee_conversations / get_consignee_intelligence
--   - Apply OpenAI / enrichment RPCs / browser AI access
--
-- Identity: public.app_users (uuid). No profiles table.
-- Permissions: reuse has_permission / has_module_action / is_admin.
-- Shared dataset among staff with supplier_intelligence access.
-- Creator/admin/full_access bypass remains existing ERP behavior.
--
-- NOT applied automatically — review, then apply manually in Supabase.
-- Do NOT apply Desktop Supplier prototype migrations 001–009.
-- ==========================================================


-- ----------------------------------------------------------
-- PART A — helper functions (supplier_* namespaced only)
-- ----------------------------------------------------------

-- Generic created_by / updated_by for Supplier master & child rows.
-- Authenticated: force from auth.uid().
-- Service-role (auth.uid() null): leave caller-supplied values.
create or replace function public.supplier_set_row_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    if tg_op = 'INSERT' then
      if new.created_at is null then
        new.created_at := now();
      end if;
      if new.updated_at is null then
        new.updated_at := coalesce(new.created_at, now());
      end if;
    elsif tg_op = 'UPDATE' then
      -- Preserve human audit stamps unless caller explicitly changes updated_*.
      if new.created_by is distinct from old.created_by then
        new.created_by := old.created_by;
      end if;
      if new.created_at is distinct from old.created_at then
        new.created_at := old.created_at;
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;

  return new;
end;
$$;

comment on function public.supplier_set_row_audit_fields() is
  'Supplier: sets created_by/updated_by from auth.uid() for authenticated clients; preserves created_* on UPDATE; skips force when auth.uid() is null (service_role).';

revoke all on function public.supplier_set_row_audit_fields() from public;
revoke all on function public.supplier_set_row_audit_fields() from anon, authenticated;


-- created_by only (join tables without updated_by)
create or replace function public.supplier_set_row_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    if new.created_at is null then
      new.created_at := now();
    end if;
  elsif new.created_at is null then
    new.created_at := now();
  end if;
  return new;
end;
$$;

comment on function public.supplier_set_row_created_by() is
  'Supplier: forces created_by from auth.uid() on INSERT for join tables.';

revoke all on function public.supplier_set_row_created_by() from public;
revoke all on function public.supplier_set_row_created_by() from anon, authenticated;


-- Conversation insert/update: identity, immutability, snapshots, human audit.
create or replace function public.supplier_set_conversation_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person_name text;
  v_person_designation text;
  v_org_name text;
  v_loc_name text;
  v_loc_org uuid;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.logged_by_user_id := auth.uid();
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
      if new.conducted_by_user_id is null then
        new.conducted_by_user_id := auth.uid();
      end if;
    else
      -- service_role / system insert: require explicit logged_by
      if new.logged_by_user_id is null then
        raise exception
          'supplier_conversations: logged_by_user_id is required when auth.uid() is null';
      end if;
      if new.created_by is null then
        new.created_by := new.logged_by_user_id;
      end if;
      if new.updated_by is null then
        new.updated_by := new.logged_by_user_id;
      end if;
      if new.conducted_by_user_id is null then
        new.conducted_by_user_id := new.logged_by_user_id;
      end if;
    end if;

    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, new.created_at);
    new.occurred_at := coalesce(new.occurred_at, now());
    new.input_type := coalesce(nullif(trim(new.input_type), ''), 'text');

    -- Location must belong to organization; inherit org from location if needed.
    if new.location_id is not null then
      select organization_id, name
        into v_loc_org, v_loc_name
      from public.supplier_organization_locations
      where id = new.location_id;

      if v_loc_org is null then
        raise exception 'supplier_conversations: location % does not exist', new.location_id;
      end if;

      if new.organization_id is not null and new.organization_id <> v_loc_org then
        raise exception
          'supplier_conversations: location must belong to the selected organization';
      end if;

      if new.organization_id is null then
        new.organization_id := v_loc_org;
      end if;

      if new.location_name_snapshot is null then
        new.location_name_snapshot := v_loc_name;
      end if;
    end if;

    -- Populate snapshots from masters when not provided (historical readability).
    if new.person_id is not null then
      select p.name, p.designation
        into v_person_name, v_person_designation
      from public.supplier_people p
      where p.id = new.person_id;

      if v_person_name is null then
        raise exception 'supplier_conversations: person % does not exist', new.person_id;
      end if;

      if new.person_name_snapshot is null then
        new.person_name_snapshot := v_person_name;
      end if;
      if new.person_designation_snapshot is null then
        new.person_designation_snapshot := v_person_designation;
      end if;
    end if;

    if new.organization_id is not null then
      select o.name
        into v_org_name
      from public.supplier_organizations o
      where o.id = new.organization_id;

      if v_org_name is null then
        raise exception
          'supplier_conversations: organization % does not exist', new.organization_id;
      end if;

      if new.organization_name_snapshot is null then
        new.organization_name_snapshot := v_org_name;
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Immutable provenance / source-of-truth fields
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.logged_by_user_id := old.logged_by_user_id;
    new.original_text := old.original_text;
    new.input_type := old.input_type;
    new.person_name_snapshot := old.person_name_snapshot;
    new.person_designation_snapshot := old.person_designation_snapshot;
    new.organization_name_snapshot := old.organization_name_snapshot;
    new.location_name_snapshot := old.location_name_snapshot;

    -- Context IDs: allow ON DELETE SET NULL (id -> null) only.
    -- Block reassignment to a different person/org/location after insert.
    -- Snapshots remain so historical readability is preserved.
    if new.person_id is distinct from old.person_id
       and not (new.person_id is null and old.person_id is not null) then
      raise exception
        'supplier_conversations: person_id cannot be reassigned after insert';
    end if;
    if new.organization_id is distinct from old.organization_id
       and not (new.organization_id is null and old.organization_id is not null) then
      raise exception
        'supplier_conversations: organization_id cannot be reassigned after insert';
    end if;
    if new.location_id is distinct from old.location_id
       and not (new.location_id is null and old.location_id is not null) then
      raise exception
        'supplier_conversations: location_id cannot be reassigned after insert';
    end if;

    if auth.uid() is null then
      -- service_role / system: not a human edit
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

comment on function public.supplier_set_conversation_audit() is
  'Supplier conversations: auth-forced logged_by/created_by; populate & lock snapshots; immutable original_text/provenance; human vs service_role audit.';

revoke all on function public.supplier_set_conversation_audit() from public;
revoke all on function public.supplier_set_conversation_audit() from anon, authenticated;


-- Person↔org link: location must belong to linked organization.
create or replace function public.supplier_validate_person_org_link_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc_org uuid;
begin
  if new.location_id is null then
    return new;
  end if;

  select organization_id into v_loc_org
  from public.supplier_organization_locations
  where id = new.location_id;

  if v_loc_org is null then
    raise exception 'supplier_person_organization_links: location % does not exist', new.location_id;
  end if;

  if v_loc_org <> new.organization_id then
    raise exception
      'supplier_person_organization_links: location must belong to the linked organization';
  end if;

  return new;
end;
$$;

comment on function public.supplier_validate_person_org_link_location() is
  'Ensures supplier_person_organization_links.location_id belongs to organization_id.';

revoke all on function public.supplier_validate_person_org_link_location() from public;
revoke all on function public.supplier_validate_person_org_link_location() from anon, authenticated;


-- ----------------------------------------------------------
-- PART B — reference & master tables
-- ----------------------------------------------------------

create table if not exists public.supplier_organization_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,
  constraint supplier_organization_types_slug_unique unique (slug),
  constraint supplier_organization_types_name_unique unique (name),
  constraint supplier_organization_types_slug_not_blank
    check (char_length(trim(slug)) > 0),
  constraint supplier_organization_types_name_not_blank
    check (char_length(trim(name)) > 0)
);

comment on table public.supplier_organization_types is
  'Supplier Intelligence reference org types. Seeded; ordinary users read-only.';

create index if not exists supplier_organization_types_active_idx
  on public.supplier_organization_types (active);

create index if not exists supplier_organization_types_sort_idx
  on public.supplier_organization_types (sort_order, name);


create table if not exists public.supplier_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,
  constraint supplier_organizations_name_not_blank
    check (char_length(trim(name)) > 0)
);

comment on table public.supplier_organizations is
  'Supplier Intelligence organizations (independent of Transport customers/billing_parties/transporters). Soft-delete via active.';

create index if not exists supplier_organizations_name_idx
  on public.supplier_organizations (name);

create index if not exists supplier_organizations_active_idx
  on public.supplier_organizations (active);

create unique index if not exists supplier_organizations_code_unique_idx
  on public.supplier_organizations (code)
  where code is not null;


create table if not exists public.supplier_organization_type_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.supplier_organizations (id) on delete cascade,
  organization_type_id uuid not null
    references public.supplier_organization_types (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,
  constraint supplier_organization_type_links_unique
    unique (organization_id, organization_type_id)
);

comment on table public.supplier_organization_type_links is
  'Many-to-many: supplier organization ↔ organization type.';

create index if not exists supplier_organization_type_links_org_idx
  on public.supplier_organization_type_links (organization_id);

create index if not exists supplier_organization_type_links_type_idx
  on public.supplier_organization_type_links (organization_type_id);


create table if not exists public.supplier_organization_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.supplier_organizations (id) on delete restrict,
  name text not null,
  address text,
  city text,
  state text,
  country text,
  pincode text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,
  constraint supplier_organization_locations_name_not_blank
    check (char_length(trim(name)) > 0)
);

comment on table public.supplier_organization_locations is
  'Supplier organization sites. Soft-delete via active. Org hard-delete RESTRICT while locations exist.';

create index if not exists supplier_organization_locations_org_idx
  on public.supplier_organization_locations (organization_id);

create index if not exists supplier_organization_locations_active_idx
  on public.supplier_organization_locations (active);

create index if not exists supplier_organization_locations_city_idx
  on public.supplier_organization_locations (city);

create unique index if not exists supplier_organization_locations_org_name_unique_idx
  on public.supplier_organization_locations (organization_id, lower(name));


create table if not exists public.supplier_people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  designation text,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,
  constraint supplier_people_name_not_blank
    check (char_length(trim(name)) > 0)
);

comment on table public.supplier_people is
  'Supplier Intelligence contacts. Soft-delete via active. Not Transport customers.';

create index if not exists supplier_people_name_idx
  on public.supplier_people (name);

create index if not exists supplier_people_active_idx
  on public.supplier_people (active);

create index if not exists supplier_people_phone_idx
  on public.supplier_people (phone);

create index if not exists supplier_people_email_idx
  on public.supplier_people (email);


create table if not exists public.supplier_person_organization_links (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null
    references public.supplier_people (id) on delete restrict,
  organization_id uuid not null
    references public.supplier_organizations (id) on delete restrict,
  location_id uuid
    references public.supplier_organization_locations (id) on delete set null,
  designation text,
  is_primary boolean not null default false,
  active boolean not null default true,
  started_on date,
  ended_on date,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,
  constraint supplier_person_organization_links_date_range
    check (
      ended_on is null
      or started_on is null
      or ended_on >= started_on
    )
);

comment on table public.supplier_person_organization_links is
  'Historical person ↔ organization relationships. Prefer soft-deactivate (active=false).';

create index if not exists supplier_person_organization_links_person_idx
  on public.supplier_person_organization_links (person_id);

create index if not exists supplier_person_organization_links_org_idx
  on public.supplier_person_organization_links (organization_id);

create index if not exists supplier_person_organization_links_location_idx
  on public.supplier_person_organization_links (location_id);

create index if not exists supplier_person_organization_links_active_idx
  on public.supplier_person_organization_links (person_id, organization_id, active);

-- At most one primary *active* organization relationship per person.
create unique index if not exists supplier_person_organization_links_one_primary_active_idx
  on public.supplier_person_organization_links (person_id)
  where is_primary = true and active = true;


-- ----------------------------------------------------------
-- PART C — conversations (source of truth)
-- ----------------------------------------------------------

create table if not exists public.supplier_conversations (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid
    references public.supplier_organizations (id) on delete set null,
  person_id uuid
    references public.supplier_people (id) on delete set null,
  location_id uuid
    references public.supplier_organization_locations (id) on delete set null,

  title text,
  original_text text not null,
  input_type text not null default 'text',
  occurred_at timestamptz not null default now(),

  conducted_by_user_id uuid
    references public.app_users (id) on delete set null,
  logged_by_user_id uuid not null
    references public.app_users (id) on delete restrict,

  -- Historical context at capture time (immutable after insert)
  person_name_snapshot text,
  person_designation_snapshot text,
  organization_name_snapshot text,
  location_name_snapshot text,

  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,

  constraint supplier_conversations_original_text_not_blank
    check (char_length(trim(original_text)) > 0),
  constraint supplier_conversations_input_type_check
    check (input_type in ('text', 'voice'))
);

comment on table public.supplier_conversations is
  'Supplier Intelligence core historical memory. original_text is immutable. Meeting org/person are CONTEXT, not automatic company-specific truth for every statement.';

comment on column public.supplier_conversations.organization_id is
  'Meeting/context organization. Does NOT imply every statement is organization-specific.';

comment on column public.supplier_conversations.original_text is
  'Immutable human source text/transcript. Never overwritten by AI.';

comment on column public.supplier_conversations.input_type is
  'Provenance only: text | voice. No audio storage.';

comment on column public.supplier_conversations.logged_by_user_id is
  'Staff who logged the record. Forced from auth.uid() on authenticated INSERT. Immutable.';

comment on column public.supplier_conversations.conducted_by_user_id is
  'Staff who conducted the interaction (may differ from logger). Defaults to logger.';

create index if not exists supplier_conversations_occurred_at_idx
  on public.supplier_conversations (occurred_at desc);

create index if not exists supplier_conversations_created_at_idx
  on public.supplier_conversations (created_at desc);

create index if not exists supplier_conversations_organization_id_idx
  on public.supplier_conversations (organization_id);

create index if not exists supplier_conversations_person_id_idx
  on public.supplier_conversations (person_id);

create index if not exists supplier_conversations_location_id_idx
  on public.supplier_conversations (location_id);

create index if not exists supplier_conversations_conducted_by_idx
  on public.supplier_conversations (conducted_by_user_id);

create index if not exists supplier_conversations_logged_by_idx
  on public.supplier_conversations (logged_by_user_id);


-- ----------------------------------------------------------
-- PART D — tags, insights, follow-ups, AI jobs scaffold
-- ----------------------------------------------------------

create table if not exists public.supplier_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,
  constraint supplier_tags_name_unique unique (name),
  constraint supplier_tags_slug_unique unique (slug),
  constraint supplier_tags_name_not_blank
    check (char_length(trim(name)) > 0),
  constraint supplier_tags_slug_not_blank
    check (char_length(trim(slug)) > 0)
);

comment on table public.supplier_tags is
  'Flexible Supplier topics. No rigid taxonomy in foundation.';

create index if not exists supplier_tags_active_idx
  on public.supplier_tags (active);


create table if not exists public.supplier_conversation_tags (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.supplier_conversations (id) on delete cascade,
  tag_id uuid not null
    references public.supplier_tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  constraint supplier_conversation_tags_unique
    unique (conversation_id, tag_id)
);

create index if not exists supplier_conversation_tags_conversation_idx
  on public.supplier_conversation_tags (conversation_id);

create index if not exists supplier_conversation_tags_tag_idx
  on public.supplier_conversation_tags (tag_id);


create table if not exists public.supplier_insights (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.supplier_conversations (id) on delete cascade,
  content text not null,
  scope text not null default 'unclear',
  statement_kind text not null default 'person_statement',
  source text not null default 'manual',
  confidence numeric(4, 3),
  review_status text,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,
  constraint supplier_insights_content_not_blank
    check (char_length(trim(content)) > 0),
  constraint supplier_insights_scope_check check (
    scope in (
      'organization_specific',
      'location_specific',
      'industry_general',
      'personal_advice',
      'market_observation',
      'opportunity',
      'hurdle',
      'commercial',
      'operational',
      'material',
      'processing',
      'relationship_partnership',
      'other',
      'unclear'
    )
  ),
  constraint supplier_insights_statement_kind_check check (
    statement_kind in (
      'person_statement',
      'user_note',
      'ai_inference',
      'user_conclusion'
    )
  ),
  constraint supplier_insights_source_check check (
    source in ('manual', 'ai_suggested', 'imported')
  ),
  constraint supplier_insights_confidence_range check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  constraint supplier_insights_review_status_check check (
    review_status is null
    or review_status in ('pending', 'accepted', 'edited', 'rejected')
  )
);

comment on table public.supplier_insights is
  'Structured statements derived from a conversation. NOT the source of truth. Scope distinguishes company-specific vs general industry / advice / opportunity.';

comment on column public.supplier_insights.statement_kind is
  'person_statement | user_note | ai_inference | user_conclusion — distinguish human vs AI.';

comment on column public.supplier_insights.source is
  'manual | ai_suggested | imported';

create index if not exists supplier_insights_conversation_id_idx
  on public.supplier_insights (conversation_id);

create index if not exists supplier_insights_scope_idx
  on public.supplier_insights (scope);

create index if not exists supplier_insights_statement_kind_idx
  on public.supplier_insights (statement_kind);

create index if not exists supplier_insights_created_at_idx
  on public.supplier_insights (created_at desc);


create table if not exists public.supplier_insight_tags (
  id uuid primary key default gen_random_uuid(),
  insight_id uuid not null
    references public.supplier_insights (id) on delete cascade,
  tag_id uuid not null
    references public.supplier_tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  constraint supplier_insight_tags_unique
    unique (insight_id, tag_id)
);

create index if not exists supplier_insight_tags_insight_idx
  on public.supplier_insight_tags (insight_id);

create index if not exists supplier_insight_tags_tag_idx
  on public.supplier_insight_tags (tag_id);


create table if not exists public.supplier_follow_ups (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid
    references public.supplier_conversations (id) on delete set null,
  person_id uuid
    references public.supplier_people (id) on delete set null,
  organization_id uuid
    references public.supplier_organizations (id) on delete set null,
  location_id uuid
    references public.supplier_organization_locations (id) on delete set null,
  assigned_to_user_id uuid
    references public.app_users (id) on delete set null,
  content text not null,
  follow_up_type text not null default 'follow_up',
  status text not null default 'open',
  due_date date,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,
  constraint supplier_follow_ups_content_not_blank
    check (char_length(trim(content)) > 0),
  constraint supplier_follow_ups_type_check check (
    follow_up_type in ('follow_up', 'open_question', 'next_action')
  ),
  constraint supplier_follow_ups_status_check check (
    status in ('open', 'done', 'cancelled')
  )
);

comment on table public.supplier_follow_ups is
  'Open questions / next actions. Independent of AI. Conversation SET NULL preserves follow-up if source row is removed.';

create index if not exists supplier_follow_ups_conversation_id_idx
  on public.supplier_follow_ups (conversation_id);

create index if not exists supplier_follow_ups_status_idx
  on public.supplier_follow_ups (status);

create index if not exists supplier_follow_ups_due_date_idx
  on public.supplier_follow_ups (due_date);

create index if not exists supplier_follow_ups_assigned_to_idx
  on public.supplier_follow_ups (assigned_to_user_id);

create index if not exists supplier_follow_ups_open_due_idx
  on public.supplier_follow_ups (due_date)
  where status = 'open';


-- Future AI queue only. No browser access. No enrichment RPCs in this migration.
create table if not exists public.supplier_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid
    references public.supplier_conversations (id) on delete set null,
  job_type text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id) on delete set null,
  constraint supplier_ai_jobs_job_type_not_blank
    check (char_length(trim(job_type)) > 0),
  constraint supplier_ai_jobs_status_check check (
    status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  )
);

comment on table public.supplier_ai_jobs is
  'Future async AI job queue. Schema only. Authenticated/anon MUST have zero access. service_role only.';

create index if not exists supplier_ai_jobs_conversation_id_idx
  on public.supplier_ai_jobs (conversation_id);

create index if not exists supplier_ai_jobs_status_idx
  on public.supplier_ai_jobs (status);

create index if not exists supplier_ai_jobs_queued_idx
  on public.supplier_ai_jobs (created_at)
  where status in ('queued', 'running');


-- ----------------------------------------------------------
-- PART E — triggers
-- ----------------------------------------------------------

-- Audit triggers on masters / mutable business tables
do $$
declare
  t text;
  tables text[] := array[
    'supplier_organization_types',
    'supplier_organizations',
    'supplier_organization_type_links',
    'supplier_organization_locations',
    'supplier_people',
    'supplier_person_organization_links',
    'supplier_tags',
    'supplier_insights',
    'supplier_follow_ups',
    'supplier_ai_jobs'
  ];
begin
  foreach t in array tables
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      t || '_audit_fields',
      t
    );
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.supplier_set_row_audit_fields()',
      t || '_audit_fields',
      t
    );
  end loop;
end;
$$;

drop trigger if exists supplier_conversation_tags_created_by
  on public.supplier_conversation_tags;
create trigger supplier_conversation_tags_created_by
  before insert on public.supplier_conversation_tags
  for each row
  execute function public.supplier_set_row_created_by();

drop trigger if exists supplier_insight_tags_created_by
  on public.supplier_insight_tags;
create trigger supplier_insight_tags_created_by
  before insert on public.supplier_insight_tags
  for each row
  execute function public.supplier_set_row_created_by();

drop trigger if exists supplier_conversations_audit
  on public.supplier_conversations;
create trigger supplier_conversations_audit
  before insert or update on public.supplier_conversations
  for each row
  execute function public.supplier_set_conversation_audit();

drop trigger if exists supplier_person_organization_links_validate_location
  on public.supplier_person_organization_links;
create trigger supplier_person_organization_links_validate_location
  before insert or update on public.supplier_person_organization_links
  for each row
  execute function public.supplier_validate_person_org_link_location();


-- ----------------------------------------------------------
-- PART F — seed organization types (idempotent)
-- ----------------------------------------------------------

insert into public.supplier_organization_types (slug, name, description, sort_order)
values
  ('consignee', 'Consignee', 'Receiving / consuming organization', 10),
  ('supplier', 'Supplier', 'Supplying organization', 20),
  ('municipality', 'Municipality', 'Municipal body', 30),
  ('processor', 'Processor', 'Processing facility operator', 40),
  ('transporter', 'Transporter', 'Transport / logistics provider', 50),
  ('broker', 'Broker', 'Broker or intermediary', 60),
  ('industry_organization', 'Industry Organization', 'Industry body / association', 70),
  ('other', 'Other', 'Other organization type', 999)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order,
      active = true,
      updated_at = now();


-- ----------------------------------------------------------
-- PART G — privileges + RLS
--
-- Shared Supplier dataset among permitted staff.
-- SELECT: has_permission(..., 'view')
-- INSERT: has_module_action(..., 'create')
-- UPDATE: has_module_action(..., 'edit')
-- DELETE: no authenticated hard-delete policies (business memory).
-- organization_types: SELECT for viewers; writes admin-only.
-- supplier_ai_jobs: zero authenticated/anon access.
-- ----------------------------------------------------------

-- Helper: enable RLS + revoke public/anon; grant base privileges to authenticated
-- (except ai_jobs handled separately).

alter table public.supplier_organization_types enable row level security;
alter table public.supplier_organizations enable row level security;
alter table public.supplier_organization_type_links enable row level security;
alter table public.supplier_organization_locations enable row level security;
alter table public.supplier_people enable row level security;
alter table public.supplier_person_organization_links enable row level security;
alter table public.supplier_conversations enable row level security;
alter table public.supplier_tags enable row level security;
alter table public.supplier_conversation_tags enable row level security;
alter table public.supplier_insights enable row level security;
alter table public.supplier_insight_tags enable row level security;
alter table public.supplier_follow_ups enable row level security;
alter table public.supplier_ai_jobs enable row level security;

-- Revoke broadly
revoke all on table public.supplier_organization_types from public, anon, authenticated;
revoke all on table public.supplier_organizations from public, anon, authenticated;
revoke all on table public.supplier_organization_type_links from public, anon, authenticated;
revoke all on table public.supplier_organization_locations from public, anon, authenticated;
revoke all on table public.supplier_people from public, anon, authenticated;
revoke all on table public.supplier_person_organization_links from public, anon, authenticated;
revoke all on table public.supplier_conversations from public, anon, authenticated;
revoke all on table public.supplier_tags from public, anon, authenticated;
revoke all on table public.supplier_conversation_tags from public, anon, authenticated;
revoke all on table public.supplier_insights from public, anon, authenticated;
revoke all on table public.supplier_insight_tags from public, anon, authenticated;
revoke all on table public.supplier_follow_ups from public, anon, authenticated;
revoke all on table public.supplier_ai_jobs from public, anon, authenticated;

-- Authenticated: SELECT/INSERT/UPDATE on business tables (no DELETE).
-- Types: SELECT only for authenticated; admin write via is_admin policies + grants.
grant select on table public.supplier_organization_types to authenticated;
grant select, insert, update on table public.supplier_organizations to authenticated;
grant select, insert, update on table public.supplier_organization_type_links to authenticated;
grant select, insert, update on table public.supplier_organization_locations to authenticated;
grant select, insert, update on table public.supplier_people to authenticated;
grant select, insert, update on table public.supplier_person_organization_links to authenticated;
grant select, insert, update on table public.supplier_conversations to authenticated;
grant select, insert, update on table public.supplier_tags to authenticated;
-- Join tables are insert-only for authenticated (immutable relationship rows).
grant select, insert on table public.supplier_conversation_tags to authenticated;
grant select, insert, update on table public.supplier_insights to authenticated;
grant select, insert on table public.supplier_insight_tags to authenticated;
grant select, insert, update on table public.supplier_follow_ups to authenticated;

-- Admin may maintain reference types (no ordinary create/edit).
grant insert, update on table public.supplier_organization_types to authenticated;

-- service_role: full access including ai_jobs
grant all on table public.supplier_organization_types to service_role;
grant all on table public.supplier_organizations to service_role;
grant all on table public.supplier_organization_type_links to service_role;
grant all on table public.supplier_organization_locations to service_role;
grant all on table public.supplier_people to service_role;
grant all on table public.supplier_person_organization_links to service_role;
grant all on table public.supplier_conversations to service_role;
grant all on table public.supplier_tags to service_role;
grant all on table public.supplier_conversation_tags to service_role;
grant all on table public.supplier_insights to service_role;
grant all on table public.supplier_insight_tags to service_role;
grant all on table public.supplier_follow_ups to service_role;
grant all on table public.supplier_ai_jobs to service_role;

-- NOTE: supplier_ai_jobs intentionally has NO grant to authenticated/anon.


-- ---- RLS policies: organization_types (read permitted; write admin) ----

drop policy if exists supplier_organization_types_select_permitted
  on public.supplier_organization_types;
create policy supplier_organization_types_select_permitted
  on public.supplier_organization_types
  for select
  to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_organization_types_insert_admin
  on public.supplier_organization_types;
create policy supplier_organization_types_insert_admin
  on public.supplier_organization_types
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists supplier_organization_types_update_admin
  on public.supplier_organization_types;
create policy supplier_organization_types_update_admin
  on public.supplier_organization_types
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ---- Generic policy applicator for shared business tables ----
-- Tables with SELECT/INSERT/UPDATE under supplier_intelligence.

-- supplier_organizations
drop policy if exists supplier_organizations_select_permitted
  on public.supplier_organizations;
create policy supplier_organizations_select_permitted
  on public.supplier_organizations for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_organizations_insert_permitted
  on public.supplier_organizations;
create policy supplier_organizations_insert_permitted
  on public.supplier_organizations for insert to authenticated
  with check (public.has_module_action('supplier_intelligence', 'create'));

drop policy if exists supplier_organizations_update_permitted
  on public.supplier_organizations;
create policy supplier_organizations_update_permitted
  on public.supplier_organizations for update to authenticated
  using (public.has_module_action('supplier_intelligence', 'edit'))
  with check (public.has_module_action('supplier_intelligence', 'edit'));

-- supplier_organization_type_links
drop policy if exists supplier_organization_type_links_select_permitted
  on public.supplier_organization_type_links;
create policy supplier_organization_type_links_select_permitted
  on public.supplier_organization_type_links for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_organization_type_links_insert_permitted
  on public.supplier_organization_type_links;
create policy supplier_organization_type_links_insert_permitted
  on public.supplier_organization_type_links for insert to authenticated
  with check (public.has_module_action('supplier_intelligence', 'create'));

drop policy if exists supplier_organization_type_links_update_permitted
  on public.supplier_organization_type_links;
create policy supplier_organization_type_links_update_permitted
  on public.supplier_organization_type_links for update to authenticated
  using (public.has_module_action('supplier_intelligence', 'edit'))
  with check (public.has_module_action('supplier_intelligence', 'edit'));

-- supplier_organization_locations
drop policy if exists supplier_organization_locations_select_permitted
  on public.supplier_organization_locations;
create policy supplier_organization_locations_select_permitted
  on public.supplier_organization_locations for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_organization_locations_insert_permitted
  on public.supplier_organization_locations;
create policy supplier_organization_locations_insert_permitted
  on public.supplier_organization_locations for insert to authenticated
  with check (public.has_module_action('supplier_intelligence', 'create'));

drop policy if exists supplier_organization_locations_update_permitted
  on public.supplier_organization_locations;
create policy supplier_organization_locations_update_permitted
  on public.supplier_organization_locations for update to authenticated
  using (public.has_module_action('supplier_intelligence', 'edit'))
  with check (public.has_module_action('supplier_intelligence', 'edit'));

-- supplier_people
drop policy if exists supplier_people_select_permitted
  on public.supplier_people;
create policy supplier_people_select_permitted
  on public.supplier_people for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_people_insert_permitted
  on public.supplier_people;
create policy supplier_people_insert_permitted
  on public.supplier_people for insert to authenticated
  with check (public.has_module_action('supplier_intelligence', 'create'));

drop policy if exists supplier_people_update_permitted
  on public.supplier_people;
create policy supplier_people_update_permitted
  on public.supplier_people for update to authenticated
  using (public.has_module_action('supplier_intelligence', 'edit'))
  with check (public.has_module_action('supplier_intelligence', 'edit'));

-- supplier_person_organization_links
drop policy if exists supplier_person_organization_links_select_permitted
  on public.supplier_person_organization_links;
create policy supplier_person_organization_links_select_permitted
  on public.supplier_person_organization_links for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_person_organization_links_insert_permitted
  on public.supplier_person_organization_links;
create policy supplier_person_organization_links_insert_permitted
  on public.supplier_person_organization_links for insert to authenticated
  with check (public.has_module_action('supplier_intelligence', 'create'));

drop policy if exists supplier_person_organization_links_update_permitted
  on public.supplier_person_organization_links;
create policy supplier_person_organization_links_update_permitted
  on public.supplier_person_organization_links for update to authenticated
  using (public.has_module_action('supplier_intelligence', 'edit'))
  with check (public.has_module_action('supplier_intelligence', 'edit'));

-- supplier_conversations
drop policy if exists supplier_conversations_select_permitted
  on public.supplier_conversations;
create policy supplier_conversations_select_permitted
  on public.supplier_conversations for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_conversations_insert_permitted
  on public.supplier_conversations;
create policy supplier_conversations_insert_permitted
  on public.supplier_conversations for insert to authenticated
  with check (
    public.has_module_action('supplier_intelligence', 'create')
    and logged_by_user_id = auth.uid()
  );

drop policy if exists supplier_conversations_update_permitted
  on public.supplier_conversations;
create policy supplier_conversations_update_permitted
  on public.supplier_conversations for update to authenticated
  using (public.has_module_action('supplier_intelligence', 'edit'))
  with check (public.has_module_action('supplier_intelligence', 'edit'));

-- supplier_tags
drop policy if exists supplier_tags_select_permitted
  on public.supplier_tags;
create policy supplier_tags_select_permitted
  on public.supplier_tags for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_tags_insert_permitted
  on public.supplier_tags;
create policy supplier_tags_insert_permitted
  on public.supplier_tags for insert to authenticated
  with check (public.has_module_action('supplier_intelligence', 'create'));

drop policy if exists supplier_tags_update_permitted
  on public.supplier_tags;
create policy supplier_tags_update_permitted
  on public.supplier_tags for update to authenticated
  using (public.has_module_action('supplier_intelligence', 'edit'))
  with check (public.has_module_action('supplier_intelligence', 'edit'));

-- supplier_conversation_tags (immutable join rows: SELECT + INSERT only)
drop policy if exists supplier_conversation_tags_select_permitted
  on public.supplier_conversation_tags;
create policy supplier_conversation_tags_select_permitted
  on public.supplier_conversation_tags for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_conversation_tags_insert_permitted
  on public.supplier_conversation_tags;
create policy supplier_conversation_tags_insert_permitted
  on public.supplier_conversation_tags for insert to authenticated
  with check (public.has_module_action('supplier_intelligence', 'create'));

-- No authenticated UPDATE/DELETE on conversation↔tag joins.
drop policy if exists supplier_conversation_tags_update_permitted
  on public.supplier_conversation_tags;

-- supplier_insights
drop policy if exists supplier_insights_select_permitted
  on public.supplier_insights;
create policy supplier_insights_select_permitted
  on public.supplier_insights for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_insights_insert_permitted
  on public.supplier_insights;
create policy supplier_insights_insert_permitted
  on public.supplier_insights for insert to authenticated
  with check (public.has_module_action('supplier_intelligence', 'create'));

drop policy if exists supplier_insights_update_permitted
  on public.supplier_insights;
create policy supplier_insights_update_permitted
  on public.supplier_insights for update to authenticated
  using (public.has_module_action('supplier_intelligence', 'edit'))
  with check (public.has_module_action('supplier_intelligence', 'edit'));

-- supplier_insight_tags (immutable join rows: SELECT + INSERT only)
drop policy if exists supplier_insight_tags_select_permitted
  on public.supplier_insight_tags;
create policy supplier_insight_tags_select_permitted
  on public.supplier_insight_tags for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_insight_tags_insert_permitted
  on public.supplier_insight_tags;
create policy supplier_insight_tags_insert_permitted
  on public.supplier_insight_tags for insert to authenticated
  with check (public.has_module_action('supplier_intelligence', 'create'));

-- No authenticated UPDATE/DELETE on insight↔tag joins.
drop policy if exists supplier_insight_tags_update_permitted
  on public.supplier_insight_tags;

-- supplier_follow_ups
drop policy if exists supplier_follow_ups_select_permitted
  on public.supplier_follow_ups;
create policy supplier_follow_ups_select_permitted
  on public.supplier_follow_ups for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_follow_ups_insert_permitted
  on public.supplier_follow_ups;
create policy supplier_follow_ups_insert_permitted
  on public.supplier_follow_ups for insert to authenticated
  with check (public.has_module_action('supplier_intelligence', 'create'));

drop policy if exists supplier_follow_ups_update_permitted
  on public.supplier_follow_ups;
create policy supplier_follow_ups_update_permitted
  on public.supplier_follow_ups for update to authenticated
  using (public.has_module_action('supplier_intelligence', 'edit'))
  with check (public.has_module_action('supplier_intelligence', 'edit'));

-- supplier_ai_jobs: RLS enabled, ZERO policies for authenticated/anon.
-- service_role bypasses RLS. No SELECT/INSERT/UPDATE/DELETE for browser clients.


-- ----------------------------------------------------------
-- PART H — search notes (deferred; no extension changes)
--
-- ERP migrations currently do not enable pg_trgm or FTS.
-- This foundation intentionally does NOT:
--   - create extension pg_trgm
--   - add tsvector / GIN FTS columns
--   - add vector embeddings
--
-- Initial search should use:
--   - btree indexes on name / occurred_at / FKs (created above)
--   - application ILIKE / filtered queries with pagination
--
-- A later additive migration may add Supplier-only trigram/FTS
-- after explicit approval (Hindi/Hinglish considerations).
-- ----------------------------------------------------------


-- ==========================================================
-- MANUAL ROLLBACK (comments only — do not auto-run)
-- Affects ONLY supplier_* objects. Safe for Transport.
--
-- Order (after confirming no dependent app code):
--
--   drop trigger if exists supplier_person_organization_links_validate_location
--     on public.supplier_person_organization_links;
--   drop trigger if exists supplier_conversations_audit
--     on public.supplier_conversations;
--   drop trigger if exists supplier_insight_tags_created_by
--     on public.supplier_insight_tags;
--   drop trigger if exists supplier_conversation_tags_created_by
--     on public.supplier_conversation_tags;
--   -- also drop *_audit_fields triggers on each supplier_* table
--
--   drop table if exists public.supplier_ai_jobs cascade;
--   drop table if exists public.supplier_insight_tags cascade;
--   drop table if exists public.supplier_conversation_tags cascade;
--   drop table if exists public.supplier_follow_ups cascade;
--   drop table if exists public.supplier_insights cascade;
--   drop table if exists public.supplier_tags cascade;
--   drop table if exists public.supplier_conversations cascade;
--   drop table if exists public.supplier_person_organization_links cascade;
--   drop table if exists public.supplier_people cascade;
--   drop table if exists public.supplier_organization_locations cascade;
--   drop table if exists public.supplier_organization_type_links cascade;
--   drop table if exists public.supplier_organizations cascade;
--   drop table if exists public.supplier_organization_types cascade;
--
--   drop function if exists public.supplier_validate_person_org_link_location();
--   drop function if exists public.supplier_set_conversation_audit();
--   drop function if exists public.supplier_set_row_created_by();
--   drop function if exists public.supplier_set_row_audit_fields();
--
-- App follow-up: hide Supplier UI / permission usage if fully rolled back.
-- ==========================================================
-- END 067_supplier_foundation
-- ==========================================================
