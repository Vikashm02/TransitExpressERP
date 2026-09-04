-- ============================================================
-- 068_supplier_insight_category_and_sources.sql
-- ADDITIVE ONLY. Does not modify 067.
-- supplier_conversations remain immutable source of truth.
-- No AI / OpenAI / supplier_ai_jobs changes.
--
-- OUT OF SCOPE FOR 068:
--   - insight lifecycle status
--   - soft delete
--   - organization_id / person_id on supplier_insights
--   - insight → follow_up FK
--   - dropping / nulling legacy supplier_insights.conversation_id
--   - DB trigger enforcing multi-source same-organization
--
-- APPLICATION INVARIANT (dual-write phase, enforced in service layer):
--   All supplier_insight_sources.conversation_id rows attached to one
--   insight MUST belong to the same supplier_organizations id
--   (via supplier_conversations.organization_id). Multi-org provenance
--   is not permitted until a later explicit schema decision.
-- ============================================================

begin;

-- ----------------------------------------------------------
-- PART A — category on supplier_insights (backward-safe)
-- ----------------------------------------------------------

alter table public.supplier_insights
  add column if not exists category text;

comment on column public.supplier_insights.category is
  'Product intelligence bucket (distinct from scope). '
  'positive_signal | concern | opportunity | expectation | commitment | '
  'competitor | market_observation | relationship | operational | '
  'commercial | other. Not used for executive summary rollups. '
  'Writers must supply category explicitly (no permanent column default).';

-- Preserve existing rows: classify unknown historical data as other.
update public.supplier_insights
set category = 'other'
where category is null;

-- No permanent DEFAULT: with no current app writers this is safe;
-- future inserts must provide category explicitly.
alter table public.supplier_insights
  alter column category drop default;

alter table public.supplier_insights
  alter column category set not null;

alter table public.supplier_insights
  drop constraint if exists supplier_insights_category_check;

alter table public.supplier_insights
  add constraint supplier_insights_category_check
  check (
    category in (
      'positive_signal',
      'concern',
      'opportunity',
      'expectation',
      'commitment',
      'competitor',
      'market_observation',
      'relationship',
      'operational',
      'commercial',
      'other'
    )
  );

create index if not exists supplier_insights_category_idx
  on public.supplier_insights (category);

create index if not exists supplier_insights_review_status_idx
  on public.supplier_insights (review_status)
  where review_status is not null;

-- Legacy supplier_insights.conversation_id remains NOT NULL (unchanged).

-- ----------------------------------------------------------
-- PART B — multi-source provenance (additive)
-- ----------------------------------------------------------

create table if not exists public.supplier_insight_sources (
  insight_id uuid not null
    references public.supplier_insights (id) on delete cascade,
  conversation_id uuid not null
    references public.supplier_conversations (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  primary key (insight_id, conversation_id)
);

comment on table public.supplier_insight_sources is
  'M:N provenance: insight supported by one or more conversations. '
  'During dual-write, every insight must include at least the legacy '
  'supplier_insights.conversation_id as a source row. '
  'App invariant: all source conversations for one insight must share '
  'the same organization_id. No DB org-integrity trigger in 068.';

-- conversation → insights lookups (PK already covers insight_id-leading access)
create index if not exists supplier_insight_sources_conversation_idx
  on public.supplier_insight_sources (conversation_id);

-- Backfill provenance from legacy conversation_id (preserves all existing links)
insert into public.supplier_insight_sources (insight_id, conversation_id, created_by)
select i.id, i.conversation_id, i.created_by
from public.supplier_insights i
where i.conversation_id is not null
on conflict (insight_id, conversation_id) do nothing;

-- Force created_by from auth.uid() on authenticated INSERT (blocks spoofing).
-- During this migration backfill, auth.uid() is null so SELECT created_by is kept.
drop trigger if exists supplier_insight_sources_created_by
  on public.supplier_insight_sources;
create trigger supplier_insight_sources_created_by
  before insert on public.supplier_insight_sources
  for each row
  execute function public.supplier_set_row_created_by();

-- ----------------------------------------------------------
-- PART C — privileges + RLS
-- ----------------------------------------------------------

alter table public.supplier_insight_sources enable row level security;

revoke all on table public.supplier_insight_sources
  from public, anon, authenticated;

grant select, insert on table public.supplier_insight_sources to authenticated;
grant all on table public.supplier_insight_sources to service_role;

drop policy if exists supplier_insight_sources_select_permitted
  on public.supplier_insight_sources;
create policy supplier_insight_sources_select_permitted
  on public.supplier_insight_sources for select to authenticated
  using (public.has_permission('supplier_intelligence', 'view'));

drop policy if exists supplier_insight_sources_insert_permitted
  on public.supplier_insight_sources;
create policy supplier_insight_sources_insert_permitted
  on public.supplier_insight_sources for insert to authenticated
  with check (public.has_module_action('supplier_intelligence', 'create'));

-- No authenticated UPDATE or DELETE on provenance join rows.
-- supplier_ai_jobs remains service_role-only (unchanged by 068).

commit;

-- ============================================================
-- MANUAL ROLLBACK (comments only — do not auto-run)
--
--   drop trigger if exists supplier_insight_sources_created_by
--     on public.supplier_insight_sources;
--   drop policy if exists supplier_insight_sources_insert_permitted
--     on public.supplier_insight_sources;
--   drop policy if exists supplier_insight_sources_select_permitted
--     on public.supplier_insight_sources;
--   drop table if exists public.supplier_insight_sources;
--   drop index if exists public.supplier_insights_review_status_idx;
--   drop index if exists public.supplier_insights_category_idx;
--   alter table public.supplier_insights
--     drop constraint if exists supplier_insights_category_check;
--   alter table public.supplier_insights
--     drop column if exists category;
-- ============================================================
