-- ==========================================================
-- Migration: 021_remove_assignment_access_restrictions
-- Module:    Staff / Sub-User Access Control (follow-up to 019, 020)
--
-- Reference: lib/permissions.ts
--            database/migrations/019_add_staff_permissions.sql
--            database/migrations/020_fix_permission_capability_model.sql
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- against the target Supabase project. Migrations 001-020 are
-- untouched; this is purely additive (RLS policy replacements only —
-- no columns, tables, triggers, or data are touched).
--
-- Why this is needed:
--   `lrs` and `pods` RLS (introduced in migration 017, permission
--   checks layered on in migration 019) required BOTH:
--     (a) `assigned_to = auth.uid()` (or, for pods, the related LR's
--         `assigned_to = auth.uid()`), AND
--     (b) the relevant `has_permission()` check.
--   That meant a staff member could have `lr = edit` / `pod = edit`
--   and still be unable to see or modify a record simply because an
--   admin had assigned it to someone else. Per the intended design,
--   record assignment (`assigned_to`, the Reassign feature) is
--   informational/organizational only — it should NOT gate access.
--   Only the per-module permission level should.
--
-- What this changes:
--   ONLY the `using` / `with check` clauses of the RLS policies on
--   `lrs` and `pods` that currently AND an ownership condition
--   together with a `has_permission()` check. The ownership
--   condition is dropped from every one of them; the
--   `has_permission()` check (already fixed to the correct
--   capability model by migration 020) is kept as the sole gate.
--   Policy names are kept identical to 017/019 (drop + recreate in
--   place, same pattern those migrations already used) so this is a
--   pure behavior change, not a rename.
--
--   `lrs_insert_authenticated` already had no ownership condition
--   (`with check (public.has_permission('lr', 'create_view'))` in
--   migration 019) — it is NOT touched here, it already matches the
--   desired behavior.
--
-- What is explicitly preserved / NOT changed:
--   - `public.has_permission()` (migration 020) — untouched.
--   - `public.is_admin()` — untouched; admin bypass is preserved
--     because `has_permission()` itself already returns `true` for
--     admins, so every policy below still grants admins full access.
--   - Locked-account / non-approved-account denial — untouched;
--     enforced inside `has_permission()`, which every policy below
--     still calls.
--   - `full_access` behavior — untouched; also enforced inside
--     `has_permission()`.
--   - The `lrs.assigned_to` / `lrs.created_by` columns — untouched,
--     not dropped, still populated by the existing
--     `lrs_enforce_ownership()` trigger (migration 017), which is
--     also untouched. Reassign continues to work exactly as before;
--     it simply no longer doubles as an access-control mechanism.
--   - `lorry_expenses` RLS — deliberately left untouched. Its
--     `..._own_lr_or_admin` policies (migration 017) are ownership
--     gated but were never wired to `has_permission()` in the first
--     place (migration 019 explicitly scoped it out — see that
--     file's header). Since it isn't part of the
--     `has_permission()`-governed permission architecture, removing
--     its ownership check is a separate, out-of-scope architectural
--     decision, not a bug fix within this system.
--   - `bills` / `bill_lrs` / `credit_notes` / `debit_notes` /
--     `billing_parties` / `customers` / `vehicles` / `company` — none
--     of these have row level security at all (confirmed by
--     inspection of every migration file); there is no ownership
--     restriction on them to remove.
-- ==========================================================


-- ==========================================================
-- PART A — lrs: drop assigned_to from SELECT / UPDATE
-- ==========================================================

drop policy if exists lrs_select_own_or_admin on public.lrs;

create policy lrs_select_own_or_admin
on public.lrs
for select
to authenticated
using (
  public.has_permission('lr', 'view')
);


drop policy if exists lrs_update_own_or_admin on public.lrs;

create policy lrs_update_own_or_admin
on public.lrs
for update
to authenticated
using (
  public.has_permission('lr', 'edit')
)
with check (
  public.has_permission('lr', 'edit')
);


-- ==========================================================
-- PART B — pods: drop related-LR ownership from SELECT / INSERT / UPDATE
-- ==========================================================

drop policy if exists pods_select_own_lr_or_admin on public.pods;

create policy pods_select_own_lr_or_admin
on public.pods
for select
to authenticated
using (
  public.has_permission('pod', 'view')
);


drop policy if exists pods_insert_own_lr_or_admin on public.pods;

create policy pods_insert_own_lr_or_admin
on public.pods
for insert
to authenticated
with check (
  public.has_permission('pod', 'create_view')
);


drop policy if exists pods_update_own_lr_or_admin on public.pods;

create policy pods_update_own_lr_or_admin
on public.pods
for update
to authenticated
using (
  public.has_permission('pod', 'edit')
)
with check (
  public.has_permission('pod', 'edit')
);

-- ==========================================================
-- END 021
-- ==========================================================
