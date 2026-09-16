-- Canonical Material Master + recommended descriptions.
-- Review and apply manually. This migration never updates public.lrs and never
-- changes transport_bids.material_id; legacy material rows remain present.
begin;

alter table public.materials
  add column if not exists canonical_material_id bigint references public.materials(id) on delete restrict;

create index if not exists idx_materials_canonical_material_id
  on public.materials(canonical_material_id);

create table if not exists public.material_descriptions (
  id bigint generated always as identity primary key,
  material_id bigint not null references public.materials(id) on delete restrict,
  description text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(description) <> '')
);

create index if not exists idx_material_descriptions_lookup
  on public.material_descriptions(material_id, active, sort_order, id);

create unique index if not exists material_descriptions_normalized_active_unique
  on public.material_descriptions(material_id, lower(btrim(description)))
  where active;

create or replace function public.set_material_descriptions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_material_descriptions_updated_at on public.material_descriptions;
create trigger trg_material_descriptions_updated_at
before update on public.material_descriptions
for each row execute function public.set_material_descriptions_updated_at();

alter table public.material_descriptions enable row level security;

drop policy if exists material_descriptions_select on public.material_descriptions;
drop policy if exists material_descriptions_insert on public.material_descriptions;
drop policy if exists material_descriptions_update on public.material_descriptions;
drop policy if exists material_descriptions_delete on public.material_descriptions;

create policy material_descriptions_select on public.material_descriptions
for select to authenticated
using (public.has_permission('material', 'view'));

create policy material_descriptions_insert on public.material_descriptions
for insert to authenticated
with check (public.has_permission('material', 'create_view'));

create policy material_descriptions_update on public.material_descriptions
for update to authenticated
using (public.has_permission('material', 'edit'))
with check (public.has_permission('material', 'edit'));

create policy material_descriptions_delete on public.material_descriptions
for delete to authenticated
using (public.is_creator());

grant select, insert, update, delete on table public.material_descriptions to authenticated;
grant usage, select on sequence public.material_descriptions_id_seq to authenticated;

-- Approved RDF description classifications. These source rows have Material
-- Name = RDF, but their DESCRIPTION belongs under the separate canonical
-- SHREDDED RDF or UNSHREDDED RDF material. This is an explicit allowlist,
-- never fuzzy matching. A metadata mismatch leaves the row untouched.
with approved_rdf_descriptions (description_name, canonical_name) as (
  values
    ('shredded rdf', 'shredded rdf'),
    ('shreded rdf', 'shredded rdf'),
    ('shredded rdf from msw', 'shredded rdf'),
    ('shredded rdf from msw.', 'shredded rdf'),
    ('shredded rdf from msw. 32ft trailer', 'shredded rdf'),
    ('rdf - segregated & shredded rdf afmmsw shredded rdf', 'shredded rdf'),
    ('unshredded rdf', 'unshredded rdf'),
    ('unshreded rdf', 'unshredded rdf')
), canonical_rows as (
  select distinct on (lower(btrim(m.material_name)))
    lower(btrim(m.material_name)) as canonical_name,
    m.id,
    coalesce(btrim(m.category), '') as category,
    coalesce(btrim(m.hsn_code), '') as hsn_code,
    coalesce(btrim(m.unit), '') as unit,
    coalesce(m.gst_percentage, 0) as gst_percentage
  from public.materials m
  where m.canonical_material_id is null
  order by lower(btrim(m.material_name)), (m.status = 'Active') desc, m.id asc
), approved_rdf_legacy as (
  select legacy.id, canonical.id as canonical_id
  from public.materials legacy
  join approved_rdf_descriptions approved
    on lower(btrim(legacy.description)) = approved.description_name
  join canonical_rows canonical
    on canonical.canonical_name = approved.canonical_name
   and canonical.category = coalesce(btrim(legacy.category), '')
   and canonical.hsn_code = coalesce(btrim(legacy.hsn_code), '')
   and canonical.unit = coalesce(btrim(legacy.unit), '')
   and canonical.gst_percentage = coalesce(legacy.gst_percentage, 0)
  where lower(btrim(legacy.material_name)) = 'rdf'
    and legacy.canonical_material_id is null
    and legacy.id <> canonical.id
)
update public.materials legacy
set canonical_material_id = approved_rdf_legacy.canonical_id,
    status = 'Inactive'
