-- ==========================================================
-- Migration: 015_create_credit_debit_notes
-- Modules:   Billing Party Master (new Short Code field),
--            Credit Note, Debit Note (new)
--
-- Reference: components/billingParty/billingParty.schema.ts
--            components/creditNote/creditNote.schema.ts
--            components/debitNote/debitNote.schema.ts
--            components/services/billingParty.service.ts
--            components/services/creditNote.service.ts
--            components/services/debitNote.service.ts
--
-- This file is a record of the schema change required by the
-- application. It is NOT executed automatically — run it manually
-- against the target Supabase project before Credit Note / Debit Note
-- are used. Migration 014 (and every prior migration) is untouched.
--
-- Notes:
--   - Purely additive: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
--     EXISTS only. No existing column, table, or row is altered,
--     renamed, or dropped.
--   - `short_code` is a manually-entered, per-party prefix (e.g. "ACC",
--     "ZIGMA") used to build Credit/Debit Note numbers
--     (`{shortCode}-CN-001`, `{shortCode}-DN-001`). It is NEVER
--     auto-derived from the party name by the application, and is
--     intentionally separate from the existing sequential `code`
--     column (e.g. "BP001") already used elsewhere. No existing
--     `billing_parties` row has this column populated by this
--     migration — it defaults to '' and must be set per party before
--     that party's first Credit/Debit Note.
--   - Credit/Debit Note sequence numbers (the "001", "002", ... part)
--     are NOT stored as a running-counter column anywhere. They are
--     computed per (billing_party_id, note type) by counting that
--     party's existing rows in `credit_notes` / `debit_notes` at
--     creation time — the same pattern already used by
--     `generateBillingPartyCode()` in billingParty.service.ts. This
--     keeps each party's Credit Note sequence and Debit Note sequence
--     fully independent of every other party and of each other, per
--     the approved numbering requirement.
--   - `billing_party_id` is `bigint`, matching the live
--     `public.billing_parties.id` type (see migration 012). `lrs.id`
--     is `uuid` (see migration 014) but is not referenced by this
--     migration — Credit/Debit Notes are billing-party-level
--     transactions, not LR-level.
--   - Both tables intentionally preserve every component described in
--     the business rule: `amount`, `deduction`, `net_amount` (Credit
--     Note) so ₹50,000 expected / ₹2,000 deducted / ₹48,000 received
--     are never collapsed into a single value.
-- ==========================================================

-- Billing Party Master: new manually-entered prefix for Credit/Debit
-- Note numbering (see notes above).
alter table public.billing_parties
  add column if not exists short_code text not null default '';

-- Only enforced when non-empty, so existing rows (all '' until an
-- admin sets one) never collide with each other.
create unique index if not exists idx_billing_parties_short_code
  on public.billing_parties (short_code)
  where short_code <> '';

-- One row per Credit Note.
create table if not exists public.credit_notes (
  id bigint generated always as identity primary key,
  credit_note_number text not null unique,
  note_date date not null,
  billing_party_id bigint not null references public.billing_parties(id),
  amount numeric not null default 0,
  deduction numeric not null default 0,
  net_amount numeric not null default 0,
  gst_percentage numeric not null default 0,
  gst_amount numeric not null default 0,
  remarks text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_credit_notes_billing_party_id on public.credit_notes (billing_party_id);
create index if not exists idx_credit_notes_note_date on public.credit_notes (note_date);

-- One row per Debit Note.
create table if not exists public.debit_notes (
  id bigint generated always as identity primary key,
  debit_note_number text not null unique,
  note_date date not null,
  billing_party_id bigint not null references public.billing_parties(id),
  amount numeric not null default 0,
  gst_percentage numeric not null default 0,
  gst_amount numeric not null default 0,
  total_amount numeric not null default 0,
  remarks text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_debit_notes_billing_party_id on public.debit_notes (billing_party_id);
create index if not exists idx_debit_notes_note_date on public.debit_notes (note_date);

-- Keeps `updated_at` current on every row update (same pattern as
-- bills/billing_parties).
create or replace function public.set_credit_notes_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_credit_notes_updated_at on public.credit_notes;

create trigger trg_credit_notes_updated_at
before update on public.credit_notes
for each row
execute function public.set_credit_notes_updated_at();

create or replace function public.set_debit_notes_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_debit_notes_updated_at on public.debit_notes;

create trigger trg_debit_notes_updated_at
before update on public.debit_notes
for each row
execute function public.set_debit_notes_updated_at();
