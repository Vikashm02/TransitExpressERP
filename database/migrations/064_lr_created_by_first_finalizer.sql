-- ==========================================================
-- Migration: 064_lr_created_by_first_finalizer
-- Module:    LR — Created By = first finalizer; preserve draft creator
--
-- BUSINESS RULE:
--   Numbered draft INSERT
--     created_by       = draft starter (temporary while draft)
--     draft_created_by = draft starter (immutable audit)
--   Draft autosave / continue by another user
--     created_by       unchanged
--     draft_created_by unchanged
--   FIRST draft → final (OLD.finalized_at IS NULL)
--     created_by       := auth.uid()  (permanent Created By)
--     draft_created_by preserved
--     updated_by       := auth.uid()  (existing audit trigger)
--   Later final → final edits
--     created_by       locked forever
--     draft_created_by locked forever
--   Direct final INSERT / bulk upload
--     created_by       = inserter
--     draft_created_by = NULL
--
-- DOES NOT:
--   - UPDATE/DELETE any existing lrs rows (no backfill)
--   - Touch LR19374 / recovered drafts / blank created_by
--   - Change RLS, assigned_to / Reassign, POD, numbering
--
-- NOT applied automatically — review, then apply manually in Supabase.
-- ==========================================================

-- ---------- draft_created_by (nullable; no historical backfill) ----------
alter table public.lrs
  add column if not exists draft_created_by uuid
  references public.app_users (id);

comment on column public.lrs.draft_created_by is
  'Immutable person who created/reserved the numbered draft. NULL when the LR was inserted already final (direct create / bulk). Not the visible Created By after first finalization.';

create index if not exists idx_lrs_draft_created_by
  on public.lrs (draft_created_by)
  where draft_created_by is not null;


-- ---------- lrs_enforce_ownership: draft_created_by + one-time transfer ----------
create or replace function public.lrs_enforce_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if tg_op = 'INSERT' then

    new.created_by := auth.uid();

    -- Draft starter only. Direct final / bulk → NULL.
    if coalesce(new.entry_status, 'final') = 'draft' then
      new.draft_created_by := auth.uid();
    else
      new.draft_created_by := null;
    end if;

    if new.assigned_to is null
       or not public.is_admin() then
      new.assigned_to := auth.uid();
    end if;

  elsif tg_op = 'UPDATE' then

    -- Never allow client/editor to rewrite who reserved the draft.
    new.draft_created_by := old.draft_created_by;

    -- Exactly one ownership transfer: first draft → final.
    if coalesce(old.entry_status, 'final') = 'draft'
       and coalesce(new.entry_status, 'final') = 'final'
       and old.finalized_at is null then
      new.created_by := auth.uid();
    else
      new.created_by := old.created_by;
    end if;

    if new.assigned_to is distinct from old.assigned_to
       and not public.is_admin() then
      new.assigned_to := old.assigned_to;
    end if;

  end if;

  return new;
end;
$$;


-- ---------- set_operations_audit_fields: same transfer so triggers do not fight ----------
-- Shared by lrs / pods / delivery_challans / asn_creations.
-- First-finalizer transfer is lrs-only; other tables keep prior preserve behavior.
create or replace function public.set_operations_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.created_by is null then
      NEW.created_by := auth.uid();
    else
      -- Ignore client-supplied creator; always use session user.
      NEW.created_by := auth.uid();
    end if;
    NEW.updated_by := auth.uid();
    if to_jsonb(NEW) ? 'updated_at' then
      NEW.updated_at := now();
    end if;
    return NEW;
  elsif TG_OP = 'UPDATE' then
    if to_jsonb(OLD) ? 'created_by' then
      -- lrs: allow created_by := auth.uid() only on first draft→final.
      -- Use jsonb field checks so non-lrs tables without entry_status/finalized_at
      -- are unaffected.
      if TG_TABLE_NAME = 'lrs'
         and coalesce(to_jsonb(OLD)->>'entry_status', 'final') = 'draft'
         and coalesce(to_jsonb(NEW)->>'entry_status', 'final') = 'final'
         and (to_jsonb(OLD)->>'finalized_at') is null then
        NEW.created_by := auth.uid();
      else
        NEW.created_by := OLD.created_by;
      end if;
    end if;
    NEW.updated_by := auth.uid();
    if to_jsonb(NEW) ? 'updated_at' then
      NEW.updated_at := now();
    end if;
    return NEW;
  end if;
  return NEW;
end;
$$;


-- ---------- discard_own_lr_draft: prefer draft_created_by; fall back for legacy drafts ----------
create or replace function public.discard_own_lr_draft(p_lr_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.lrs%rowtype;
  v_draft_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from public.lrs where id = p_lr_id for update;
  if not found then
    return;
  end if;

  if public.is_admin() then
    delete from public.lrs where id = p_lr_id;
    return;
  end if;

  -- New drafts: draft_created_by. Pre-064 drafts: null → fall back to created_by.
  v_draft_owner := coalesce(v_row.draft_created_by, v_row.created_by);

  if v_draft_owner is distinct from auth.uid() then
    raise exception 'Only the draft creator can discard this LR draft';
  end if;

  if coalesce(v_row.entry_status, 'final') is distinct from 'draft' then
    raise exception 'Only draft LRs can be discarded via this function';
  end if;

  delete from public.lrs where id = p_lr_id;
end;
$$;

revoke all on function public.discard_own_lr_draft(uuid) from public;
revoke all on function public.discard_own_lr_draft(uuid) from anon;
grant execute on function public.discard_own_lr_draft(uuid) to authenticated;

comment on function public.lrs_enforce_ownership() is
  'INSERT: sets created_by/assigned_to; sets draft_created_by for drafts only. UPDATE: immutable draft_created_by; transfers created_by to auth.uid() only on first draft→final (OLD.finalized_at IS NULL); otherwise preserves created_by. Admin-only assigned_to changes.';

comment on function public.set_operations_audit_fields() is
  'Operations audit: sets created_by/updated_by on INSERT; on UPDATE preserves created_by except lrs first draft→final transfer to auth.uid(); always refreshes updated_by.';