from approved_rdf_legacy
where legacy.id = approved_rdf_legacy.id;

-- All remaining same-name duplicate groups map only when every material-level
-- business attribute agrees. Similar names never merge automatically.
with grouped as (
  select
    lower(btrim(m.material_name)) as normalized_name,
    (array_agg(m.id order by (m.status = 'Active') desc, m.id asc))[1] as canonical_id,
    count(*) as name_count,
    count(distinct (
      coalesce(btrim(m.category), ''),
      coalesce(btrim(m.hsn_code), ''),
      coalesce(btrim(m.unit), ''),
      coalesce(m.gst_percentage, 0)
    )) as metadata_count
  from public.materials m
  where m.canonical_material_id is null
  group by lower(btrim(m.material_name))
), ranked as (
  select m.id, g.canonical_id, g.name_count, g.metadata_count
  from public.materials m
  join grouped g on g.normalized_name = lower(btrim(m.material_name))
  where m.canonical_material_id is null
)
update public.materials legacy
set canonical_material_id = ranked.canonical_id,
    status = 'Inactive'
from ranked
where legacy.id = ranked.id
  and ranked.name_count > 1
  and ranked.metadata_count = 1
  and ranked.id <> ranked.canonical_id;

-- A newly created canonical material may retain the existing master
-- description field as its first recommendation. Later edits are managed in
-- material_descriptions so an LR never creates master data implicitly.
create or replace function public.seed_material_description_from_material()
returns trigger language plpgsql as $$
begin
  if btrim(coalesce(new.description, '')) <> '' then
    insert into public.material_descriptions (material_id, description, active, sort_order)
    values (new.id, btrim(new.description), true, 0)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_material_seed_description on public.materials;
create trigger trg_material_seed_description
after insert on public.materials
for each row execute function public.seed_material_description_from_material();

-- Preserve every existing non-empty master description as a recommendation.
-- Mapped legacy rows contribute their wording to the mapped canonical material.
insert into public.material_descriptions (material_id, description, active, sort_order)
select recommendations.material_id, recommendations.description, true, 0
from (
  -- Keep one deterministic active recommendation for casing-only duplicates.
  -- The legacy source rows remain intact for audit and Bid compatibility.
  select distinct on (
    coalesce(m.canonical_material_id, m.id),
    lower(btrim(m.description))
  )
    coalesce(m.canonical_material_id, m.id) as material_id,
    btrim(m.description) as description
  from public.materials m
  where btrim(coalesce(m.description, '')) <> ''
  order by
    coalesce(m.canonical_material_id, m.id),
    lower(btrim(m.description)),
    (m.id = coalesce(m.canonical_material_id, m.id)) desc,
    m.id asc
) recommendations
on conflict do nothing;

-- LR lookup intentionally returns only active canonical records. Historical LRs
-- store text snapshots and are not read or updated by this migration.
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
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not (public.has_permission('lr', 'create_view') or public.has_permission('lr', 'edit')) then
    raise exception 'Not permitted to look up materials for LR entry';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'material_code', m.material_code,
    'material_name', m.material_name,
    'category', coalesce(m.category, ''),
    'unit', coalesce(m.unit, ''),
    'description', coalesce(m.description, ''),
    'recommended_descriptions', coalesce(d.descriptions, '[]'::jsonb),
    'status', m.status
  ) order by m.material_name asc, m.id asc), '[]'::jsonb)
  into v_rows
  from public.materials m
  left join lateral (
    select jsonb_agg(md.description order by md.sort_order asc, md.id asc) as descriptions
    from public.material_descriptions md
    where md.material_id = m.id and md.active = true
  ) d on true
  where m.canonical_material_id is null and m.status = 'Active';

  return v_rows;
end;
$$;

revoke all on function public.get_lr_material_lookup() from public;
grant execute on function public.get_lr_material_lookup() to authenticated;

comment on column public.materials.canonical_material_id is
  'Nullable compatibility mapping from a retained legacy duplicate material to its canonical material.';
comment on table public.material_descriptions is
  'Recommended wording under canonical Material Master records; LR descriptions remain free-text snapshots.';

commit;
