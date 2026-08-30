-- ==========================================================
-- Migration: 060_pod_duplicate_cleanup
-- Module:    POD — delete EXACT duplicates only (safe)
--
-- NOT applied automatically. Review carefully, then run in Supabase.
--
-- ==========================================================
-- CLASSIFICATION LOGIC
-- ==========================================================
--
-- Exact-duplicate fingerprint (all must match):
--   • trim(lr_number)
--   • pod_date
--   • unloading_weight
--   • unloading_date
--   • coalesce(nullif(trim(proof_url), ''), '')
--
-- Within each fingerprint cluster that has 2+ rows:
--   KEEP  = earliest created_at, then lowest id  (CANONICAL)
--   DELETE = all other rows in that exact cluster
--
-- If the same LR still has 2+ rows AFTER or AFTER that cleanup
-- (different proof_url and/or materially different POD fields):
--   those remaining rows are MANUAL_REVIEW — never auto-deleted.
--
-- Example LR19335:
--   ID 3  → KEEP (canonical of the exact cluster)
--   ID 4–7 → DELETE_EXACT_DUPLICATE (same data + same proof as ID 3)
--   ID 10 → MANUAL_REVIEW (different proof_url / pod_date / creator)
--
-- This migration:
--   1) Commits deletion of exact duplicates only.
--   2) Then RAISE EXCEPTION if any lr_number still has count(*) > 1,
--      so you do NOT proceed to 061 until MANUAL_REVIEW rows are
--      resolved by you.
--
-- AFFECTED TABLE: public.pods (row deletes only)
-- STORAGE: does NOT delete storage objects (exact-dup rows share the
--   same proof_url as the kept row, so the file must stay).
-- RLS / SECURITY: no policy changes.
--
-- SEQUENCE:
--   1. Run REVIEW QUERY below
--   2. Apply this migration (exact dups deleted; aborts if MANUAL_REVIEW remains)
--   3. Manually resolve MANUAL_REVIEW rows (e.g. ID 10)
--   4. Re-run review until zero duplicate lr_numbers
--   5. Apply 061 (unique + admin delete)
--
-- ROLLBACK: deletes are permanent without backup/PITR. Export first if unsure.
--
-- ==========================================================
-- REVIEW QUERY — run BEFORE applying
-- ==========================================================
--
-- with dupe_lrs as (
--   select trim(lr_number) as lr_key
--   from public.pods
--   group by trim(lr_number)
--   having count(*) > 1
-- ),
-- fingerprinted as (
--   select
--     p.*,
--     trim(p.lr_number) as lr_key,
--     (
--       trim(p.lr_number)
--       || '|' || coalesce(p.pod_date::text, '')
--       || '|' || coalesce(p.unloading_weight::text, '')
--       || '|' || coalesce(p.unloading_date::text, '')
--       || '|' || coalesce(nullif(trim(p.proof_url), ''), '')
--     ) as fingerprint
--   from public.pods p
--   join dupe_lrs d on d.lr_key = trim(p.lr_number)
-- ),
-- ranked as (
--   select
--     f.*,
--     row_number() over (
--       partition by f.fingerprint
--       order by f.created_at asc, f.id asc
--     ) as rn_in_fingerprint,
--     count(*) over (partition by f.fingerprint) as fingerprint_count,
--     count(distinct f.fingerprint) over (partition by f.lr_key) as fingerprints_on_lr
--   from fingerprinted f
-- )
-- select
--   id,
--   lr_number,
--   created_at,
--   updated_at,
--   pod_date,
--   unloading_weight,
--   unloading_date,
--   proof_url,
--   created_by,
--   updated_by,
--   case
--     when fingerprints_on_lr > 1 and rn_in_fingerprint = 1
--       then 'MANUAL_REVIEW'
--     when fingerprint_count > 1 and rn_in_fingerprint = 1
--       then 'KEEP'
--     when fingerprint_count > 1 and rn_in_fingerprint > 1
--       then 'DELETE_EXACT_DUPLICATE'
--     when fingerprints_on_lr > 1
--       then 'MANUAL_REVIEW'
--     else 'KEEP'
--   end as classification
-- from ranked
-- order by lr_number, fingerprint, rn_in_fingerprint;
--
-- Notes on classification when an LR has multiple fingerprints:
--   The canonical row of each exact cluster is marked MANUAL_REVIEW
--   (including the earliest exact cluster), because the LR still needs
--   a human decision before UNIQUE(lr_number) can be applied.
--   Exact extras in a cluster remain DELETE_EXACT_DUPLICATE.
-- ==========================================================

-- ----------------------------------------------------------
-- Step 1: delete EXACT duplicates only (commit persists)
-- ----------------------------------------------------------
begin;

with fingerprinted as (
  select
    p.id,
    (
      trim(p.lr_number)
      || '|' || coalesce(p.pod_date::text, '')
      || '|' || coalesce(p.unloading_weight::text, '')
      || '|' || coalesce(p.unloading_date::text, '')
      || '|' || coalesce(nullif(trim(p.proof_url), ''), '')
    ) as fingerprint,
    p.created_at
  from public.pods p
),
ranked as (
  select
    f.id,
    row_number() over (
      partition by f.fingerprint
      order by f.created_at asc, f.id asc
    ) as rn,
    count(*) over (partition by f.fingerprint) as fingerprint_count
  from fingerprinted f
),
deleted as (
  delete from public.pods p
  using ranked r
  where p.id = r.id
    and r.fingerprint_count > 1
    and r.rn > 1
  returning p.id
)
select count(*)::integer as exact_duplicates_deleted
from deleted;

commit;

-- ----------------------------------------------------------
-- Step 2: abort if any LR still has multiple POD rows
-- (exact cleanup is already committed above)
-- ----------------------------------------------------------
do $$
declare
  v_remaining integer;
  v_sample text;
begin
  select count(*)::integer
  into v_remaining
  from (
    select trim(lr_number) as lr_key
    from public.pods
    group by trim(lr_number)
    having count(*) > 1
  ) x;

  if v_remaining > 0 then
    select string_agg(lr_key, ', ' order by lr_key)
    into v_sample
    from (
      select trim(lr_number) as lr_key
      from public.pods
      group by trim(lr_number)
      having count(*) > 1
      order by lr_key
      limit 20
    ) s;

    raise exception
      '060 exact-duplicate cleanup finished, but % LR number(s) still have multiple POD rows that are NOT exact duplicates (MANUAL_REVIEW). Do NOT apply 061 until resolved. Examples: %. Re-run the REVIEW QUERY in this file.',
      v_remaining,
      coalesce(v_sample, '(none)');
  end if;

  raise notice '060 complete: no remaining duplicate lr_number groups. Safe to apply 061 after a final review query.';
end;
$$;
