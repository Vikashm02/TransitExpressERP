-- ==========================================================
-- Migration: 034_drafts_and_operations_audit
-- Module:    Draft/Incomplete entry state + Operations audit fields
--
-- 1) entry_status on customers, billing_parties, lrs, lorry_expenses
--    values: draft | final
--    Existing rows → final (historical records stay finalized).
--
-- 2) Operations audit for LR / POD / Delivery Challan / ASN:
--    created_by, created_at (where missing),
--    updated_by, updated_at
--    Protected by triggers from auth.uid() — clients cannot spoof.
--
-- NOT executed automatically — run manually against Supabase.
-- ==========================================================

-- ---------- Draft / entry status ----------
alter table public.customers
  add column if not exists entry_status text not null default 'final'
    check (entry_status in ('draft', 'final'));

alter table public.billing_parties
  add column if not exists entry_status text not null default 'final'
    check (entry_status in ('draft', 'final'));

alter table public.lrs
  add column if not exists entry_status text not null default 'final'
    check (entry_status in ('draft', 'final'));

alter table public.lorry_expenses
  add column if not exists entry_status text not null default 'final'
    check (entry_status in ('draft', 'final'));

create index if not exists idx_customers_entry_status on public.customers (entry_status);
create index if not exists idx_billing_parties_entry_status on public.billing_parties (entry_status);
create index if not exists idx_lrs_entry_status on public.lrs (entry_status);
create index if not exists idx_lorry_expenses_entry_status on public.lorry_expenses (entry_status);

-- ---------- POD created_by (missing historically) ----------
alter table public.pods
  add column if not exists created_by uuid references public.app_users (id);

-- ---------- updated_by on Operations modules ----------
alter table public.lrs
  add column if not exists updated_by uuid references public.app_users (id);

alter table public.pods
  add column if not exists updated_by uuid references public.app_users (id);

alter table public.delivery_challans
  add column if not exists updated_by uuid references public.app_users (id);

alter table public.asn_creations
  add column if not exists updated_by uuid references public.app_users (id);

create index if not exists idx_lrs_created_by on public.lrs (created_by);
create index if not exists idx_lrs_updated_by on public.lrs (updated_by);
create index if not exists idx_pods_created_by on public.pods (created_by);
create index if not exists idx_pods_updated_by on public.pods (updated_by);
create index if not exists idx_delivery_challans_updated_by on public.delivery_challans (updated_by);
create index if not exists idx_asn_creations_updated_by on public.asn_creations (updated_by);

-- ---------- Audit protection triggers ----------
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
    -- Preserve original creator.
    if to_jsonb(OLD) ? 'created_by' then
      NEW.created_by := OLD.created_by;
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

drop trigger if exists trg_lrs_operations_audit on public.lrs;
create trigger trg_lrs_operations_audit
  before insert or update on public.lrs
  for each row execute function public.set_operations_audit_fields();

drop trigger if exists trg_pods_operations_audit on public.pods;
create trigger trg_pods_operations_audit
  before insert or update on public.pods
  for each row execute function public.set_operations_audit_fields();

drop trigger if exists trg_delivery_challans_operations_audit on public.delivery_challans;
create trigger trg_delivery_challans_operations_audit
  before insert or update on public.delivery_challans
  for each row execute function public.set_operations_audit_fields();

drop trigger if exists trg_asn_creations_operations_audit on public.asn_creations;
create trigger trg_asn_creations_operations_audit
  before insert or update on public.asn_creations
  for each row execute function public.set_operations_audit_fields();
