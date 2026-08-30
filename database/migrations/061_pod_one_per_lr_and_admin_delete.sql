-- ==========================================================
-- Migration: 061_pod_one_per_lr_and_admin_delete
-- Module:    POD — UNIQUE(lr_number) + Admin delete (+ storage delete)
--
-- NOT applied automatically. Apply ONLY after:
--   1) 060 exact-duplicate cleanup has run
--   2) All MANUAL_REVIEW same-LR rows were resolved by you
--   3) This returns zero rows:
--        select lr_number, count(*) from public.pods
--        group by lr_number having count(*) > 1;
--
-- Do NOT apply this migration while LR19335 (or any LR) still has
-- multiple materially different POD rows.
--
-- CHANGES:
--   1) UNIQUE index on public.pods(lr_number)
--      Enforces at most one POD per LR at the database level.
--      Column is `lr_number` (text) — there is no lr_id FK on pods.
--
--   2) DELETE RLS on public.pods → public.is_admin()
--      Matches AuthProvider `isAdmin` (Creator OR Tier 1 / role=admin).
--      Replaces creator-only DELETE from migration 048 for POD only.
--      Other modules remain creator-only per 048.
--
--   3) Storage DELETE policy on bucket pod-assets for is_admin()
--      Enables Admin `deletePod()` to remove the proof object when the
--      public URL maps into this bucket. Application code only removes
--      the path derived from that POD's proof_url.
--
-- PREREQUISITE:
--   No duplicate lr_number values in public.pods.
--   Verify:
--     select lr_number, count(*) from public.pods
--     group by lr_number having count(*) > 1;
--
-- RLS / SECURITY IMPACT:
--   - Non-admin authenticated users cannot DELETE pods (RLS deny).
--   - Staff create/update policies unchanged.
--   - Storage DELETE limited to is_admin() + pod-assets bucket.
--
-- PERFORMANCE:
--   Unique index on lr_number also accelerates "does POD exist for LR?"
--   eligibility checks. Existing non-unique idx_pods_lr_number remains
--   harmless; unique index is the authority for uniqueness.
--
-- STORAGE IMPACT:
--   Policy only; no bulk file deletion.
--
-- ROLLBACK (manual):
--   drop index if exists public.pods_lr_number_unique;
--   -- restore prior delete policy (creator-only) if desired:
--   drop policy if exists pods_delete_admin_only on public.pods;
--   create policy pods_delete_creator_only on public.pods
--     for delete to authenticated using (public.is_creator());
--   drop policy if exists "pod-assets delete (admin)" on storage.objects;
-- ==========================================================

-- Fail fast if duplicates still exist.
do $$
declare
  v_dupes integer;
begin
  select count(*)::integer
  into v_dupes
  from (
    select lr_number
    from public.pods
    group by lr_number
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception
      'Cannot add pods_lr_number_unique: % duplicate lr_number group(s) remain. Apply 060_pod_duplicate_cleanup first.',
      v_dupes;
  end if;
end;
$$;

create unique index if not exists pods_lr_number_unique
  on public.pods (lr_number);

comment on index public.pods_lr_number_unique is
  'At most one POD per LR number. Apply only after duplicate cleanup (060).';

-- Admin DELETE (Creator + Tier 1), matching frontend isAdmin.
drop policy if exists pods_delete_admin_only on public.pods;
drop policy if exists pods_delete_creator_only on public.pods;
drop policy if exists pods_delete_permitted on public.pods;
drop policy if exists pods_delete on public.pods;

create policy pods_delete_admin_only
  on public.pods
  for delete
  to authenticated
  using (public.is_admin());

-- Storage cleanup for Admin POD delete.
drop policy if exists "pod-assets delete (admin)" on storage.objects;
create policy "pod-assets delete (admin)"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'pod-assets'
    and public.is_admin()
  );
