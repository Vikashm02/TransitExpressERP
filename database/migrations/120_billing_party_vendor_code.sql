-- 120: Vendor Code on the Billing Party Master (printed on the bill as
-- "Vendor Code : …" when filled). Optional; nothing existing is changed.
-- Rollback: alter table public.billing_parties drop column vendor_code;
-- (only if no vendor codes have been entered yet).

begin;

alter table public.billing_parties
  add column if not exists vendor_code text;

comment on column public.billing_parties.vendor_code is
  'Vendor code given to us by this billing party; printed on bills. Optional.';

commit;
