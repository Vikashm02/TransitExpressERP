-- ==========================================================
-- Migration: 081_trusted_lr_notification_scheduler
-- Module: server-only one-at-a-time trusted LR notification scheduler
--
-- Preflight before applying manually:
--   1. Enable pg_cron and pg_net in this Supabase project.
--   2. Deploy process-trusted-lr-notifications with scheduled mode.
--   3. Store a current project Secret API key in Supabase Vault as
--      trusted_lr_notification_scheduler_api_key.
--
-- The key is never written into this migration, Git, browser code, or an
-- Edge Function response. The cron job reads it from Vault only at runtime.
-- ==========================================================

begin;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron must be enabled before migration 081 is applied';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_net must be enabled before migration 081 is applied';
  end if;

  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'supabase_vault must be enabled before migration 081 is applied';
  end if;

  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'trusted_lr_notification_scheduler_api_key'
  ) then
    raise exception 'Vault secret trusted_lr_notification_scheduler_api_key must exist before migration 081 is applied';
  end if;
end;
$$;

-- Replacing only this named job makes the migration repeatable without
-- touching any unrelated scheduled work in the project.
select cron.unschedule(jobid)
from cron.job
where jobname = 'trusted-lr-notification-dispatcher-v1';

-- One server-side request per minute. Scheduled mode finds at most one due
-- trusted lr.updated event and the existing dispatcher atomically claims it.
-- A valid project Secret API key stays in Vault and never reaches a client.
select cron.schedule(
  'trusted-lr-notification-dispatcher-v1',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://qaktijgujtbardyjptbu.supabase.co/functions/v1/process-trusted-lr-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'trusted_lr_notification_scheduler_api_key'
        )
      ),
      body := '{"mode":"scheduled"}'::jsonb,
      timeout_milliseconds := 10000
    );
  $cron$
);

commit;
